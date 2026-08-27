-- Editable per-org dollar adjustment applied to Val's general pricing
-- formula when a run originates in California and ends outside it
-- (outbound tends to run higher than inbound in this lane, per Shawn's
-- call 2026-08-27). Zero by default -- no behavior change until an org
-- actually sets one from Settings.
alter table organizations
  add column if not exists pricing_outbound_ca_adjustment numeric not null default 0;
