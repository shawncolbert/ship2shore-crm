-- Real bug caught 2026-09-08: a live test showed every post got sent to
-- Buffer 3 times each (visible directly in Buffer's own post history) --
-- Netlify scheduled functions can fire more than once for a given tick
-- (or overlapping deploys each keep their own trigger alive briefly), and
-- buffer-publish.js had no protection against processing the same
-- social_posts row twice if that happened. claimed_at is an atomic
-- claim: whichever invocation successfully flips it from null to now()
-- first owns that row; every other concurrent invocation sees a row
-- count of zero and skips it instead of publishing a duplicate.
alter table public.social_posts add column if not exists claimed_at timestamptz;
