-- Which auto-publish path (if any) owns a given scheduled post. Was
-- implicit before (platform = 'tiktok' + status = 'scheduled' always meant
-- "the direct TikTok API job will publish this"), but now that Buffer can
-- also auto-publish a TikTok post, tiktok-publish.js and buffer-publish.js
-- would otherwise both try to claim the same row. null = no auto-publish
-- (manual, as always); 'buffer' = buffer-publish.js owns it.
alter table public.social_posts add column if not exists publish_via text;
