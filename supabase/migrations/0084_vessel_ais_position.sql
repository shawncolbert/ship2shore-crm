-- Live vessel position via AISStream.io (free AIS feed, MMSI-keyed). A
-- dispatcher enters each vessel's MMSI once here, same pattern as
-- last_free_day (0083_vessel_free_time.sql) -- vessel-position-poll.js then
-- keeps last_lat/last_lon/etc. current on a schedule. Nullable throughout:
-- a vessel with no MMSI set just never gets a position, same as one with
-- no last_free_day never gets a free-time alert.
alter table public.vessels add column if not exists mmsi text;
alter table public.vessels add column if not exists last_lat double precision;
alter table public.vessels add column if not exists last_lon double precision;
alter table public.vessels add column if not exists last_speed_kn numeric;
alter table public.vessels add column if not exists last_course_deg numeric;
alter table public.vessels add column if not exists position_updated_at timestamptz;
