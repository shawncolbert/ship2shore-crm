# Wave invoicing integration

Send an invoice straight from a pipeline card, get paid through Wave, and have
the job automatically move to **Paid** the moment Wave shows it paid — no
manual bookkeeping step.

## Does Wave support webhooks?

**Yes, but only on Wave's Pro plan.** Standard/Starter Wave subscriptions do
not get webhook delivery at all. Since I can't see which plan you're on, this
integration ships with **both**, so it works either way with nothing extra
for you to configure based on your plan:

1. **`wave-webhook`** (Edge Function) — if you're on Wave Pro, register this
   URL in Wave and payments are detected within seconds of Wave marking the
   invoice paid.
2. **`wave-payment-sync`** (scheduled function, same cron pattern as
   `gmail-sync`) — runs every 15 minutes and checks every open Wave invoice's
   real status directly with Wave's API. This is the fallback if you're not
   on Pro, and a safety net if a webhook delivery is ever missed.

Both call the exact same idempotent "mark paid" logic, so there's no risk of
double-processing if both happen to catch the same payment.

## What's automatic vs. what you need to do

✅ **Fully done, already deployed:**
- `opportunities.wave_invoice_id` / `opportunities.payment_status` columns (default `'unpaid'`), plus `contacts.wave_customer_id` to avoid creating duplicate Wave customers on repeat invoices.
- **Send invoice** button (💵 icon) on every pipeline card — creates/reuses a Wave customer for the contact, creates a Wave invoice for the job's dollar amount, emails it via Wave, and stores the invoice id. A badge on the card then shows *Invoice sent* / *Invoice paid*.
- `wave-webhook` Edge Function, deployed and reachable at:
  `https://ofntwhbbhujwyttmvlew.supabase.co/functions/v1/wave-webhook`
- `wave-payment-sync` Edge Function, deployed and already running on a 15-minute cron (`select cron.schedule('wave-payment-sync', ...)`).
- Marking an invoice paid moves the opportunity's `stage_id` to **Paid** — which also fires your existing stage-change automation rules (Part 1) for that stage, same as moving a card by hand.

🖐 **What you need to do — getting your Wave credentials:**

1. Log into [wave apps](https://my.waveapps.com), then open the **Developer Portal**: [developer.waveapps.com](https://developer.waveapps.com) → sign in with your Wave account.
2. **Business ID**: Go to *Manage Applications* (or the API playground) and look up your business — Wave shows a **Business ID** (a long ID string) for the business you invoice from. Copy it.
3. **API token**: In the Developer Portal, create a new application (or use the "Full-access token" option if Wave offers one for your account) and generate a **long-lived API token**. Copy it immediately — Wave usually only shows it once.
4. Set both as **Supabase Edge Function secrets** (not Netlify — the Wave calls run in Supabase Edge Functions, same place `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` already live):
   - Supabase Dashboard → your project → **Edge Functions** → **Secrets** → add:
     - `WAVE_API_TOKEN` = the token from step 3
     - `WAVE_BUSINESS_ID` = the ID from step 2
   - Or via the CLI: `supabase secrets set WAVE_API_TOKEN="..." WAVE_BUSINESS_ID="..."`
5. **If you're on Wave Pro and want instant payment detection**, also register the webhook:
   - Wave Business Portal → your business → **Webhooks** → **Add New Webhook**.
   - URL: `https://ofntwhbbhujwyttmvlew.supabase.co/functions/v1/wave-webhook`
   - Select the invoice/payment events. Wave will show a **webhook secret** — you don't need to save it for this integration to work (see note below), but keep it somewhere in case Wave requires it to activate the webhook.
   - If you're **not** on Pro, skip this step entirely — the 15-minute poller (`wave-payment-sync`) already covers you with no setup needed.

**Once WAVE_API_TOKEN and WAVE_BUSINESS_ID are set, the integration goes
live immediately — no code changes, no redeploy needed.** The next time you
click "Send invoice," or the next time the 15-minute poller runs, it'll just
start working.

## One thing to verify on your first real send

Wave's own documentation site was unreachable while this was built (it
blocked automated access), so the exact GraphQL field names for creating an
invoice were sourced from Wave's community/API reference discussions rather
than confirmed against their live schema. This was built defensively —
minimal, well-established fields only — but if Wave's schema differs on any
one field, the **first "Send invoice" click** after you add the credentials
will surface Wave's own error message (e.g. *"Wave GraphQL error: Field
'unitPrice' doesn't exist on type 'InvoiceItemInput'"*) rather than failing
silently. That message tells us exactly what to fix — send it over and it's
a one-line change in `supabase/functions/wave-send-invoice/index.ts` (and
the matching line in `wave-webhook`/`wave-payment-sync` if it's the shared
status-check query).

Similarly, the webhook payload shape is handled defensively: it tries
several common paths to find the invoice id in whatever Wave actually sends,
then re-fetches that invoice's real status from Wave's API rather than
trusting the webhook body directly. If a real webhook delivery ever shows up
as "ignored" in the logs, share one example payload and the extraction logic
is a quick fix.

## Where things live

- `supabase/functions/wave-send-invoice/` — "Send invoice" action (called from the Pipeline card, requires a logged-in user).
- `supabase/functions/wave-webhook/` — public webhook receiver (Wave Pro only).
- `supabase/functions/wave-payment-sync/` — scheduled poller, runs every 15 minutes regardless of Wave plan.
- `supabase/migrations/0006_wave_invoicing.sql` — schema changes.
