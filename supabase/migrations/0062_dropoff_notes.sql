-- Driver/dispatcher-reported access notes for a drop-off location -- "no
-- turnaround, dirt driveway," "gate code needed," etc. Matched by rounded
-- coordinates (not exact address text) so two different phrasings of the
-- same address still find the same notes. Purely human-reported: there's no
-- automated "risk score" here on purpose (see quote_history's own "no
-- fabricated signal" precedent) -- a street name can't tell you a truck got
-- stuck there last month, only a person who was actually there can.
create table public.dropoff_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  address text not null,
  lat numeric not null,
  lng numeric not null,
  kind text not null default 'warn' check (kind in ('warn', 'info')),
  note text not null,
  created_by_name text,
  created_at timestamptz not null default now()
);

comment on table public.dropoff_notes is 'Human-reported access notes for a drop-off location (narrow road, no turnaround, gate code, etc), matched by rounded lat/lng. No automated risk scoring -- reports only.';

alter table public.dropoff_notes enable row level security;

create policy "members manage dropoff notes" on public.dropoff_notes for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create index idx_dropoff_notes_org_latlng on public.dropoff_notes (org_id, lat, lng);
