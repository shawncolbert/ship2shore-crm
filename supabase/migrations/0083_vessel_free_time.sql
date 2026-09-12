-- Applied to project ofntwhbbhujwyttmvlew.
-- Per-vessel "last free day" (the date per-diem/demurrage charges kick in
-- at the terminal) so a dispatcher sets it ONCE per vessel instead of
-- typing it onto every job that vessel is carrying -- Shawn's own
-- delivery orders print a "FREE TIME EXP." field, but it's almost always
-- left blank by the carrier; this is set by hand from whatever the
-- carrier/terminal actually tells him, same way vessel_name already is.
create table if not exists public.vessels (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  name          text not null,
  last_free_day date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, name)
);

alter table public.vessels enable row level security;

drop policy if exists "members manage vessels" on public.vessels;
create policy "members manage vessels" on public.vessels
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

-- One-time flag so the daily free-time-alerts.js function never re-pings
-- the same job twice -- same "sent_at" shape as review_request_sent_at /
-- unfollowed_push_sent_at elsewhere on this table.
alter table public.opportunities add column if not exists free_time_alert_sent_at timestamptz;
