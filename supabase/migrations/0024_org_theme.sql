-- Applied to project ofntwhbbhujwyttmvlew.
-- Per-org CRM dashboard appearance (dark/light mode + one of 6 accent
-- presets), separate from the landing-page/funnel template system. Any org
-- member can change it (existing "p_org_members" ALL policy on
-- organizations already covers this update -- no new RLS needed). Defaults
-- match today's look exactly, so no existing org's dashboard changes until
-- someone visits Settings > Appearance and picks something else.

alter table public.organizations
  add column if not exists theme_mode text not null default 'light'
    check (theme_mode in ('light', 'dark'));

alter table public.organizations
  add column if not exists theme_preset text not null default 'classic'
    check (theme_preset in ('classic', 'ocean', 'crimson', 'forest', 'aurora', 'slate'));
