-- Backfill: documents add_organizations_ga4_measurement_id, applied
-- directly against the database on 2026-09-04 (Supabase migration history:
-- 20260904215022_add_organizations_ga4_measurement_id) without a matching
-- file ever landing in this repo. See 0077_seo_analytics_tables.sql for why
-- this exists.
alter table public.organizations add column ga4_measurement_id text;
