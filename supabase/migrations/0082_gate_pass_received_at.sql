-- Set the moment gmail-sync auto-matches an inbound gate pass reply to this
-- job (see draftGatePassIssuedMessage in gmail-sync/index.ts) -- separate
-- from gate_pass_requested_at so the Pipeline card can show "Requested" and
-- "Received" as two distinct states instead of one timestamp trying to mean
-- both.
alter table public.opportunities add column gate_pass_received_at timestamptz;
