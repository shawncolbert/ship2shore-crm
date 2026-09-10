-- "Striking distance" keywords: queries where an org's site already ranks
-- on page two (positions 6-15) with real search volume behind them --
-- close enough that improving the page's content is likely to move the
-- needle, unlike a position-40 query that needs a different strategy
-- entirely. Computed nightly by seo-striking-distance.js from
-- search_performance (impression-weighted average position over a trailing
-- window, not a single day's noisy figure). status starts at 'new' so it
-- shows up as an actionable flag; a human (or later, a reviewed AI
-- suggestion) marks it 'acknowledged' while working it, or 'dismissed' if
-- it's not worth pursuing. The sync only ever sets 'new' on first sight and
-- 'resolved' once a keyword leaves the striking-distance band -- it never
-- overwrites 'acknowledged' or 'dismissed', so a human's call always sticks
-- until the keyword's position actually changes.
create table public.seo_keyword_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  query text not null,
  avg_position numeric not null,
  window_impressions integer not null,
  window_clicks integer not null,
  window_days integer not null default 28,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'dismissed', 'resolved')),
  first_flagged_at timestamptz not null default now(),
  last_computed_at timestamptz not null default now(),
  unique (org_id, query)
);

comment on table public.seo_keyword_alerts is 'Queries an org ranks for at position 6-15 (page two, "striking distance") with enough impressions to be worth acting on. Recomputed nightly from search_performance by seo-striking-distance.js. status is human-owned once set past ''new'' -- the sync never clobbers ''acknowledged''/''dismissed'', it only flips a resolved query back to ''new'' if it re-enters the band.';

alter table public.seo_keyword_alerts enable row level security;

create policy "members manage seo keyword alerts" on public.seo_keyword_alerts for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create index idx_seo_keyword_alerts_org_status on public.seo_keyword_alerts (org_id, status);
