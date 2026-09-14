-- Tracks every Google Places search (Prospecting & Outreach Phase 2) so
-- Shawn can see real usage against Places' per-call cost (~$0.032/search
-- as of writing) instead of finding out at the Google Cloud bill. One row
-- per search request, not per result. Platform-admin only -- this is a
-- billing concern Shawn covers platform-wide, not something any one org
-- needs visibility into.
create table if not exists public.place_search_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  industry     text,
  location     text,
  result_count integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists ix_place_search_log_created on public.place_search_log (created_at);

alter table public.place_search_log enable row level security;

drop policy if exists "platform admin views place search log" on public.place_search_log;
create policy "platform admin views place search log" on public.place_search_log
  for select
  using (exists (select 1 from public.profiles where id = auth.uid() and platform_admin));
