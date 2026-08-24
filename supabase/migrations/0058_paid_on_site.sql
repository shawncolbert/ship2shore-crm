-- A job the driver collects payment for in person, with no invoice ever
-- generated at all -- separate from the normal Zelle-invoice flow, but still
-- needs to count as paid for reporting (see Invoice Tracking).
alter table public.opportunities
  add column paid_on_site boolean not null default false;
