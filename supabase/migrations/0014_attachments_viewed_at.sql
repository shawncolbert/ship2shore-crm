-- Applied to project ofntwhbbhujwyttmvlew.
-- Lets the dashboard tell staff "a customer sent us a file you haven't
-- looked at yet". Customer uploads (via /u/:token, public-upload.js) have
-- uploaded_by = null; staff uploads set it. viewed_at is stamped when a
-- staff member opens the row from the dashboard drill-down or downloads
-- the file from the contact page.

alter table public.attachments add column if not exists viewed_at timestamptz;

-- Backfill: everything that already existed before this feature shipped
-- counts as already-seen, so the new "unread" counter starts at zero
-- instead of dumping the whole history on staff as unread.
update public.attachments set viewed_at = created_at where viewed_at is null;
