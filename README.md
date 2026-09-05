# Ship2Shore Dispatch

A HighLevel-style CRM for Ship2Shore Booking: contacts, a drag-and-drop job
pipeline, a unified inbox, and a dashboard. React (Vite) + Supabase, with
Netlify Functions for the email backend.

## Setup

1. **Run the schema** — Supabase → SQL Editor → paste `ship2shore_crm_schema.sql` → Run.
2. **Client keys** — copy `.env.example` → `.env`, fill the `VITE_` values.
3. **Install & run**
   ```
   npm install
   npm run dev            # app only
   # or, to run the email functions too:
   npx netlify dev        # app + Netlify Functions on one port
   ```
4. **Link your account** — sign in (magic link), then run the two commented
   INSERTs at the bottom of the schema to make yourself owner of Ship2Shore.

## The inbox (email)

The inbox shows email conversations tied to your contacts. SMS is built into
the UI but dormant — it stays off until a compliant Ship2Shore number exists
(the Twilio number is registered to Whaley Inc. and can't be reused here).

Two Netlify functions power it:
- `send-email` — sends your replies through Gmail and logs them.
- `gmail-sync` — every 10 min, pulls new mail to/from known contacts into the
  inbox. It only syncs threads with people already in Contacts, so import your
  contacts first (see the import tool). New senders sync once added as contacts.

### Connecting Gmail (one time)

1. Google Cloud Console → create a project → enable the **Gmail API**.
2. **OAuth consent screen** → External → add yourself as a test user.
3. **Credentials** → create an **OAuth client ID** (type: Web app). Add
   `https://developers.google.com/oauthplayground` as an authorized redirect URI.
   Copy the **Client ID** and **Client secret**.
4. Go to **OAuth 2.0 Playground** (developers.google.com/oauthplayground):
   - Gear icon → check "Use your own OAuth credentials" → paste client id/secret.
   - Authorize these scopes:
     `https://www.googleapis.com/auth/gmail.send`
     `https://www.googleapis.com/auth/gmail.readonly`
   - Exchange the code → copy the **refresh token**.
5. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `GMAIL_ADDRESS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `ORG_ID` into
   Netlify → Site settings → Environment (and into `.env` for local dev).

## Deploy to Netlify

- Push to a Git repo → Netlify → New site from repo. Build: `npm run build`,
  publish: `dist`. `netlify.toml` wires the functions and the sync schedule.
- Add every server var above in Netlify's Environment settings.
- Supabase → Authentication → URL Configuration → add your Netlify URL as a
  redirect URL so magic links work in production.

### Setting up a new client's own site

Every org lives in the same Supabase database (`organizations` table, RLS
keeps each org's data to itself) — this section is only about giving one
client their own look: their own name on the login screen, browser tab,
and phone home-screen icon instead of Ship2Shore's.

1. Netlify → **Add new site → Import an existing project** → same Git repo,
   new site. (Not a new repo — one codebase, many sites.)
2. That new site's **Environment variables**: everything under "Server" and
   the first two "Client" vars above, same as any other site, *plus*:
   - `VITE_APP_NAME` — e.g. `Acme Dispatch`
   - `VITE_APP_SHORT_NAME` — e.g. `Acme` (home-screen icon label — keep it short)
   - `VITE_APP_DESCRIPTION` — one line, shown when they install the app
   - `VITE_APP_THEME_COLOR` — hex code for the browser/status-bar chrome color
3. Icons don't come from an env var (they're image files, not text) — before
   this site's first deploy, swap the client's own PNGs into
   `public/icons/` (same five filenames: `favicon-32.png`,
   `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`,
   `maskable-icon-512.png`) on whatever branch/checkout that site builds
   from.
4. Point the client's domain at the new site (Netlify → Domain management),
   then add that domain as a Supabase redirect URL (step above) too.
5. Leave the *original* ship2shorebooking.com site's env vars alone —
   nothing under `VITE_APP_*` should ever be set there, since it's still
   shared by every org that doesn't have its own site yet.

## What's built

- Magic-link auth
- Contacts: list + segment filters + search, contact detail
- Pipeline: drag-and-drop Kanban, saved live
- Inbox: unified email conversations, live-updating, reply from the thread
- Dashboard: job counts + revenue

### Ask AI (floating widget) — same brain as the full-page AI Assistant

`src/components/AskAIWidget.jsx` (the floating bubble, bottom-right on
every page) and `/agent` (`src/pages/Agent.jsx`, a dedicated page) are two
entry points into the exact same backend: `netlify/functions/agent-controller.js`.
There is no separate lower-privilege "read-only" version — both call the
same endpoint with the same `{ userPrompt, conversationHistory }` /
`{ reply, conversationHistory, clientEvents }` contract, so the widget can
do anything the Assistant page can: create/update/delete contacts and
opportunities, move pipeline stages, send customer emails for real, look
up a carrier's FMCSA registration by DOT number, schedule an appointment,
and draft or schedule a social post. Actions happen when asked — there's
no separate confirm-before-acting step beyond what `/agent` already had.

The widget adds one convenience `/agent` doesn't need: when open on a
`/contacts/:id` page it auto-detects that contact's ID from the URL and
prepends it to the prompt as context, so "draft a follow-up to this
person" resolves without re-typing who. It also remembers open/closed
state per browser tab (`sessionStorage`), independent of the Assistant page.

`orgId` is always resolved server-side from the authenticated session
(`userFromToken` → `orgForUser`) inside `agent-controller.js`, never
trusted from the client — the same tenant-isolation approach every other
function in this repo uses.

**Tools available to the assistant** (`buildAgentTools()` in
`agent-controller.js`), beyond contact/opportunity/pipeline/email actions:

- `lookup_carrier` — pulls a motor carrier's real FMCSA registration
  (legal name, address, operating authority, insurance filings) from
  `motus.dot.gov`, keyed by **USDOT number** (not MC/docket number — a
  different FMCSA identifier the endpoint doesn't accept directly). Shared
  logic lives in `netlify/functions/_shared/fmcsaLookup.js`, reused as-is
  by the standalone Lead Finder feature (`fmcsa-insurance.js`).
- `create_appointment` — books a calendar time slot (`appointments`
  table), optionally linked to an existing contact/opportunity. Separate
  from `create_opportunity` (the pipeline job record itself).
- `create_social_post` — drafts or schedules a post the same way
  Settings > Social Posts' own "Create Post" does. The assistant can't
  attach a photo/video itself — it can only reference one by URL if the
  user already uploaded it and shared the link; auto-publishing to TikTok
  requires that URL, otherwise the post is saved as a draft.

## Next

- Gmail enrichment for contacts (phones from signatures, sharper segments)
- Booking PWA + Calendly feeding jobs into the pipeline
- n8n automations on stage changes (Wave invoice, follow-ups)
- White-label client onboarding
