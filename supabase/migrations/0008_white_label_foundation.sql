-- Applied to project ofntwhbbhujwyttmvlew.
-- White-label multi-tenancy foundation (Part 5): branding fields on
-- organizations, and a platform_admin flag so the existing user can create
-- new orgs and invite users to them via the new admin-only tools. This is
-- the foundation only -- no self-serve signup/billing.

alter table public.organizations add column if not exists logo_url text;
alter table public.organizations add column if not exists primary_color text;
alter table public.organizations add column if not exists custom_domain text;

alter table public.profiles add column if not exists platform_admin boolean not null default false;

-- One-time: promote the sole existing user so they can use the new
-- admin-only org/invite tools. Scoped to their specific profile id (not an
-- unconditional update) so this stays safe if ever re-run after more users
-- exist.
update public.profiles set platform_admin = true
where id = '0d6786b3-5581-4d3b-a8bc-a15d0953bc43';
