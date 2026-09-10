-- Supports the "Request gate pass" action on a job (Pipeline.jsx): vessel
-- name is the one field needed for that email that nothing in the schema
-- already tracked (bl_number, vehicle_vin, vehicle_year/make/model, and
-- port all already existed on opportunities). gate_pass_requested_at is
-- purely an audit/status marker -- set once the request email sends
-- successfully, shown on the job so a dispatcher can see whether one's
-- already gone out without checking their sent mail.
alter table public.opportunities add column vessel_name text;
alter table public.opportunities add column gate_pass_requested_at timestamptz;
