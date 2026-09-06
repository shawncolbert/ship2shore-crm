-- Photo library for Social Posts: bulk-imported (or posted) photos tracked
-- as unused/used so Shawn stops losing track of which job photos he's
-- already posted vs. still has sitting fresh, instead of hunting through
-- Google Photos every time.
create table if not exists public.media_library (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  url            text not null,
  storage_path   text,
  status         text not null default 'unused' check (status in ('unused', 'used')),
  used_at        timestamptz,
  used_in_post_id uuid references public.social_posts(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists ix_media_library_org_status on public.media_library(org_id, status, created_at desc);

alter table public.media_library enable row level security;

create policy "Users can view org media" on public.media_library
  for select using (org_id in (select org_id from memberships where profile_id = auth.uid()));
create policy "Users can add org media" on public.media_library
  for insert with check (org_id in (select org_id from memberships where profile_id = auth.uid()));
create policy "Users can update org media" on public.media_library
  for update using (org_id in (select org_id from memberships where profile_id = auth.uid()));
create policy "Users can delete org media" on public.media_library
  for delete using (org_id in (select org_id from memberships where profile_id = auth.uid()));
