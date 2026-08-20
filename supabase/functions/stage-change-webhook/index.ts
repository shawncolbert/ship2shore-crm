import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Fired by the `trg_notify_stage_change` trigger on public.opportunities.
// Reads user-configurable rules from public.automation_rules and runs the
// matching action IN-APP (send customer email / notify internally / send a
// manual payment request / log), using the org's connected Gmail. Editing
// rules in the Automations settings page changes behaviour immediately --
// no code or n8n changes needed.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const eq = (a?: string | null, b?: string | null) =>
  (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

// Scheduled time in Pacific, e.g. "Tuesday, Jul 28, 2026 at 10:00 AM".
function fmtPacific(iso?: string | null): string {
  if (!iso) return "a time we’ll confirm shortly";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    }) + " Pacific";
  } catch { return iso; }
}

function render(tpl: string, vars: Record<string, string>): string {
  return (tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ""));
}

function b64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Email headers (unlike the body) don't get a charset declaration -- a raw
// UTF-8 character like an em dash sitting directly in "Subject: ..." comes
// through as mojibake in the inbox. RFC 2047 encoded-word is the fix: wrap
// any non-ASCII subject as base64 inside =?UTF-8?B?...?=.
function encodeHeader(text: string): string {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

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

// `html` is optional -- send_customer_email/notify_internal keep sending a
// single plain-text part exactly as before; only send_payment_request passes
// html, for a styled card/button instead of a wall of text.
async function sendGmail(token: string, from: string, to: string, subject: string, body: string, html?: string) {
  let raw: string;
  if (html) {
    const boundary = `s2s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    raw = [
      `From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
      `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "", body,
      `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "", html,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    raw = [
      `From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body,
    ].join("\r\n");
  }
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  if (!res.ok) throw new Error("gmail send failed: " + (await res.text()));
  return await res.json();
}

// Manual payment requests (Zelle/Venmo/Cash App/Apple Pay) -- mirrors
// src/lib/paymentRequest.js on the client. None of these four have an API,
// so there's no way to detect payment automatically either way; a
// dispatcher confirms and moves the card to Paid by hand.
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  zelle: "Zelle", venmo: "Venmo", cashapp: "Cash App", apple_pay: "Apple Pay",
};
const money = (n: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
function paymentInstructions(method: string, handle: string, amount: unknown, jobRef: string): string {
  const amt = money(amount);
  const ref = jobRef ? ` — please include "${jobRef}" in the memo/note` : "";
  switch (method) {
    case "zelle": return `Please send ${amt} to ${handle} via Zelle${ref}.`;
    case "venmo": return `Please send ${amt} via Venmo${ref}: ${venmoLink(handle, amount)}`;
    case "cashapp": return `Please send ${amt} via Cash App${ref}: ${cashAppLink(handle, amount)}`;
    case "apple_pay": return `Please send ${amt} to ${handle} via Apple Pay (Apple Cash)${ref}.`;
    default: return `Please send ${amt} to ${handle}${ref}.`;
  }
}
function venmoLink(handle: string, amount: unknown): string {
  const clean = String(handle || "").replace(/^@/, "").trim();
  return `https://venmo.com/u/${encodeURIComponent(clean)}?amount=${encodeURIComponent(Number(amount) || 0)}`;
}
function cashAppLink(handle: string, amount: unknown): string {
  const clean = String(handle || "").replace(/^\$/, "").trim();
  return `https://cash.app/$${encodeURIComponent(clean)}/${encodeURIComponent(Number(amount) || 0)}`;
}
const hasPayLink = (method: string) => method === "venmo" || method === "cashapp";
const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]));

// Inline-styled, table-based HTML -- identical design to
// src/lib/paymentRequest.js's buildHtmlBody() so the email looks the same
// whether it was sent by a dispatcher's click or this automation.
function buildHtmlBody(opts: { method: string; handle: string; amount: unknown; contactFirstName: string; jobTitle: string; jobRef: string; orgName: string }): string {
  const amt = money(opts.amount);
  const label = PAYMENT_METHOD_LABEL[opts.method] || opts.method;
  const greeting = escapeHtml(opts.contactFirstName || "there");
  const brand = opts.orgName || "Dispatch";
  const jobLine = opts.jobTitle
    ? `For your ${escapeHtml(opts.orgName || "your")} job (${escapeHtml(opts.jobTitle)}), the amount due is:`
    : "The amount due is:";
  const refLine = opts.jobRef
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;">Please include <strong>${escapeHtml(opts.jobRef)}</strong> in the memo/note.</p>`
    : "";

  let actionBlock: string;
  if (hasPayLink(opts.method)) {
    const url = opts.method === "venmo" ? venmoLink(opts.handle, opts.amount) : cashAppLink(opts.handle, opts.amount);
    actionBlock = `
      <tr><td align="center" style="padding:8px 0 4px;">
        <a href="${url}" style="display:inline-block;background:#e8a317;color:#1a1a1a;font-weight:700;font-size:16px;text-decoration:none;padding:14px 32px;border-radius:10px;">
          Pay ${amt} with ${escapeHtml(label)}
        </a>
      </td></tr>
      <tr><td align="center" style="padding:6px 0 0;">
        <p style="margin:0;font-size:12px;color:#9ca3af;word-break:break-all;">${url}</p>
      </td></tr>`;
  } else {
    actionBlock = `
      <tr><td style="padding:8px 0 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6e8;border:2px solid #e8a317;border-radius:12px;">
          <tr><td align="center" style="padding:22px 20px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a6d1a;">Send via ${escapeHtml(label)}</div>
            <div style="margin-top:8px;font-size:26px;font-weight:700;color:#1a1a1a;">${escapeHtml(opts.handle)}</div>
            <div style="margin-top:6px;font-size:14px;color:#4b5563;">Amount: <strong>${amt}</strong></div>
          </td></tr>
        </table>
      </td></tr>`;
  }

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="background:#1a1a1a;padding:18px 28px;">
        <span style="color:#e8a317;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">${escapeHtml(brand)}</span>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;">
        <p style="margin:0 0 4px;font-size:15px;color:#1a1a1a;">Hi ${greeting},</p>
        <p style="margin:0;font-size:15px;color:#1a1a1a;">${jobLine}</p>
        <p style="margin:6px 0 0;font-size:32px;font-weight:700;color:#1a1a1a;">${amt}</p>
      </td></tr>
      <tr><td style="padding:4px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${actionBlock}</table>
        ${refLine}
      </td></tr>
      <tr><td style="padding:24px 28px 28px;">
        <p style="margin:0;font-size:13px;color:#9ca3af;">Thank you,<br>${escapeHtml(brand)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function buildPaymentRequestEmail(opts: { method: string; handle: string; amount: unknown; contactFirstName: string; jobTitle: string; jobRef: string; orgName: string }) {
  const label = PAYMENT_METHOD_LABEL[opts.method] || opts.method;
  const amt = money(opts.amount);
  const brand = opts.orgName || "Dispatch";
  const subject = `Payment request — ${amt}${opts.jobTitle ? ` for ${opts.jobTitle}` : ""}`;
  const body =
    `Hi ${opts.contactFirstName || "there"},\n\n` +
    `${opts.jobTitle ? `For your ${opts.orgName || "your"} job (${opts.jobTitle}), the ` : "The "}amount due is ${amt}.\n\n` +
    `${paymentInstructions(opts.method, opts.handle, opts.amount, opts.jobRef)}\n\n` +
    `${label}: ${opts.handle}\n\n` +
    `Thank you,\n${brand}`;
  const html = buildHtmlBody(opts);
  return { subject, body, html };
}

Deno.serve(async (req: Request) => {
  try {
    const { opportunity_id, contact_id, org_id, old_stage_id, new_stage_id } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve the from/to stage display names.
    const ids = [old_stage_id, new_stage_id].filter(Boolean);
    const { data: stages } = await supabase.from("stages").select("id, name").in("id", ids);
    const nameById: Record<string, string> = {};
    (stages || []).forEach((s: any) => { nameById[s.id] = s.name; });
    const old_stage = nameById[old_stage_id] || "";
    const new_stage = nameById[new_stage_id] || "";

    // Matching enabled rules for this transition.
    const { data: rules } = await supabase
      .from("automation_rules").select("*").eq("org_id", org_id).eq("enabled", true)
      .order("position", { ascending: true });
    const matched = (rules || []).filter((r: any) =>
      eq(r.to_stage, new_stage) && (!r.from_stage || eq(r.from_stage, old_stage)));

    if (matched.length === 0) return json({ skipped: true, old_stage, new_stage });

    // Scoped to org_id: opportunity_id/contact_id are only trustworthy paired
    // with the org that actually owns them -- without this, a caller could
    // supply their own org_id (so gmail/payment settings resolve correctly)
    // together with another tenant's opportunity_id/contact_id and have that
    // tenant's job/contact data read out and emailed to an attacker-chosen
    // address.
    const { data: opp } = await supabase
      .from("opportunities")
      .select("id, title, value, deposit_amount, scheduled_at, service_code, port, billing_number, payment_method_requested")
      .eq("id", opportunity_id).eq("org_id", org_id).maybeSingle();
    const { data: contact } = await supabase
      .from("contacts").select("id, full_name, email, phone").eq("id", contact_id).eq("org_id", org_id).maybeSingle();
    const { data: org } = await supabase.from("organizations").select("name").eq("id", org_id).maybeSingle();
    const orgName = org?.name;

    const fullName = contact?.full_name || "there";
    const vars: Record<string, string> = {
      first_name: fullName.split(/\s+/)[0] || "there",
      full_name: fullName,
      scheduled_at: fmtPacific(opp?.scheduled_at),
      title: opp?.title || "",
      title_suffix: opp?.title ? ` — ${opp.title}` : "",
      port: opp?.port || "",
      value: opp?.value != null ? String(opp.value) : "",
      service_code: opp?.service_code || "",
      old_stage, new_stage,
    };

    let gmail: { token: string; from: string } | null = null;
    let paymentSettings: any = undefined; // undefined = not fetched yet, null = fetched but none exists
    const results: any[] = [];

    for (const rule of matched) {
      try {
        if (rule.action === "log_only") {
          results.push({ action: "log_only", ok: true });
        } else if (rule.action === "send_customer_email") {
          if (!contact?.email) { results.push({ action: rule.action, ok: false, reason: "contact has no email" }); continue; }
          gmail = gmail || await gmailAccessToken(supabase, org_id);
          if (!gmail) { results.push({ action: rule.action, ok: false, reason: "no Gmail connected" }); continue; }
          const subject = render(rule.email_subject || `Update on your ${orgName || ""} booking`.replace(/\s+/g, " ").trim(), vars);
          const body = render(rule.email_body || "", vars);
          await sendGmail(gmail.token, gmail.from, contact.email, subject, body);
          results.push({ action: rule.action, ok: true, to: contact.email });
        } else if (rule.action === "notify_internal") {
          gmail = gmail || await gmailAccessToken(supabase, org_id);
          if (!gmail) { results.push({ action: rule.action, ok: false, reason: "no Gmail connected" }); continue; }
          const subject = `Job ${new_stage}: ${fullName}`;
          const body =
            `A job moved to ${new_stage}${old_stage ? ` (from ${old_stage})` : ""}.\n\n` +
            `Customer: ${fullName}\n` +
            `Job: ${opp?.title || opp?.service_code || "Job"}\n` +
            `Port: ${opp?.port || "—"}\n` +
            `Value: $${opp?.value ?? 0}\n` +
            `Phone: ${contact?.phone || "—"}\n` +
            `Email: ${contact?.email || "—"}`;
          await sendGmail(gmail.token, gmail.from, gmail.from, subject, body);
          results.push({ action: rule.action, ok: true, to: gmail.from });
        } else if (rule.action === "send_payment_request") {
          if (!contact?.email) { results.push({ action: rule.action, ok: false, reason: "contact has no email" }); continue; }
          if (paymentSettings === undefined) {
            const { data: ps } = await supabase.from("payment_settings").select("*").eq("org_id", org_id).maybeSingle();
            paymentSettings = ps || null;
          }
          const method = opp?.payment_method_requested || paymentSettings?.default_method;
          if (!method) { results.push({ action: rule.action, ok: false, reason: "no payment method requested yet and no default method set" }); continue; }
          const handle = paymentSettings?.[`${method}_handle`];
          if (!handle) { results.push({ action: rule.action, ok: false, reason: `no ${method} handle set in Payment Settings` }); continue; }
          gmail = gmail || await gmailAccessToken(supabase, org_id);
          if (!gmail) { results.push({ action: rule.action, ok: false, reason: "no Gmail connected" }); continue; }
          const { subject, body, html } = buildPaymentRequestEmail({
            method, handle, amount: Math.max(0, (Number(opp?.value) || 0) - (Number(opp?.deposit_amount) || 0)),
            contactFirstName: vars.first_name, jobTitle: opp?.title || "",
            jobRef: opp?.billing_number || opp?.title || "", orgName: orgName || "",
          });
          await sendGmail(gmail.token, gmail.from, contact.email, subject, body, html);
          await supabase.from("opportunities")
            .update({ payment_requested_at: new Date().toISOString(), payment_method_requested: method })
            .eq("id", opportunity_id);
          results.push({ action: rule.action, ok: true, to: contact.email, method });
        }

        // Timeline entry for the audit trail.
        await supabase.from("activities").insert({
          org_id, contact_id,
          type: "automation",
          body: `Automation: ${rule.action} on ${new_stage}`,
        });
      } catch (e) {
        results.push({ action: rule.action, ok: false, reason: String(e) });
      }
    }

    return json({ ok: true, old_stage, new_stage, results });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
