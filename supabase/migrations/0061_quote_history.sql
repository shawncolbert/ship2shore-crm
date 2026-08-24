-- Reference log of every confirmed price quote -- route, date/season,
-- vehicle, and the Low/High/target-driver-payout numbers, plus which one
-- the dispatcher actually picked. Purely informational: nothing reads this
-- back to override a live quote, since the locked formula is already
-- deterministic (same inputs always produce the same numbers) -- this is
-- for looking back at what a route was quoted before, not for the system
-- to reuse a stale number if the formula's ever revised.
create table public.quote_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  pickup_address text,
  dropoff_address text,
  miles numeric,
  vehicle_type text,
  season text,
  rural_level text,
  transport_mode text,
  formula_used text not null check (formula_used in ('general', 'luxury_exotic', 'ca_port_bracket')),
  quote_low numeric,
  quote_high numeric,
  target_driver_payout numeric,
  confirmed_amount numeric not null,
  created_at timestamptz not null default now()
);

comment on table public.quote_history is 'Reference log of every confirmed price quote (route, date, vehicle, Low/High, which was picked). Informational only -- never reused to override a fresh calculation.';

alter table public.quote_history enable row level security;

create policy "members manage quote history" on public.quote_history for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create index idx_quote_history_org_created on public.quote_history (org_id, created_at desc);
