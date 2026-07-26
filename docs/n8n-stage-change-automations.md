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

## The workflow is prebuilt — just import it

Import `n8n/ship2shore-stage-automations.json` (in this repo) into n8n. It already
contains the whole flow: **Webhook → Unwrap payload (Code) → Switch on `action` →
one branch each.**

| `action` | Trigger stage | Branch does |
|----------|---------------|-------------|
| `send_confirmation` | → Scheduled | Emails `contact.email` a confirmation with the Pacific `scheduled_at` |
| `notify_completed` | → Completed | Emails **Shawn** (shawncolbert1971@gmail.com) that the job is done |
| `log_paid` | → Paid | No-op node (nothing to send yet — a placeholder to build on) |
| `notify_canceled` | → Canceled | Emails **Shawn** with `contact.full_name` + `old_stage` (the stage it left) |

The three email nodes are **Gmail** nodes so they match the Gmail account you
already use. They ship without a credential attached — you pick yours on import.

### Setup steps (one time, ~5 min)
1. **Import:** n8n → *Workflows* → *Import from File* → choose
   `n8n/ship2shore-stage-automations.json`.
2. **Attach Gmail:** open each of the three email nodes
   (*Email customer confirmation*, *Notify Shawn — job completed*,
   *Notify Shawn — job canceled*) and select/create a **Gmail OAuth2** credential.
   (Prefer SMTP or Slack? Swap the node type — the field expressions carry over.)
3. **Activate** the workflow, then open the **Webhook** node and copy its
   **Production URL**.
4. **Point the Edge Function at it** — set the Supabase secret:
   `supabase secrets set N8N_STAGE_CHANGE_WEBHOOK_URL="https://<your-n8n>/webhook/ship2shore-stage-change"`
   (or Supabase Dashboard → Edge Functions → stage-change-webhook → Secrets).
5. **Test:** move a real card into **Scheduled** on the board and confirm the run
   appears in n8n and the confirmation email goes out.

> Until `N8N_STAGE_CHANGE_WEBHOOK_URL` holds a real URL, the Edge Function returns
> `{ "note": "…not set; event not forwarded", "eventPayload": {…} }` instead of
> forwarding — so you can inspect the exact payload in the function logs first.

> The "Unwrap payload" Code node exists because n8n delivers a POST body under
> `$json.body`; it lifts those fields to the top level so every downstream
> expression can read `{{ $json.contact.email }}`, `{{ $json.scheduled_at }}`, etc.
