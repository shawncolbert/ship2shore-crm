-- Ships broadcast their own reported destination/ETA over AIS (crew-entered,
-- same transponder as position -- see 0084_vessel_ais_position.sql), which
-- is the actual "when does it dock" answer, not just a lat/lon pin. Same
-- caveats as any AIS-based ETA: crew-entered, no year field (see
-- vessel-position-poll.js's year-inference comment), and can go stale if
-- never updated -- there's no free source for an official terminal berth
-- time, this is the best automatic signal that exists.
alter table public.vessels add column if not exists reported_destination text;
alter table public.vessels add column if not exists reported_eta timestamptz;
alter table public.vessels add column if not exists static_data_updated_at timestamptz;
