-- Applied to project ofntwhbbhujwyttmvlew.
-- contacts_dedupe_backup_20260801 was a one-off snapshot taken before a
-- contact dedupe pass. RLS was never enabled on it, so it was fully
-- readable/writable by the anon key. Verified every row (by email, then by
-- phone) is already represented in public.contacts before dropping -- the
-- dedupe had already completed successfully.

drop table if exists public.contacts_dedupe_backup_20260801;
