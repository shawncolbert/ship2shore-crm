import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Fired by trg_notify_invoice_paid (AFTER UPDATE on public.invoices, WHEN
// status transitions TO 'paid'). Two jobs, both server-side so they cover
// every way an invoice can end up paid (manual mark-paid, the Stripe
// webhook, any future path) instead of being wired into each one:
//   1. Balance invoices (kind != 'deposit') drag their linked job to the
//      Paid stage. Deposit invoices deliberately do NOT -- a deposit is
//      paid at booking, long before the job is done.
//   2. Emails the customer a receipt, once (receipt_sent_at guards against
//      a re-fire if status is ever toggled paid -> other -> paid again).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const money = (n: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

async function gmailAccessToken(supabase: any, org_id: string): Promise<{ token: string; from: string } | null> {
  const { data: row } = await supabase
    .from("gmail_oauth_tokens").select("*").eq("org_id", org_id).limit(1).maybeSingle();
  if (!row) return null;
  let token = row.access_token;
  const expired = !row.token_expiry || new Date(row.token_expiry) <= new Date();
  if (expired) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: row.refresh_token, grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error("token refresh failed: " + JSON.stringify(data));
    token = data.access_token;
    await supabase.from("gmail_oauth_tokens")
      .update({ access_token: token, token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }
  return { token, from: row.email };
}

function b64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Email headers (unlike the body) don't get a charset declaration -- a raw
// UTF-8 character like an em dash sitting directly in "Subject: ..." comes
// through as mojibake (Ã¢Â€Â") in the inbox. RFC 2047 encoded-word is the
// fix: wrap any non-ASCII subject as base64 inside =?UTF-8?B?...?=.
function encodeHeader(text: string): string {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

async function sendGmail(token: string, from: string, to: string, subject: string, body: string) {
  const raw = [
    `From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body,
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  if (!res.ok) throw new Error("gmail send failed: " + (await res.text()));
}

Deno.serve(async (req: Request) => {
  try {
    const { invoice_id, org_id } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Re-check against the real row, not the trigger's claim.
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, org_id, opportunity_id, kind, status, invoice_number, total, paid_at, payment_method, bill_to_name, bill_to_email, contact_id, receipt_sent_at")
      .eq("id", invoice_id).eq("org_id", org_id).maybeSingle();
    if (!invoice || invoice.status !== "paid") {
      return json({ skipped: true, reason: "not a paid invoice" });
    }

    const results: any = {};

    // 1. Balance invoices drag their job to Paid. Deposit invoices don't.
    if (invoice.kind !== "deposit" && invoice.opportunity_id) {
      const { data: paidStage } = await supabase
        .from("stages").select("id").eq("org_id", org_id).ilike("name", "paid").maybeSingle();
      if (paidStage) {
        await supabase.from("opportunities").update({ stage_id: paidStage.id }).eq("id", invoice.opportunity_id);
        results.stage_moved = true;
      }
    }

    // 2. Email a receipt, once.
    if (!invoice.receipt_sent_at) {
      let toEmail = invoice.bill_to_email;
      if (!toEmail && invoice.contact_id) {
        const { data: contact } = await supabase.from("contacts").select("email").eq("id", invoice.contact_id).maybeSingle();
        toEmail = contact?.email;
      }
      if (toEmail) {
        const { data: org } = await supabase.from("organizations").select("name").eq("id", org_id).maybeSingle();
        const gmail = await gmailAccessToken(supabase, org_id);
        if (gmail) {
          const brand = org?.name || "Dispatch";
          const paidWhen = invoice.paid_at
            ? new Date(invoice.paid_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" })
            : "today";
          const label = invoice.kind === "deposit" ? "deposit" : "payment";
          // Plain hyphen, not an em dash -- keeps the subject itself pure
          // ASCII so there's nothing for encodeHeader to even need to do.
          const subject = `Receipt - ${money(invoice.total)} ${label} received`;
          const body =
            `Hi ${invoice.bill_to_name || "there"},\n\n` +
            `Invoice: ${invoice.invoice_number}\n` +
            `Amount received: ${money(invoice.total)} (${label})\n` +
            `Date: ${paidWhen}\n` +
            `${invoice.payment_method ? `Method: ${invoice.payment_method}\n` : ""}` +
            `\n${invoice.kind === "deposit" ? "Your booking is confirmed. " : ""}Keep this email as your receipt.\n\n` +
            `Thank you,\n${brand}`;
          await sendGmail(gmail.token, gmail.from, toEmail, subject, body);
          await supabase.from("invoices").update({ receipt_sent_at: new Date().toISOString() }).eq("id", invoice.id);
          results.receipt_sent = true;
        } else {
          results.receipt_sent = false;
          results.reason = "no Gmail connected";
        }
      } else {
        results.receipt_sent = false;
        results.reason = "no email on file";
      }
    } else {
      results.receipt_sent = "already sent";
    }

    return json({ ok: true, ...results });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
