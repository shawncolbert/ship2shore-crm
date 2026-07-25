# Pipeline stage-change → n8n automations

## How it fires (all server-side, already wired)

```
Move a card on the pipeline board
  → UPDATE opportunities SET stage_id = …           (client)
  → trg_notify_stage_change  (AFTER UPDATE trigger)  (Postgres)
  → notify_stage_change()    pg_net POST            (Postgres)
  → stage-change-webhook     Edge Function          (Supabase)  ← enriches + maps action
  → n8n webhook              N8N_STAGE_CHANGE_WEBHOOK_URL        ← you build the workflow
```

Any stage change fires this. The Edge Function only forwards transitions that
map to an action (see below); everything else returns `{ "skipped": true }`.

## Payload n8n receives

```jsonc
{
  "action": "send_confirmation",       // send_confirmation | notify_completed | log_paid | notify_canceled
  "opportunity_id": "…uuid…",
  "org_id": "…uuid…",
  "old_stage": "new_booking",          // normalized stage name it moved FROM
  "new_stage": "scheduled",            // normalized stage name it moved TO
  "scheduled_at": "2026-07-28T17:00:00+00:00",  // UTC ISO, or null
  "title": "Albert - Diamond Transport (BMW pickup)",
  "value": 700,
  "service_code": "twic_escort",
  "port": "long_beach",
  "contact": { "id": "…", "full_name": "Albert", "email": "…", "phone": "+1…" }
}
```

Convert `scheduled_at` to Pacific for display in n8n:
`{{ $json.scheduled_at ? DateTime.fromISO($json.scheduled_at).setZone('America/Los_Angeles').toFormat('LLL d, h:mm a') : '' }}`

## What needs to be built in n8n (manual — no workflow files in this repo)

There is no n8n API/credential wired into this repo, so the workflow itself is
built once in the n8n UI. Structure: **Webhook node → Switch on `{{ $json.action }}` → one branch each.**

| `action` | Trigger stage | Branch does |
|----------|---------------|-------------|
| `send_confirmation` | → Scheduled | Email `contact.email` a confirmation with the Pacific `scheduled_at` |
| `notify_completed` | → Completed | Slack/email **Shawn** that the job is done (include `title`, `contact.full_name`) |
| `log_paid` | → Paid | No action yet — just log (e.g. append to a sheet / no-op) |
| `notify_canceled` | → Canceled | Notify **Shawn**: `contact.full_name` + `old_stage` (the stage it was in) |

### Setup steps
1. In n8n, create a workflow with a **Webhook** (POST) trigger. Copy its production URL.
2. Set the Supabase secret so the Edge Function forwards to it:
   `supabase secrets set N8N_STAGE_CHANGE_WEBHOOK_URL="https://<your-n8n>/webhook/…"`
   (or set it in Supabase Dashboard → Edge Functions → stage-change-webhook → Secrets).
3. Add a **Switch** node keyed on `{{ $json.action }}` with the four cases above.
4. Build each branch (Gmail/SMTP for emails, Slack node for Shawn's alerts).
5. Test: move a real card into **Scheduled** on the board and confirm the webhook run in n8n.

> Until `N8N_STAGE_CHANGE_WEBHOOK_URL` holds a real URL, the Edge Function returns
> `{ "note": "…not set; event not forwarded", "eventPayload": {…} }` instead of
> forwarding — so you can inspect the exact payload in the function logs first.
