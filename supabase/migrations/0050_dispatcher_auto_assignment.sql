-- Auto-assignment for new leads: builds on the manual "assign to dispatcher"
-- feature (0049). Shawn picks which dispatcher contacts are "in rotation" --
-- not every segment='dispatcher' contact is automatically eligible, mirrors
-- the "mark certain people" ask -- and, when the org has auto-assign turned
-- on, new funnel leads round-robin across whoever's marked instead of
-- landing unassigned for him to hand off by hand.
create table if not exists public.dispatcher_rotation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, contact_id)
);
create index if not exists dispatcher_rotation_org_idx on public.dispatcher_rotation (org_id, position);

alter table public.dispatcher_rotation enable row level security;
drop policy if exists "members manage dispatcher rotation" on public.dispatcher_rotation;
create policy "members manage dispatcher rotation" on public.dispatcher_rotation
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

-- Off by default -- Shawn asked for manual control "starting now" before
-- automation. auto_assign_last_contact_id is the round-robin cursor: whoever
-- got the last lead, so the next one picks up after them instead of always
-- starting from the top of the rotation.
alter table public.organizations
  add column if not exists auto_assign_leads boolean not null default false,
  add column if not exists auto_assign_last_contact_id uuid references public.contacts(id) on delete set null;
