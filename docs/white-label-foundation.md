# White-label multi-tenancy foundation

Prepares the schema and app to safely host more than one client org, without
turning on self-serve signup or billing. An **org_id scoping audit was run
across every table, every server-side function, and every client query
before any code changed** — see the "audit findings" section below for the
full picture, including what was explicitly left out of this pass.

## What's fully done

- **Branding fields on `organizations`**: `logo_url`, `primary_color`,
  `custom_domain` (migration `0008`). `name` already existed and doubles as
  the business name.
- **A real, confirmed correctness fix**: `stage-change-webhook` looked up
  the opportunity/contact by raw id with no `org_id` check, meaning a
  caller who supplied their own (real) `org_id` together with *another*
  org's `opportunity_id`/`contact_id` could get that other org's job and
  contact details read out and emailed to an attacker-chosen address. Fixed
  by scoping both lookups to `org_id` — deployed (v13) and merged into the
  tracked function source.
- **Admin-created onboarding flow** (foundation only, no self-serve):
  - A new `profiles.platform_admin` flag; the existing user is now the sole
    platform admin.
  - `/admin/orgs` page (only visible in the sidebar, and only usable, if
    `platform_admin` is true) to create a new organization and invite users
    to it by email + role (owner/admin/agent/viewer).
  - Three Netlify functions (`admin-list-orgs`, `admin-create-org`,
    `admin-invite-user`) do the actual cross-org work using the
    service-role client — deliberately bypassing RLS, since a platform
    admin listing every tenant is the one legitimate case where RLS's
    per-org isolation shouldn't apply. Every one of them re-checks
    `profiles.platform_admin` server-side before doing anything, so this
    isn't just a hidden nav link — the UI check is a convenience, not the
    real gate.
  - Inviting someone who already has an account skips the invite email and
    just adds the membership — they can already log in.

## Audit findings — what's already safe, and what's explicitly deferred

The app's core (everything a logged-in dispatcher touches — contacts,
pipeline, inbox, payments, automations) is **already correctly org-scoped**:
every tenant table has `org_id`, RLS is enabled everywhere, and the generic
`org_id in (select org_id from memberships where profile_id = auth.uid())`
policy is applied consistently. Three tables that existed only in the live
database (never committed to a migration — `attachments`, `upload_links`,
`gmail_oauth_tokens`) were checked directly against production: all three
have RLS enabled with correctly org-scoped policies (`gmail_oauth_tokens` is
locked to service-role-only, which is the right call for a table holding
Gmail OAuth secrets).

**What this pass deliberately did NOT fix**, and why it's out of scope for
"foundation, no self-serve":

- `public-booking.js`, `calendly-webhook`, and `wave-payment-sync`/
  `wave-webhook` all hardcode a single `ORG_ID` (or read one shared
  credential set). (`gmail-sync`, `gmail-enrichment`, `ai-draft-reply`, and
  the AI Assistant's `agent-controller.js` have since been fixed to be
  properly per-org — see their own docs/comments.) Making the rest genuinely
  multi-tenant means
  real product decisions this pass can't make for you: does a second client
  get their own Calendly account, their own Gmail address, their own Wave
  business? How does an inbound webhook even know which org it's for (a
  per-org key in the URL? a per-org signing secret)? **Do not onboard a
  second paying client without resolving this first** — until then, every
  integration only ever operates against the one org that exists today, so
  there's no live cross-tenant risk, but a second org created via the new
  admin tool would get a working CRM with no Calendly/Gmail/Wave wired to it.
- `wave-payment-sync`/`wave-webhook` also look up "pending" opportunities
  with no `org_id` filter at all (only by `wave_invoice_id`), so if a second
  org existed with a Wave invoice, this code could stamp its `stage_id` to a
  UUID belonging to org #1's pipeline. Deferred for the same reason as above
  — it's part of the larger Wave-multi-tenancy decision, not a standalone
  quick fix.
- `fetchMyOrgId()` (client-side) picks an arbitrary org via
  `.limit(1).maybeSingle()` with no ordering, for a user who belongs to more
  than one org. Not a leak (RLS still restricts to orgs they legitimately
  belong to), but worth resolving with an org-switcher UI before any real
  person manages more than one tenant.

## Where things live

- `supabase/migrations/0008_white_label_foundation.sql`
- `netlify/functions/_shared/platformAdmin.js`, `admin-list-orgs.js`,
  `admin-create-org.js`, `admin-invite-user.js`
- `src/lib/admin.js`, `src/pages/AdminOrgs.jsx`
- `supabase/functions/stage-change-webhook/index.ts` (org_id scoping fix)
