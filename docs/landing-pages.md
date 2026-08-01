# Landing page builder

Marketing/service pages you can create without a separate website tool —
org-scoped from day one for white-label, and publicly rendered with no
login required. The editor is a **real visual canvas**: what you see while
building is exactly what ships, not a form with fields off to the side.

## Creating a page

Sidebar → **Landing Pages** → **+ New page**. The canvas opens styled
exactly like the live page (dark header, white card). Hover between any two
blocks (or above the first / below the last) to reveal a **+** — click it to
insert a block right there, from seven types:

- **Heading** / **Paragraph** — click directly on the text to edit it in place.
- **Image** — click to add a URL + alt text; shows the real image once set.
- **Video** — paste a normal YouTube/Vimeo watch link; it's converted to an
  embeddable player automatically.
- **Button** (CTA) — renders as the actual amber button, label editable
  inline, linking to either:
  - the native booking page (`/book`), or
  - an inline lead-capture form (name/email/phone/message) that creates a
    **contact + opportunity**, landing in that org's default pipeline's
    first real stage — same records the rest of the pipeline uses, so a
    landing-page lead shows up on the board exactly like any other job.
- **Divider** / **Spacer** — a rule line, or adjustable vertical space (S/M/L).

Hover any block for its controls: a drag handle (⠿) to reorder by dragging,
plus ↑/↓ and ✕ as a reliable fallback. A page stays a **draft** — invisible
to the public — until you flip it to **Published** and hit Save.

This is a scoped v1 toward a fuller ClickFunnels/GrooveFunnels-style builder
(per your explicit direction: canvas editing first, internal tool only for
now, built outward in stages). It's still block-based, not freeform
drag-anywhere-on-a-grid positioning — that's a much larger lift (storing
x/y/width/height per element, resize handles, responsive behavior) and is a
natural next slice once this one's been used for a while. Multi-step funnel
sequences (opt-in → thank-you → upsell) are a separate future slice too.

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
  (org-scoped RLS, globally-unique `slug`, `blocks` as a JSONB array). No
  migration needed for the new block types (video/divider/spacer) — jsonb
  doesn't require a schema change.
- `netlify/functions/public-landing-page.js` — public `get` (render) and
  `submit_lead` (lead-capture CTA) actions.
- `src/lib/landingBlocks.js` — shared block-type metadata + the YouTube/Vimeo
  embed-URL conversion, used identically by the editor and the public
  renderer so a video looks the same in both places.
- `src/pages/LandingPages.jsx` — the list page.
- `src/pages/LandingPageEditor.jsx` — the canvas editor (create + edit):
  drag-and-drop reordering (native HTML5 DnD, no new dependency), inline
  editing, insert-anywhere.
- `src/pages/LandingPagePublic.jsx` — the public renderer at `/pages/:slug`.
- `src/lib/supabase.js` — `fetchLandingPages`, `fetchLandingPage`,
  `createLandingPage`, `updateLandingPage`, `deleteLandingPage`.

## What needs a decision from you

Nothing — this doesn't depend on any external credential or manual setup
step. It's usable as soon as it's deployed.
