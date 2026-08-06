-- Consent choices captured at schedule time (when a human is actually
-- looking at the post), replayed unchanged by the unattended publish job --
-- never fabricated at publish time.
alter table public.social_posts
  add column tiktok_privacy_level text default 'SELF_ONLY',
  add column tiktok_is_aigc boolean default false;

alter table public.social_posts
  add constraint social_posts_tiktok_privacy_check
    check (tiktok_privacy_level is null or tiktok_privacy_level = any (array[
      'PUBLIC_TO_EVERYONE'::text, 'MUTUAL_FOLLOW_FRIENDS'::text,
      'FOLLOWER_OF_CREATOR'::text, 'SELF_ONLY'::text
    ]));
