import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const DOCS_BUCKET = "delivery-orders";
// Every org with a row in gmail_oauth_tokens gets synced, not just
// Ship2Shore -- each org's own connected Gmail account, scoped to that
// org's own contacts/opportunities/attachments. Populated by a real human
// clicking "Connect Gmail" (gmail-oauth-start/callback).

async function refreshAccessToken(refresh_token: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Failed to refresh access token: " + JSON.stringify(data));
  return data;
}

function parseFromHeader(from: string) {
  const match = from.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/);
  let name = match?.[1]?.trim() || "";
  let email = (match?.[2] || from).trim().toLowerCase();
  if (!email.includes("@")) {
    email = from.trim().toLowerCase();
    name = "";
  }
  return { name, email };
}

function decodeBody(payload: any): string {
  function findPart(part: any): string | null {
    if (!part) return null;
    if (part.mimeType === "text/plain" && part.body?.data) return part.body.data;
    if (part.parts) {
      for (const p of part.parts) {
        const found = findPart(p);
        if (found) return found;
      }
    }
    return null;
  }
  const data = payload?.body?.data || findPart(payload);
  if (!data) return "";
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return atob(base64).slice(0, 5000);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Document auto-matching (Delivery Orders / Ports America gate passes)
// ---------------------------------------------------------------------------

// Strip everything except A-Z0-9 and uppercase, so "MOLU 1800920-1655" and
// "molu18009201655" compare equal.
const normalize = (s: unknown): string =>
  typeof s === "string" ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";

// Ocean bill-of-lading / container / booking numbers look like 4 letters + 6-12
// digits (e.g. MOLU18009201655). Used to store a bl_number and to report on
// unmatched docs; matching to a job is done via the job's known numbers below.
const BL_RE = /\b([A-Z]{4}\d{6,12})\b/g;
function firstBl(text: string): string | null {
  const m = text.match(BL_RE);
  return m && m[0] ? m[0] : null;
}

// Match a document to a job by looking for the job's billing_number or
// bl_number inside the document's combined text. Keys shorter than 6 chars are
// skipped to avoid coincidental substring hits.
function matchOpportunity(opps: any[], haystackNorm: string): any | null {
  for (const o of opps) {
    for (const key of [o.billing_number, o.bl_number]) {
      const k = normalize(key);
      if (k.length >= 6 && haystackNorm.includes(k)) return o;
    }
  }
  return null;
}

// A recognized shipping doc? Returns its kind, or null for unrelated PDFs.
function classifyKind(text: string): string | null {
  const s = text.toLowerCase();
  if (s.includes("gate pass") || s.includes("gatepass") || s.includes("ports america")) return "gate_pass";
  if (s.includes("delivery order")) return "delivery_order";
  return null;
}

// Best-effort embedded-text extraction. Dynamically imported so that a load or
// parse failure (e.g. a scanned/image-only PDF) only disables this signal — it
// never breaks the email sync. Image-only PDFs need OCR, which isn't available
// in the edge runtime; those fall through to the filename/subject/body signals
// and, failing a match, are flagged for manual review.
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("npm:unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : (text || "");
  } catch (_e) {
    return "";
  }
}

function b64urlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|heic|heif)$/i;
const isImageMime = (m: string) => /^image\/(jpe?g|png|heic|heif)$/i.test(m || "");

// Customers very often photograph a delivery order / gate pass with their
// phone instead of attaching a PDF -- those images used to be invisible to
// this sync entirely (only .pdf parts were ever collected), so they just
// vanished with no record and no review flag. Collect both.
function collectDocParts(payload: any): Array<{ filename: string; mimeType: string; attachmentId: string; isImage: boolean }> {
  const out: Array<{ filename: string; mimeType: string; attachmentId: string; isImage: boolean }> = [];
  function walk(part: any) {
    if (!part) return;
    const fn: string = part.filename || "";
    const isPdf = part.mimeType === "application/pdf" || /\.pdf$/i.test(fn);
    const isImage = isImageMime(part.mimeType) || IMAGE_EXT_RE.test(fn);
    if (part.body?.attachmentId && fn && (isPdf || isImage)) {
      out.push({
        filename: fn,
        mimeType: part.mimeType || (isPdf ? "application/pdf" : "application/octet-stream"),
        attachmentId: part.body.attachmentId,
        isImage,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return out;
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

// Scan one message's PDF and image attachments, match Delivery Orders / gate
// passes to a job, store them in the delivery-orders bucket + attachments
// table, and flag anything unmatched for manual review. Returns per-message counts.
//
// Classification and matching are done from EACH attachment's own text
// (filename + its PDF text) — never the shared email subject/body — so an email
// whose body happens to mention "delivery order" doesn't drag in every
// unrelated customs PDF it carries.
async function processAttachments(
  supabase: any,
  accessToken: string,
  msgId: string,
  payload: any,
  contactId: string | undefined,
  opps: any[],
  orgId: string,
) {
  const stats = { stored: 0, matched: 0, review: 0, irrelevant: 0, errors: [] as any[] };
  const parts = collectDocParts(payload);

  for (const part of parts) {
    const filename = part.filename;
    try {
      // Dedupe: same email + filename already ingested on a previous run.
      const { data: dupe } = await supabase
        .from("attachments")
        .select("id")
        .eq("provider_msg_id", msgId)
        .eq("file_name", filename)
        .maybeSingle();
      if (dupe) continue;

      const attRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${part.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const attData = await attRes.json();
      if (!attRes.ok || !attData?.data) { stats.errors.push({ file: filename, detail: attData }); continue; }

      const bytes = b64urlToBytes(attData.data);
      // No OCR in the edge runtime -- an image's only signal is its filename.
      // A PDF's embedded text layer is far more reliable, when it has one.
      const pdfText = part.isImage ? "" : await extractPdfText(bytes);
      const docText = filename + "\n" + pdfText;
      const kind = classifyKind(docText);
      const match = matchOpportunity(opps, normalize(docText));

      // An unmatched, unclassified PDF is almost always an unrelated customs
      // form (7501, ABI, etc.) -- safe to skip. A photo attachment has no such
      // signal to fall back on, and in this business a customer's photo
      // attachment is overwhelmingly a document photo, not decoration -- so
      // images always get stored and flagged for a human instead of dropped.
      if (!match && !kind && !part.isImage) { stats.irrelevant++; continue; }

      const bl = firstBl(docText);
      const linkContactId = match?.contact_id || contactId || null;
      const path = `${orgId}/${linkContactId || "unmatched"}/${msgId}_${safeName(filename)}`;

      const { error: upErr } = await supabase.storage
        .from(DOCS_BUCKET)
        .upload(path, bytes, { contentType: part.mimeType, upsert: true });
      if (upErr) { stats.errors.push({ file: filename, detail: upErr.message || upErr }); continue; }

      const { error: insErr } = await supabase.from("attachments").insert({
        org_id: orgId,
        contact_id: linkContactId,
        opportunity_id: match?.id || null,
        file_name: filename,
        file_path: path,
        mime_type: part.mimeType,
        size_bytes: bytes.length,
        kind: kind || "shipping_doc",
        bl_number: bl,
        needs_review: !match,
        source: "gmail_auto",
        provider_msg_id: msgId,
      });
      if (insErr) { stats.errors.push({ file: filename, detail: insErr.message || insErr }); continue; }

      stats.stored++;
      if (match) {
        stats.matched++;
        // Backfill the job's bl_number if we found one and it had none.
        if (bl && !match.bl_number) {
          await supabase.from("opportunities").update({ bl_number: bl }).eq("id", match.id);
          match.bl_number = bl;
        }
      } else {
        stats.review++;
      }
    } catch (e) {
      stats.errors.push({ file: filename, detail: String(e) });
    }
  }

  return stats;
}

async function syncAccount(supabase: any, tokenRow: any, emailToContact: Map<string, string>, opps: any[]) {
  const orgId = tokenRow.org_id;
  let accessToken = tokenRow.access_token;
  const expired = !tokenRow.token_expiry || new Date(tokenRow.token_expiry) <= new Date();
  if (expired) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await supabase
      .from("gmail_oauth_tokens")
      .update({ access_token: accessToken, token_expiry: newExpiry, updated_at: new Date().toISOString() })
      .eq("id", tokenRow.id);
  }

  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=" +
      encodeURIComponent("newer_than:14d -category:promotions -category:social"),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const listData = await listRes.json();
  if (!listRes.ok) {
    return { account: tokenRow.email, error: listData };
  }

  const messages = listData.messages || [];
  let created = 0, skipped = 0, notContact = 0;
  const docs = { stored: 0, matched: 0, review: 0, irrelevant: 0 };
  const errors: any[] = [];

  for (const msg of messages) {
    const { data: existingMsg } = await supabase
      .from("messages")
      .select("id")
      .eq("provider_msg_id", msg.id)
      .maybeSingle();
    if (existingMsg) { skipped++; continue; }

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const msgData = await msgRes.json();
    const headers = msgData.payload?.headers || [];
    const fromHeader = headers.find((h: any) => h.name === "From")?.value || "";
    const toHeader = headers.find((h: any) => h.name === "To")?.value || "";
    const dateHeader = headers.find((h: any) => h.name === "Date")?.value;

    const { email: fromEmail } = parseFromHeader(fromHeader);
    const { email: toEmail } = parseFromHeader(toHeader);
    const selfEmail = tokenRow.email.toLowerCase();

    const direction = fromEmail === selfEmail ? "outbound" : "inbound";
    const counterpartEmail = direction === "outbound" ? toEmail : fromEmail;

    const contactId = emailToContact.get(counterpartEmail);
    const body = decodeBody(msgData.payload);

    // Scan attachments regardless of whether the sender is a known contact —
    // Delivery Orders and gate passes often come from shipping lines/terminals.
    const aStats = await processAttachments(
      supabase, accessToken, msg.id, msgData.payload, contactId, opps, orgId,
    );
    docs.stored += aStats.stored;
    docs.matched += aStats.matched;
    docs.review += aStats.review;
    docs.irrelevant += aStats.irrelevant;
    if (aStats.errors.length) errors.push(...aStats.errors);

    if (!contactId) { notContact++; continue; }

    const { data: existingConvo } = await supabase
      .from("conversations")
      .select("id")
      .eq("org_id", orgId)
      .eq("contact_id", contactId)
      .eq("channel", "email")
      .maybeSingle();

    let conversationId = existingConvo?.id;
    const sentAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

    if (!conversationId) {
      const { data: newConvo } = await supabase
        .from("conversations")
        .insert({ org_id: orgId, contact_id: contactId, channel: "email", last_message_at: sentAt, unread: direction === "inbound" })
        .select("id")
        .single();
      conversationId = newConvo?.id;
    } else {
      await supabase.from("conversations").update({ last_message_at: sentAt, unread: direction === "inbound" }).eq("id", conversationId);
    }

    if (!conversationId) { skipped++; continue; }

    const { error: rpcError } = await supabase.rpc("insert_gmail_message", {
      p_org_id: orgId,
      p_conversation_id: conversationId,
      p_direction: direction,
      p_body: body,
      p_from_addr: fromEmail,
      p_to_addr: toEmail,
      p_provider_msg_id: msg.id,
      p_created_at: sentAt,
    });

    if (rpcError) errors.push(rpcError);
    else created++;
  }

  return { account: tokenRow.email, scanned: messages.length, created, skipped, non_contact: notContact, documents: docs, errors };
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Every org that has connected Gmail gets synced, not just Ship2Shore.
  const { data: tokenRows, error: tokenErr } = await supabase
    .from("gmail_oauth_tokens")
    .select("*");

  if (tokenErr || !tokenRows || tokenRows.length === 0) {
    return new Response(JSON.stringify({ error: "No org has connected a Gmail account yet." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const tokenRow of tokenRows) {
    const orgId = tokenRow.org_id;

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, email")
      .eq("org_id", orgId)
      .not("email", "is", null);

    const emailToContact = new Map<string, string>();
    for (const c of contacts || []) {
      if (c.email) emailToContact.set(c.email.toLowerCase(), c.id);
    }

    // Jobs we can match documents against (billing_number / bl_number).
    const { data: opps } = await supabase
      .from("opportunities")
      .select("id, contact_id, billing_number, bl_number")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    results.push(await syncAccount(supabase, tokenRow, emailToContact, opps || []));
  }

  return new Response(JSON.stringify({ accounts: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
