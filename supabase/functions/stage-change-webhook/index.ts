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

async function sendGmail(token: string, from: string, to: string, subject: string, body: string) {
  const raw = [
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body,
  ].join("\r\n");
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
    case "venmo": return `Please send ${amt} to ${handle} via Venmo${ref}.`;
    case "cashapp": return `Please send ${amt} to ${handle} via Cash App${ref}.`;
    case "apple_pay": return `Please send ${amt} to ${handle} via Apple Pay (Apple Cash)${ref}.`;
    default: return `Please send ${amt} to ${handle}${ref}.`;
  }
}
function buildPaymentRequestEmail(opts: { method: string; handle: string; amount: unknown; contactFirstName: string; jobTitle: string; jobRef: string }) {
  const label = PAYMENT_METHOD_LABEL[opts.method] || opts.method;
  const amt = money(opts.amount);
  const subject = `Payment request — ${amt}${opts.jobTitle ? ` for ${opts.jobTitle}` : ""}`;
  const body =
    `Hi ${opts.contactFirstName || "there"},\n\n` +
    `${opts.jobTitle ? `For your Ship2Shore job (${opts.jobTitle}), the ` : "The "}amount due is ${amt}.\n\n` +
    `${paymentInstructions(opts.method, opts.handle, opts.amount, opts.jobRef)}\n\n` +
    `${label}: ${opts.handle}\n\n` +
    `Thank you,\nShip2Shore Dispatch`;
  return { subject, body };
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
      .select("id, title, value, scheduled_at, service_code, port, billing_number, payment_method_requested")
      .eq("id", opportunity_id).eq("org_id", org_id).maybeSingle();
    const { data: contact } = await supabase
      .from("contacts").select("id, full_name, email, phone").eq("id", contact_id).eq("org_id", org_id).maybeSingle();

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
          const subject = render(rule.email_subject || "Update on your Ship2Shore booking", vars);
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
          const { subject, body } = buildPaymentRequestEmail({
            method, handle, amount: opp?.value,
            contactFirstName: vars.first_name, jobTitle: opp?.title || "",
            jobRef: opp?.billing_number || opp?.title || "",
          });
          await sendGmail(gmail.token, gmail.from, contact.email, subject, body);
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
