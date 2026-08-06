# Completion video → auto-post to TikTok/Instagram

## How it fires (all server-side, already wired)

```
Dispatcher uploads a completion video on a "Completed"-stage job card
  → INSERT attachments (kind='completion_video', gate_status='outside_gate')  (client)
  → trg_notify_completion_video   (AFTER INSERT trigger)                     (Postgres)
  → notify_completion_video()     pg_net POST                                (Postgres)
  → completion-video-webhook      Edge Function                              (Supabase)  ← re-checks gate_status, signs the video URL, maps client_type
  → n8n webhook                   N8N_COMPLETION_VIDEO_WEBHOOK_URL            ← you build the workflow
```

**The safety gate is enforced twice, not once:**
1. The Postgres trigger only calls the webhook at all when `gate_status = 'outside_gate'`.
   `inside_gate` and untagged videos never leave the database — confirmed by
   testing: inserting an `inside_gate` row produces zero webhook calls.
2. The Edge Function re-checks the same condition against the database row
   directly (not the trigger's claim) before doing anything else.
3. The n8n workflow's **Content safety check** IF node checks it a third
   time against the payload itself, and routes anything that fails that
   check to a Slack "needs manual review" message instead of posting.

There is no path from an `inside_gate` video to a public post.

## Payload n8n receives

```jsonc
{
  "client_type": "Military/PCS",        // Military/PCS | Trucking | Dispatcher | Private -- mapped from contacts.segment
  "port": "long_beach",
  "vehicle": "2022 Toyota Tacoma",       // from opportunities.vehicle (dispatcher fills in on the job card)
  "job_ref": "TWIC-18009207479",         // billing_number, falling back to bl_number, then title
  "date": "2026-08-06",
  "video_url": "https://…signed url, valid 24h…",
  "video_tag": "outside-gate",           // always this value -- the trigger only ever fires for outside_gate
  "opportunity_id": "…uuid…",
  "org_id": "…uuid…"
}
```

`client_type` mapping from `contacts.segment`: `military` → Military/PCS,
`transporter` → Trucking, `dispatcher` → Dispatcher, everything else
(`broker`/`private`/`other`/unset) → Private.

## The workflow is prebuilt — just import it

Import `n8n/ship2shore-completion-video-posting.json` (in this repo). It contains:
**Webhook → Unwrap payload (Code) → Content safety check (IF) → Caption Generator (Code) →
Post to Metricool/Buffer (HTTP Request) → Post succeeded? (IF) → Slack confirmation / Slack alert.**

| Node | Does |
|------|------|
| Content safety check | Re-verifies `video_tag === 'outside-gate'`; false branch → Slack manual-review message instead of posting |
| Caption Generator | Builds the caption by `client_type` tone, always appends the Calendly link + `(310) 748-0040` |
| Post to Metricool/Buffer | Sends caption + video_url + platform flags to your Metricool or Buffer account |
| Slack confirmation | Posts "Queued: [job_ref] social post ready" to `#completed-jobs` |
| Slack alert — post failed | DMs you directly if the HTTP request didn't succeed — never a silent failure |

### Setup steps (one time)
1. **Import:** n8n → *Workflows* → *Import from File* → choose
   `n8n/ship2shore-completion-video-posting.json`.
2. **Attach Slack:** open *Slack confirmation*, *Slack alert — post failed*, and
   *Slack — manual review queue*, and select/create a **Slack** credential.
   Set your own Slack member ID on the *Slack alert — post failed* node (it DMs
   you directly) and confirm `#completed-jobs` exists in your workspace.
3. **Attach Metricool/Buffer:** open *Post to Metricool/Buffer*, replace the
   placeholder URL with your actual Metricool or Buffer post endpoint, and
   attach your API credential. Their docs define the exact body shape their
   API expects for a TikTok/Instagram post — adjust the `jsonBody` expression
   to match if it differs from the caption/video_url/platforms shape here.
4. **Activate** the workflow, then open the **Webhook** node and copy its
   **Production URL**.
5. **Point the Edge Function at it** — set the Supabase secret:
   `supabase secrets set N8N_COMPLETION_VIDEO_WEBHOOK_URL="https://<your-n8n>/webhook/ship2shore-completion-video"`
   (or Supabase Dashboard → Edge Functions → completion-video-webhook → Secrets).
6. **Test:** on a job in a "Completed"-flagged stage, use the **Completion
   video** uploader on the card, tag it **Outside gate**, and confirm the run
   appears in n8n and the Slack confirmation lands in `#completed-jobs`.

> Until `N8N_COMPLETION_VIDEO_WEBHOOK_URL` holds a real URL, the Edge Function
> returns `{ "note": "…not set; event not forwarded", "payload": {…} }` instead
> of forwarding — so you can inspect the exact payload in the function logs first.

> **This is genuinely new infrastructure**, not a small tweak: the video
> upload UI, the `job-videos` storage bucket, the `outside_gate`/`inside_gate`
> tagging, the Postgres trigger, and the Edge Function are all new. What's
> been verified end-to-end against the live database: the trigger fires for
> `outside_gate` and correctly never fires for `inside_gate`, and the payload
> the Edge Function builds matches the shape above. What hasn't been
> verified yet, because it depends on accounts only you can set up: an actual
> Metricool/Buffer post landing on TikTok, since that requires your own
> Metricool/Buffer credentials in step 3.
