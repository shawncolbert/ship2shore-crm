-- Fixes a real cross-tenant leak: ContactDetail's "Book" button and
-- embedded Calendly widget used one single hardcoded Calendly link
-- (lib/config.js's CALENDLY_URL, defaulting to WHALEY Inc's own account)
-- for every org sharing this deployment -- any org other than Ship2Shore/
-- WHALEY saw Shawn's own Calendly info instead of their own.
--
-- Backfills the two orgs that were actually relying on that hardcoded
-- default (same real business) so their live behavior doesn't change.
-- Every other org (e.g. TRECOLBERT PHOTOGRAPHY) gets null -- the UI now
-- shows a clear "connect your own Calendly" prompt instead of silently
-- defaulting to someone else's calendar.

alter table public.organizations add column if not exists calendly_url text;

update public.organizations
set calendly_url = 'https://calendly.com/whaleyinc'
where id in ('11111111-1111-1111-1111-111111111111', 'ae40197c-650e-4a5a-8187-7fe3d6beeeb3');
