-- Lets social-post-reminders.js know which drafts it's already nudged
-- Shawn about, so a scheduled post whose time has come only gets one
-- Telegram reminder, not one every time the cron runs.
alter table public.social_posts add column if not exists reminded_at timestamptz;
