-- TikTok auto-publish support for the Social Media Planner: which platform a
-- post targets, and the result of a publish attempt (success URL or error).
alter table public.social_posts
  add column platform text,
  add column publish_error text,
  add column published_url text,
  add column published_at timestamptz;

alter table public.social_posts
  add constraint social_posts_platform_check
    check (platform is null or platform = any (array['tiktok'::text]));

alter table public.social_posts
  drop constraint social_posts_status_check;

alter table public.social_posts
  add constraint social_posts_status_check
    check (status = any (array['draft'::text, 'scheduled'::text, 'published'::text, 'failed'::text]));
