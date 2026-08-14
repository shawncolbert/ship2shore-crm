-- Self-serve external "quick links" in the sidebar (near Help), e.g. a
-- photographer's video-editing tool, a real estate agent's MLS/listings
-- site -- whatever external site an org uses daily alongside the CRM.
-- Each row is just a name + URL; opens in a new tab from the sidebar.

create table if not exists public.org_custom_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  label text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists org_custom_links_org_id_idx on public.org_custom_links (org_id);

alter table public.org_custom_links enable row level security;

create policy "org members manage their custom links" on public.org_custom_links
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));
