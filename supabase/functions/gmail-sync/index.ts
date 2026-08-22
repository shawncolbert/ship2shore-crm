import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
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

// Strips tags/scripts/styles and decodes the entities that actually show up
// in real mail -- good enough for a readable preview, not a full HTML parser.
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A message body can be UTF-8-encoded -- treating the decoded bytes as a JS
// string directly (the old atob()-only approach) reinterprets each UTF-8
// continuation byte as its own Latin-1 character, producing mojibake ("Ã¢Â€Â""
// instead of an em dash) on anything outside plain ASCII. TextDecoder("utf-8")
// reassembles the real characters. Also now actually checks mimeType on a
// single-part message instead of blindly using payload.body.data regardless
// of type -- an HTML-only email (common for automated notifications) used to
// get its raw markup dumped in as "the message" with nothing stripped.
function decodeBody(payload: any): string {
  function findPartByType(part: any, mimeType: string): string | null {
    if (!part) return null;
    if (part.mimeType === mimeType && part.body?.data) return part.body.data;
    if (part.parts) {
      for (const p of part.parts) {
        const found = findPartByType(p, mimeType);
        if (found) return found;
      }
    }
    return null;
  }

  const plainData = payload?.mimeType === "text/plain" ? payload?.body?.data : findPartByType(payload, "text/plain");
  const htmlData = payload?.mimeType === "text/html" ? payload?.body?.data : findPartByType(payload, "text/html");
  const data = plainData || htmlData;
  if (!data) return "";

  try {
    const decoded = new TextDecoder("utf-8").decode(b64urlToBytes(data));
    const text = plainData ? decoded : htmlToText(decoded);
    return text.slice(0, 5000);
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

// ---------------------------------------------------------------------------
// Load-board confirmation ingestion (Central Dispatch / Super Dispatch)
// ---------------------------------------------------------------------------
//
// Phase 2 of the load-board integration -- Phase 1 (manual "Source" tag on
// a job) shipped first. Neither board offers API access on any plan
// available to us, so this reads the confirmation EMAIL each board already
// sends to the connected inbox, never their systems directly -- no login,
// no scraping, nothing that needs their permission, since it's just mail
// the org already owns.
//
// NOTE: still not confirmed against a real confirmation email from either
// board -- same caveat this project has hit before with FMCSA/Firecrawl
// (see fmcsa-search.js, lead-discover.js for the same pattern). Central
// Dispatch is a Cox Automotive product, so its sender domains/addresses
// below are a more specific guess than a bare "centraldispatch.com". If
// real confirmation emails never trigger this, forward one and check its
// actual From address against these.
const CD_SENDER_DOMAINS = ["centraldispatch.com", "coxautoinc.com"];
const CD_SPECIFIC_EMAILS = [
  "do-not-reply@centraldispatch.com",
  "reply@messages.centraldispatch.com",
  "centraldispatchfraudclaims@coxautoinc.com",
];
const SD_SENDER_DOMAINS = ["superdispatch.com"];
const SD_SPECIFIC_EMAILS = [
  "support@superdispatch.com",
  "notifications@superdispatch.com",
  "billing@superdispatch.com",
];

// Brokers often forward or paste a dispatch sheet from their OWN address
// rather than the board itself emailing directly -- a sender-domain check
// alone misses those. This is a secondary signal only: it decides whether
// to attempt extraction, never whether to create a Contact/Opportunity.
// That decision is still gated entirely by extractDispatchInfo()'s own
// is_dispatch_confirmation check below, so a false-positive keyword match
// (e.g. someone just discussing a rate confirmation) costs one wasted
// Claude call, not a phantom job on the Pipeline. Requiring 2+ matches
// keeps single-keyword noise (a bare "Load ID" mention) from tripping it.
const LOAD_KEYWORDS = [
  /super\s*dispatch/i,
  /central\s*dispatch/i,
  /load\s*id/i,
  /dispatch\s*sheet/i,
  /rate\s*confirmation/i,
  /bill\s*of\s*lading/i,
  /order\s*accepted/i,
  /\b[A-HJ-NPR-Z0-9]{17}\b/, // VIN shape
];

function looksLikeLoadEmail(subject: string, bodyText: string): boolean {
  const text = `${subject} ${bodyText}`;
  const matches = LOAD_KEYWORDS.filter((re) => re.test(text));
  return matches.length >= 2;
}

// `confident` means the sender itself told us which board -- a known
// address/domain match. When it's false (only the keyword fallback fired),
// `board` is just a placeholder guess and extractDispatchInfo()'s own
// platform_source read is what actually decides the final tag.
function detectBoardEmail(fromEmail: string, subject: string, bodyText: string): { board: string; confident: boolean } | null {
  const sender = fromEmail.toLowerCase().trim();
  const domain = sender.split("@")[1] || "";

  if (CD_SPECIFIC_EMAILS.includes(sender)) return { board: "central_dispatch", confident: true };
  if (CD_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return { board: "central_dispatch", confident: true };
  if (SD_SPECIFIC_EMAILS.includes(sender)) return { board: "super_dispatch", confident: true };
  if (SD_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return { board: "super_dispatch", confident: true };

  if (looksLikeLoadEmail(subject, bodyText)) {
    // A cheap first guess so a job still gets a source_board even if
    // extraction below fails to return a usable platform_source.
    const guess = /super\s*dispatch/i.test(`${subject} ${bodyText}`) ? "super_dispatch" : "central_dispatch";
    return { board: guess, confident: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Zelle payment auto-matching
// ---------------------------------------------------------------------------
//
// The receiving bank emails a "you got money" notification the moment a
// Zelle payment lands -- there's no other reliable signal, since Zelle
// itself has no API for a small business account. Gated on the word
// "zelle" actually appearing before ever calling Claude, same cost-control
// pattern as looksLikeLoadEmail below. Every bank phrases these differently
// (Chase vs BofA vs Wells Fargo etc.) -- not confirmed against a real one
// from every bank a customer might use; if a real notification never
// triggers this, forward one and check its subject/body against the gate.
function looksLikeZelleEmail(subject: string, bodyText: string): boolean {
  const text = `${subject} ${bodyText}`.toLowerCase();
  if (!text.includes("zelle")) return false;
  return /(received|deposited|sent you|is available|has been added|you got)/.test(text);
}

const ZELLE_EXTRACT_SYSTEM = `You read a bank notification email to check whether it's a "Zelle payment received" notice -- money coming IN to the account holder's own bank account via Zelle. If it's anything else (a Zelle payment SENT out, a failed/pending/canceled transfer, a request for money, or an unrelated email that merely mentions Zelle), respond with exactly {"is_zelle_received": false} and nothing else. Otherwise extract exactly this shape, with ONLY valid JSON, no other text:
{"is_zelle_received": true, "amount": number, "sender_name": "string or null", "memo": "string or null"}
amount is a plain number, no currency symbol or commas. sender_name is the person who sent the money, exactly as the notification names them -- not the bank's own name. memo is any note/message that came with the payment, or null.`;

async function extractZellePayment(subject: string, bodyText: string): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system: ZELLE_EXTRACT_SYSTEM,
      messages: [{ role: "user", content: `Subject: ${subject}\n\nBody:\n${bodyText}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Claude API error: " + JSON.stringify(data));
  const raw = (data.content || []).map((b: any) => b.text || "").join("").trim();
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    if (!parsed?.is_zelle_received || !(Number(parsed.amount) > 0)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Loose "do these two names share a real word" check -- good enough to tell
// "Sarah Chen" from "Sarah's Zelle" apart from a same-amount coincidence
// without needing a real fuzzy-matching library for this one comparison.
function nameWordsOverlap(a: string, b: string): boolean {
  const words = (s: string) => (s || "").toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length >= 3);
  const aw = new Set(words(a));
  return words(b).some((w) => aw.has(w));
}

function buildSimpleRaw(from: string, to: string, subject: string, body: string): string {
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
  return btoa(unescape(encodeURIComponent(msg))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Self-email alert, same "org's own inbox" pattern as contract-send's
// internal alerts -- sent from and to the org's own connected Gmail account
// so it just shows up in their normal inbox, no separate notification
// system needed. Best-effort: a failed alert never blocks the payment match
// itself, since the zelle_payments row (and, for an auto-match, the paid
// invoice) is already the durable record either way.
async function gmailSendSelf(accessToken: string, selfEmail: string, subject: string, body: string) {
  try {
    const raw = buildSimpleRaw(selfEmail, selfEmail, subject, body);
    await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
  } catch { /* best-effort */ }
}

// Matches on amount first (an open invoice's amount_due), then narrows by
// sender name only when the amount alone doesn't already pin it down to one
// invoice. "Unambiguous" = exactly one candidate once both signals are
// applied; anything else (zero, or several that still tie) gets flagged in
// zelle_payments for a dispatcher's one-click confirm instead of guessing
// which job actually got paid.
async function handleZellePayment(
  supabase: any, orgId: string, subject: string, body: string, msgId: string,
  accessToken: string, selfEmail: string, sentAt: string,
) {
  const { data: already } = await supabase
    .from("zelle_payments").select("id").eq("org_id", orgId).eq("provider_msg_id", msgId).maybeSingle();
  if (already) return;

  const info = await extractZellePayment(subject, body);
  if (!info) return;

  const amount = Number(info.amount);
  const { data: candidates } = await supabase
    .from("invoices")
    .select("id, opportunity_id, kind, amount_due, bill_to_name, contacts:contact_id(full_name)")
    .eq("org_id", orgId)
    .in("status", ["sent", "overdue"])
    .eq("amount_due", amount);

  let matchedInvoice: any = null;
  let unambiguous = false;
  const list = candidates || [];
  if (list.length === 1) {
    const inv = list[0];
    const billName = inv.bill_to_name || inv.contacts?.full_name || "";
    unambiguous = !info.sender_name || !billName || nameWordsOverlap(billName, info.sender_name);
    matchedInvoice = inv;
  } else if (list.length > 1 && info.sender_name) {
    const named = list.filter((inv: any) =>
      nameWordsOverlap(inv.bill_to_name || inv.contacts?.full_name || "", info.sender_name));
    if (named.length === 1) { matchedInvoice = named[0]; unambiguous = true; }
  }

  if (unambiguous && matchedInvoice) {
    await supabase.from("invoices").update({
      status: "paid", amount_due: 0, paid_at: new Date().toISOString(),
      payment_method: "Zelle", updated_at: new Date().toISOString(),
    }).eq("id", matchedInvoice.id);

    if (matchedInvoice.opportunity_id) {
      const field = matchedInvoice.kind === "deposit" ? "deposit_paid" : "paid";
      await supabase.from("opportunities").update({ [field]: true }).eq("id", matchedInvoice.opportunity_id);
    }

    await supabase.from("zelle_payments").insert({
      org_id: orgId, provider_msg_id: msgId, amount, sender_name: info.sender_name || null, memo: info.memo || null,
      invoice_id: matchedInvoice.id, opportunity_id: matchedInvoice.opportunity_id || null,
      status: "matched", auto_matched: true, received_at: sentAt, resolved_at: new Date().toISOString(),
    });

    await gmailSendSelf(accessToken, selfEmail,
      `Zelle payment matched — $${amount.toFixed(2)}`,
      `A Zelle payment of $${amount.toFixed(2)} from ${info.sender_name || "an unknown sender"} was automatically matched to an invoice and marked paid.\n\nCheck the job on your Pipeline to confirm.`);
  } else {
    await supabase.from("zelle_payments").insert({
      org_id: orgId, provider_msg_id: msgId, amount, sender_name: info.sender_name || null, memo: info.memo || null,
      invoice_id: matchedInvoice?.id || null, opportunity_id: matchedInvoice?.opportunity_id || null,
      status: "pending", auto_matched: false, received_at: sentAt,
    });

    await gmailSendSelf(accessToken, selfEmail,
      `Zelle payment needs review — $${amount.toFixed(2)}`,
      `A Zelle payment of $${amount.toFixed(2)} from ${info.sender_name || "an unknown sender"} came in but couldn't be matched to exactly one open invoice automatically. Review and confirm it under Invoices in the app.`);
  }
}

const PLATFORM_TO_BOARD: Record<string, string> = {
  "Super Dispatch": "super_dispatch",
  "Central Dispatch": "central_dispatch",
  "Direct Broker": "direct",
};

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";

const DISPATCH_EXTRACT_SYSTEM = `You read auto-transport load-board confirmation emails (Central Dispatch,
Super Dispatch, or a direct broker) and extract structured data. If this email is NOT actually a load/dispatch
confirmation (e.g. it's a marketing email, password reset, or account notice from the board), return
{"is_dispatch_confirmation": false} and nothing else.

Otherwise extract every field you can find. Do not invent anything not present in the text -- use null for
anything missing. "platform_source" is which platform this load actually came through, judged from the
email's own content (branding, footer, terminology) -- NOT from who forwarded it: "Super Dispatch",
"Central Dispatch", "Direct Broker" (no load board involved), or "Unknown". Respond with ONLY valid JSON,
no other text, in this exact shape:
{"is_dispatch_confirmation": true, "platform_source": "string", "order_number": "string or null",
"broker_name": "string or null", "broker_email": "string or null", "broker_phone": "string or null",
"pay_amount": number or null,
"vehicles": [{"year": "string", "make": "string", "model": "string", "vin": "string"}],
"pickup": {"city": "string or null", "state": "string or null"},
"delivery": {"city": "string or null", "state": "string or null"}}`;

async function extractDispatchInfo(subject: string, bodyText: string): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured for this project's Edge Functions");
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: DISPATCH_EXTRACT_SYSTEM,
      messages: [{ role: "user", content: `Subject: ${subject}\n\nBody:\n${bodyText}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Claude API error: " + JSON.stringify(data));
  const raw = (data.content || []).map((b: any) => b.text || "").join("").trim();
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
  } catch {
    return null; // Claude didn't return clean JSON -- skip this message rather than guess
  }
  if (!parsed?.is_dispatch_confirmation) return null;
  return parsed;
}

// Same "take the oldest match, phone as a second key" shape as
// gmail-enrichment's contact matching -- kept independent here rather than
// shared, since gmail-enrichment matches on the EMAIL SENDER while this
// matches on a BROKER named inside the email body, a different lookup.
async function findOrCreateBrokerContact(supabase: any, orgId: string, broker: any) {
  const email = broker.broker_email?.trim()?.toLowerCase() || null;
  const phone = broker.broker_phone?.trim() || null;
  const name = broker.broker_name?.trim() || null;
  if (!email && !phone && !name) return null;

  if (email) {
    const { data } = await supabase
      .from("contacts").select("id").eq("org_id", orgId).eq("email", email)
      .order("created_at", { ascending: true }).limit(1);
    if (data?.[0]) return data[0].id;
  }
  if (phone) {
    const { data } = await supabase
      .from("contacts").select("id").eq("org_id", orgId).eq("phone", phone)
      .order("created_at", { ascending: true }).limit(1);
    if (data?.[0]) return data[0].id;
  }

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      org_id: orgId,
      full_name: name || email || phone,
      email,
      phone,
      segment: "broker",
      source: "gmail_dispatch_ingest",
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function getIntakePipelineStage(supabase: any, orgId: string) {
  const { data: pipeline } = await supabase
    .from("pipelines").select("id").eq("org_id", orgId).eq("is_default", true).maybeSingle();
  if (!pipeline) return null;

  const { data: stages } = await supabase
    .from("stages").select("id, name, is_intake").eq("pipeline_id", pipeline.id);
  if (!stages?.length) return null;

  const stage = stages.find((s: any) => s.is_intake) ||
    stages.find((s: any) => s.name.toLowerCase() === "new booking") || null;
  if (!stage) return null;
  return { pipelineId: pipeline.id, stageId: stage.id };
}

const addressLine = (loc: any) => [loc?.city, loc?.state].filter(Boolean).join(", ") || null;

// Runs once per matched confirmation email. Creates/matches the broker as a
// Contact, drops one Opportunity per vehicle onto the org's default
// pipeline (tagged with source_board + board_order_number so Phase 1's
// badge shows it), and logs the email itself into that contact's Inbox
// conversation -- which doubles as this run's dedupe marker via the same
// provider_msg_id uniqueness the rest of this file already relies on.
async function handleBoardConfirmation(
  supabase: any,
  orgId: string,
  board: string,
  boardConfident: boolean,
  subject: string,
  body: string,
  msgId: string,
  fromEmail: string,
  toEmail: string,
  sentAt: string,
) {
  const info = await extractDispatchInfo(subject, body);
  if (!info || !info.order_number) return { opportunitiesCreated: 0, skipped: true };

  // The sender's own address only tells us for certain when it's the
  // board's own system mail. Anything reached via the keyword fallback is
  // just a placeholder guess -- let Claude's read of the email's own
  // content (branding, footer, terminology) settle it instead.
  const resolvedBoard = boardConfident
    ? board
    : PLATFORM_TO_BOARD[info.platform_source] || board;

  const contactId = await findOrCreateBrokerContact(supabase, orgId, info);
  const pipelineStage = await getIntakePipelineStage(supabase, orgId);

  if (contactId) {
    const { data: existingConvo } = await supabase
      .from("conversations").select("id")
      .eq("org_id", orgId).eq("contact_id", contactId).eq("channel", "email").maybeSingle();
    let conversationId = existingConvo?.id;
    if (!conversationId) {
      const { data: newConvo } = await supabase
        .from("conversations")
        .insert({ org_id: orgId, contact_id: contactId, channel: "email", last_message_at: sentAt, unread: true })
        .select("id").single();
      conversationId = newConvo?.id;
    } else {
      await supabase.from("conversations").update({ last_message_at: sentAt, unread: true }).eq("id", conversationId);
    }
    if (conversationId) {
      await supabase.rpc("insert_gmail_message", {
        p_org_id: orgId, p_conversation_id: conversationId, p_direction: "inbound", p_body: body,
        p_from_addr: fromEmail, p_to_addr: toEmail, p_provider_msg_id: msgId, p_created_at: sentAt,
      });
    }
  }

  if (!pipelineStage) return { opportunitiesCreated: 0, skipped: true }; // no default pipeline configured for this org yet

  const vehicles = Array.isArray(info.vehicles) && info.vehicles.length ? info.vehicles : [{}];
  let created = 0;
  for (const [i, v] of vehicles.entries()) {
    const vehicleDesc = [v.year, v.make, v.model].filter(Boolean).join(" ");
    const { error } = await supabase.from("opportunities").insert({
      org_id: orgId,
      contact_id: contactId,
      pipeline_id: pipelineStage.pipelineId,
      stage_id: pipelineStage.stageId,
      title: [info.broker_name, vehicleDesc].filter(Boolean).join(" — ") || `Load #${info.order_number}`,
      // Pay is for the whole order, not per vehicle -- only the first
      // opportunity on a multi-car load gets it, so revenue reporting
      // doesn't multiply one payment across several cards.
      value: i === 0 ? info.pay_amount : null,
      vehicle_year: v.year || null,
      vehicle_make: v.make || null,
      vehicle_model: v.model || null,
      vehicle_vin: v.vin || null,
      pickup_address: addressLine(info.pickup),
      dropoff_address: addressLine(info.delivery),
      source_board: resolvedBoard,
      board_order_number: info.order_number,
    });
    if (!error) created++;
  }
  return { opportunitiesCreated: created, skipped: false };
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
  const dispatches = { detected: 0, opportunitiesCreated: 0 };
  const zelle = { detected: 0 };
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
    const subjectHeader = headers.find((h: any) => h.name === "Subject")?.value || "";
    const dateHeader = headers.find((h: any) => h.name === "Date")?.value;

    const { email: fromEmail } = parseFromHeader(fromHeader);
    const { email: toEmail } = parseFromHeader(toHeader);
    const selfEmail = tokenRow.email.toLowerCase();

    const direction = fromEmail === selfEmail ? "outbound" : "inbound";
    const counterpartEmail = direction === "outbound" ? toEmail : fromEmail;

    const body = decodeBody(msgData.payload);
    const sentAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

    // A load-board confirmation comes FROM the board's own system address,
    // not from a saved contact -- handled as its own path, separate from
    // (and before) the normal "is this from someone I know" flow below,
    // since the board itself is never going to be a contact worth saving.
    if (direction === "inbound") {
      const detected = detectBoardEmail(fromEmail, subjectHeader, body);
      if (detected) {
        dispatches.detected++;
        try {
          const result = await handleBoardConfirmation(
            supabase, orgId, detected.board, detected.confident, subjectHeader, body, msg.id, fromEmail, toEmail, sentAt,
          );
          dispatches.opportunitiesCreated += result.opportunitiesCreated;
        } catch (e) {
          errors.push({ board: detected.board, msgId: msg.id, detail: String(e) });
        }
        continue;
      }

      if (looksLikeZelleEmail(subjectHeader, body)) {
        zelle.detected++;
        try {
          await handleZellePayment(supabase, orgId, subjectHeader, body, msg.id, accessToken, tokenRow.email, sentAt);
        } catch (e) {
          errors.push({ zelle: true, msgId: msg.id, detail: String(e) });
        }
        continue;
      }
    }

    const contactId = emailToContact.get(counterpartEmail);

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

  return { account: tokenRow.email, scanned: messages.length, created, skipped, non_contact: notContact, documents: docs, dispatches, zelle, errors };
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
