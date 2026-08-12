-- Applied to project ofntwhbbhujwyttmvlew.
-- Per-page/per-funnel accent theme for the public-facing landing page and
-- funnel builders -- separate system from organizations.theme_mode/preset
-- (that one skins the internal CRM dashboard; these public pages have no
-- session and render outside the app's :root attribute system entirely).
-- Same 6 keys as the CRM presets for brand-family consistency, but that's
-- a naming choice only -- these columns are independent and self-contained.

alter table public.landing_pages
  add column if not exists theme text not null default 'classic'
    check (theme in ('classic', 'ocean', 'crimson', 'forest', 'aurora', 'slate'));

alter table public.funnels
  add column if not exists theme text not null default 'classic'
    check (theme in ('classic', 'ocean', 'crimson', 'forest', 'aurora', 'slate'));
