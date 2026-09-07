-- social_posts.platform only ever allowed 'tiktok' (or null) -- a leftover
-- from when this feature was TikTok-only. Every Instagram/Facebook save has
-- been silently rejected by this constraint ever since Post Studio started
-- tagging every platform explicitly, not just TikTok. Caught 2026-09-07
-- while testing the Buffer auto-publish path: zero rows existed in
-- social_posts at all, for any platform, despite the feature being built
-- and used across multiple sessions.
alter table public.social_posts drop constraint social_posts_platform_check;
alter table public.social_posts add constraint social_posts_platform_check
  check (platform is null or platform = any (array['instagram', 'facebook', 'tiktok']));
