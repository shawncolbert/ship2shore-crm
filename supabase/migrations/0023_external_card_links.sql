-- Tracks already-built, externally-hosted digital business cards (not the
-- in-app builder) -- a trackable /go/:slug redirect wraps each one so a
-- click can be counted without touching the external site at all.
create table public.external_card_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null unique,
  name text not null,
  target_url text not null,
  click_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.external_card_links enable row level security;

create policy "members manage external card links" on public.external_card_links
  for all using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create index external_card_links_org_id_idx on public.external_card_links (org_id);

create or replace function public.increment_external_card_click(p_slug text)
returns void
language plpgsql
security definer
as $$
begin
  update public.external_card_links set click_count = click_count + 1, updated_at = now() where slug = p_slug;
end;
$$;
