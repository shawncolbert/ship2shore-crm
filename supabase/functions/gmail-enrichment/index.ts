import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
// Every org with a connected Gmail account gets enrichment, not just
// Ship2Shore -- see the loop in Deno.serve below.

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
  // e.g. "Jane Doe <jane@acme.com>" or just "jane@acme.com"
  const match = from.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/);
  let name = match?.[1]?.trim() || "";
  let email = (match?.[2] || from).trim().toLowerCase();
  if (!email.includes("@")) {
    email = from.trim().toLowerCase();
    name = "";
  }
  return { name, email };
}

// Gmail's own -category:promotions/-category:social filter (below) catches
// a lot but not everything -- plenty of marketing/transactional senders
// (order confirmations, account alerts, community digests) land in the
// plain Inbox category and slip through untouched. Real customers don't
// usually email from an address that starts with "no-reply" etc., and
// List-Unsubscribe is the actual IETF-standard signal (RFC 2369/8058) that
// virtually every bulk sender includes -- a real one-to-one correspondent
// never sets it. Catching this here (contact creation) is enough: gmail-sync
// only ever creates a conversation for a sender with an existing contact
// row, so skipping the contact keeps them out of the Inbox entirely too.
const AUTOMATED_LOCAL_PART_RE = /^(no-?reply|do-?not-?reply|notifications?|mailer-?daemon|bounce)/i;

function looksAutomated(email: string, headers: any[]): boolean {
  const localPart = email.split("@")[0] || "";
  if (AUTOMATED_LOCAL_PART_RE.test(localPart)) return true;
  return !!headers.find((h: any) => h.name === "List-Unsubscribe")?.value;
}

function guessCompany(email: string) {
  const domain = email.split("@")[1] || "";
  const freeProviders = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com"];
  if (freeProviders.includes(domain)) return null;
  const base = domain.split(".")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : null;
}

async function enrichAccount(supabase: any, tokenRow: any) {
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

  // Pull recent messages (last 15 min window, INBOX only, skip promotions/spam)
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=" +
      encodeURIComponent("in:inbox newer_than:1d -category:promotions -category:social"),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const listData = await listRes.json();

  if (!listRes.ok) {
    return { account: tokenRow.email, error: listData };
  }

  const messages = listData.messages || [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const msg of messages) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=List-Unsubscribe`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const msgData = await msgRes.json();
    const headers = msgData.payload?.headers || [];
    const fromHeader = headers.find((h: any) => h.name === "From")?.value;
    if (!fromHeader) { skipped++; continue; }

    const { name, email } = parseFromHeader(fromHeader);
    if (!email || !email.includes("@")) { skipped++; continue; }
    if (email === tokenRow.email.toLowerCase()) { skipped++; continue; } // skip self
    if (looksAutomated(email, headers)) { skipped++; continue; } // marketing/no-reply sender, not a real correspondent

    // NOTE: this used .maybeSingle(), which returns an ERROR (not null) when
    // more than one row matches -- and that error was being destructured away.
    // So any contact that already had duplicates (e.g. one from Calendly and
    // one from the Zoho import) looked "not found" on every single run and got
    // re-inserted every 10 minutes, forever. Take the oldest match instead and
    // let duplicates be harmless.
    const { data: existingRows } = await supabase
      .from("contacts")
      .select("id, full_name, company")
      .eq("org_id", orgId)
      .eq("email", email)
      .order("created_at", { ascending: true })
      .limit(1);
    const existing = existingRows?.[0] || null;

    const company = guessCompany(email);

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.full_name && name) patch.full_name = name;
      if (!existing.company && company) patch.company = company;
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        await supabase.from("contacts").update(patch).eq("id", existing.id);
        updated++;
      } else {
        skipped++;
      }
    } else {
      // "segment" is constrained to a fixed enum (contacts_segment_check) that
      // doesn't include a value for this source, so it lands in "other" —
      // "source" is unconstrained and still records where the contact came from.
      await supabase.from("contacts").insert({
        org_id: orgId,
        full_name: name || email,
        company,
        email,
        segment: "other",
        source: "gmail_enrichment",
      });
      created++;
    }
  }

  return { account: tokenRow.email, scanned: messages.length, created, updated, skipped };
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Every org with a connected Gmail account gets enrichment, not just Ship2Shore.
  const { data: tokenRows, error: tokenErr } = await supabase
    .from("gmail_oauth_tokens")
    .select("*");

  if (tokenErr || !tokenRows || tokenRows.length === 0) {
    return new Response(
      JSON.stringify({ error: "No org has connected a Gmail account yet." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const results = [];
  for (const tokenRow of tokenRows) {
    results.push(await enrichAccount(supabase, tokenRow));
  }

  return new Response(
    JSON.stringify({ accounts: results }),
    { headers: { "Content-Type": "application/json" } },
  );
});
