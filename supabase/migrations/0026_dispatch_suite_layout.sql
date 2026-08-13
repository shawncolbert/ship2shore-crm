-- Applied to project ofntwhbbhujwyttmvlew.
-- Adds "dispatch_suite" as a 7th org-wide layout in the existing Settings >
-- Appearance system (organizations.theme_preset) -- a dark navy/violet/brass
-- maritime-dispatch look modeled on an approved reference demo. Same
-- mechanism as the other 6 presets (classic/ocean/crimson/forest/aurora/
-- slate); no new table, no per-user state -- picking it changes the org's
-- dashboard for everyone in the org, same as any other layout.

alter table public.organizations
  drop constraint if exists organizations_theme_preset_check;

alter table public.organizations
  add constraint organizations_theme_preset_check
    check (theme_preset in ('classic', 'ocean', 'crimson', 'forest', 'aurora', 'slate', 'dispatch_suite'));
