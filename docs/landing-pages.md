# Landing page builder

Simple, form-based marketing/service pages you can create without a
separate website tool — org-scoped from day one for white-label, and
publicly rendered with no login required.

## Creating a page

Sidebar → **Landing Pages** → **+ New page**. Set a title (the slug
auto-fills from it, editable) and add content blocks:

- **Heading** — a large title line.
- **Paragraph** — body text.
- **Image** — an image URL + alt text.
- **Call-to-action button** — links to either:
  - the native booking page (`/book`), or
  - an inline lead-capture form (name/email/phone/message) that creates a
    **contact + opportunity**, landing in that org's default pipeline's
    first real stage — same records the rest of the pipeline uses, so a
    landing-page lead shows up on the board exactly like any other job.

Reorder blocks with ↑/↓ (no drag-and-drop in v1, per the ask). A page stays
a **draft** — invisible to the public — until you flip it to **Published**
and hit Save.

## Where it's live

`https://dispatch.ship2shorebooking.com/pages/<slug>` — e.g.
`/pages/twic-escort-long-beach`. Mobile-friendly, no sidebar/login, just the
page content. Slugs are globally unique (the public route resolves org_id
purely from the slug, so two orgs can't collide on one).

## Calendly / booking widget — unaffected

This feature touches none of `calendly-webhook`, `public-booking.js`, or
their routes. The CTA's "native booking page" option just links to the
existing `/book` widget; Calendly keeps working exactly as before, in
parallel.

## White-label readiness — the one thing done differently here

Every other public/webhook function in this app (`public-booking.js`,
`calendly-webhook`, both `gmail-sync` versions, etc.) hardcodes a single
org's UUID, because they were all built before multi-tenancy existed and
haven't been revisited yet (see `docs/white-label-foundation.md`).
**Landing pages are the first thing built org-aware from the start**:
`netlify/functions/public-landing-page.js` resolves `org_id` from the
`landing_pages` row itself, then looks up *that org's* default pipeline
and entry stage dynamically — no hardcoded pipeline/stage id. A second org
created via `/admin/orgs` can use landing pages immediately, no code
changes needed.

One subtlety worth knowing: stages can have negative `position` values for
pre-pipeline/administrative states (Ship2Shore has "Not Customs Cleared" at
-2, "Customs Cleared" at -1, before "New Booking" at 0) — a brand-new lead
shouldn't land there. The entry-stage lookup filters to `position >= 0`,
the same convention `Dashboard.jsx` already uses for "real" stages.

## Where things live

- `supabase/migrations/0009_landing_pages.sql` — the `landing_pages` table
  (org-scoped RLS, globally-unique `slug`, `blocks` as a JSONB array).
- `netlify/functions/public-landing-page.js` — public `get` (render) and
  `submit_lead` (lead-capture CTA) actions.
- `src/pages/LandingPages.jsx` — the list page.
- `src/pages/LandingPageEditor.jsx` — the block-based editor (create + edit).
- `src/pages/LandingPagePublic.jsx` — the public renderer at `/pages/:slug`.
- `src/lib/supabase.js` — `fetchLandingPages`, `fetchLandingPage`,
  `createLandingPage`, `updateLandingPage`, `deleteLandingPage`.

## What needs a decision from you

Nothing — this doesn't depend on any external credential or manual setup
step. It's usable as soon as it's deployed.
