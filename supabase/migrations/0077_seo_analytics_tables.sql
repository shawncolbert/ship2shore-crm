-- Backfill: documents seo_analytics_tables, applied directly against the
-- database on 2026-08-31 (recorded in Supabase's migration history as
-- 20260831045252_seo_analytics_tables) without ever landing a matching file
-- in this repo. DDL here mirrors the live schema exactly -- not re-applying
-- anything, just closing the gap so a fresh environment rebuilt from these
-- files ends up with the same tables. Populated per org by
-- google-marketing-sync.js from Google Search Console and GA4.
create table public.search_performance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  date date not null,
  query text not null,
  clicks integer,
  impressions integer,
  position numeric,
  created_at timestamptz not null default now(),
  unique (org_id, date, query)
);

create table public.site_analytics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  date date not null,
  page_path text not null,
  sessions integer,
  active_users integer,
  pageviews integer,
  created_at timestamptz not null default now(),
  unique (org_id, date, page_path)
);

alter table public.search_performance enable row level security;
alter table public.site_analytics enable row level security;

create policy "members view search performance" on public.search_performance for select
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create policy "members view site analytics" on public.site_analytics for select
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));
