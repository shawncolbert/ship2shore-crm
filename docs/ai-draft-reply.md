# AI draft-reply agent (draft-only, human-approved)

Drafts suggested email replies in the unified inbox and suggests a lead
qualification note on brand-new contacts. **It never sends anything and
never touches an opportunity's stage.** A human always clicks Send.

## Locked tone rules (2026-08-23)

Four situations get specific, non-negotiable handling in every draft:

- **Quotes** — relays whatever's already on file (`confirmed_price` or
  `value`), never calculates or invents a number. No quote on file yet →
  says one's being put together, doesn't guess.
- **Driver availability** — never states availability as confirmed. There's
  no live signal for this yet (see Agent 2 below), so every availability
  question gets a holding reply ("let me confirm and get right back to
  you"), never a yes/no.
- **"I found it cheaper"** — always a counter-attempt: asks what price they
  were quoted, offers to see what can be worked out. Never just lets the
  lead go.
- **Delivery status / ETA** — a professional holding message unless a real
  `scheduled_at` date is on file, in which case it's fine to state it.

All of this stays draft-only for now, including for old/Escort-segment
clients — the build brief allows autonomous (no-approval) sending for
escort-side replies once the drafting is proven reliable, but that's a
separate, deliberate change to make later, not turned on by default the
moment these rules shipped.

## What it does

Every 10 minutes, `netlify/functions/ai-draft-reply.js` runs and, for every
email conversation where the customer's message is the most recent one (i.e.
nobody's replied yet):

1. Sends the recent thread to Claude and asks for a short, professional
   reply.
2. Inserts that reply into `messages` as `status: 'draft'`, `ai_generated:
   true` — it shows up inline in the Inbox thread as a dashed "AI draft — not
   sent yet" card, pre-loaded into an editable box with **Send** and
   **Discard** buttons. Editing the box *is* the "Edit" step — there's
   nothing separate to toggle into.
3. Clicking **Send** sends the (possibly edited) text through the same
   `send-email` function every other reply in this app uses, then removes
   the draft row. Clicking **Discard** just removes it — nothing goes out.

If the customer's message is the very first message ever in that
conversation and the contact doesn't already have a note, it also asks
Claude for a one-sentence lead-qualification summary (e.g. "Requesting TWIC
escort at Long Beach, appears to be a broker inquiry") and writes it to
`contacts.notes`, prefixed `[AI suggested]` so it's clearly distinguishable
from anything a person typed. This only ever fires when `notes` is empty —
it will never overwrite something a dispatcher already wrote.

**It only ever writes to `messages.status = 'draft'` and, conditionally, to
`contacts.notes`.** It never creates or moves an opportunity, never changes
a stage, and never calls Gmail's send API itself.

## What needs a decision from you

**Set `ANTHROPIC_API_KEY` as a Netlify environment variable.** Without it,
`ai-draft-reply` runs every 10 minutes, fails immediately (missing key), and
does nothing else — no drafts, no crash reports, no side effects. Once the
key is set and the next deploy/scheduled run happens, drafting starts
automatically; no further code changes needed.

Get a key from [console.anthropic.com](https://console.anthropic.com) →
API Keys, then in Netlify: Site settings → Environment variables → add
`ANTHROPIC_API_KEY`.

## Where things live

- `netlify/functions/ai-draft-reply.js` — the scheduled job (`*/10 * * * *`,
  set in `netlify.toml`, same cadence as `gmail-sync`).
- `netlify/functions/_shared/anthropic.js` — a small `fetch`-based Claude
  client (no SDK dependency, matching how `_shared/google.js` calls Gmail).
- `src/pages/Inbox.jsx` — `AiDraftCard` renders the pending draft; `Thread`
  splits `messages` into `sentMessages` (normal bubbles) and the one live
  `draft` row.
- `src/lib/supabase.js` — `deleteMessage(id)`, used to remove a draft once
  it's sent (superseded by the real sent-message row `send-email` inserts)
  or discarded.
