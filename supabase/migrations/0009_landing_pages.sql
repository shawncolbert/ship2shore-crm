-- Applied to project ofntwhbbhujwyttmvlew.
-- Simple landing page builder: org-scoped, form-based content blocks (no
-- drag-and-drop for v1), publicly rendered by slug with no login required.

create table if not exists public.landing_pages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  slug        text not null,
  title       text not null,
  published   boolean not null default false,
  -- Ordered array of content blocks, e.g.
  -- [{"type":"heading","text":"..."},
  --  {"type":"paragraph","text":"..."},
  --  {"type":"image","url":"...","alt":"..."},
  --  {"type":"cta","label":"Book Now","target":"booking"|"lead_form"}]
  blocks      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Slugs are the sole lookup key for the public /pages/:slug route, which
-- resolves org_id purely from the slug -- so they must be globally unique,
-- not just unique per org.
create unique index if not exists uq_landing_pages_slug on public.landing_pages(slug);
create index if not exists ix_landing_pages_org on public.landing_pages(org_id);

alter table public.landing_pages enable row level security;
drop policy if exists "members manage landing pages" on public.landing_pages;
create policy "members manage landing pages" on public.landing_pages
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

create or replace function public.touch_landing_pages_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_touch_landing_pages on public.landing_pages;
create trigger trg_touch_landing_pages before update on public.landing_pages
  for each row execute function public.touch_landing_pages_updated_at();
