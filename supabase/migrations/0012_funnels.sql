-- Applied to project ofntwhbbhujwyttmvlew.
-- Multi-step lead-capture funnels. netlify/functions/funnel-public.js,
-- funnel-submit.js, funnels-list.js, funnels-publish.js, and
-- funnels-save.js were built against these tables, but the tables were
-- never created -- every funnel request failed with "relation does not
-- exist". This migration is the backfill.

create table if not exists public.funnels (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  description text,
  slug        text not null,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Slug is the sole lookup key for the public /funnel/:slug route, so it
-- must be globally unique, same as landing_pages.
create unique index if not exists uq_funnels_slug on public.funnels(slug);
create index if not exists ix_funnels_org on public.funnels(org_id);

create table if not exists public.funnel_steps (
  id          uuid primary key default gen_random_uuid(),
  funnel_id   uuid not null references public.funnels(id) on delete cascade,
  step_number integer not null,
  title       text,
  description text,
  fields      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ix_funnel_steps_funnel on public.funnel_steps(funnel_id);

create table if not exists public.funnel_submissions (
  id          uuid primary key default gen_random_uuid(),
  funnel_id   uuid not null references public.funnels(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ix_funnel_submissions_funnel on public.funnel_submissions(funnel_id);

alter table public.funnels enable row level security;
alter table public.funnel_steps enable row level security;
alter table public.funnel_submissions enable row level security;

drop policy if exists "members manage funnels" on public.funnels;
create policy "members manage funnels" on public.funnels
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

drop policy if exists "members manage funnel steps" on public.funnel_steps;
create policy "members manage funnel steps" on public.funnel_steps
  for all
  using (funnel_id in (
    select f.id from public.funnels f
    join public.memberships m on m.org_id = f.org_id
    where m.profile_id = auth.uid()
  ))
  with check (funnel_id in (
    select f.id from public.funnels f
    join public.memberships m on m.org_id = f.org_id
    where m.profile_id = auth.uid()
  ));

-- Submissions are written by the service role from funnel-submit.js
-- (public, unauthenticated); members can only read their own org's.
drop policy if exists "members view funnel submissions" on public.funnel_submissions;
create policy "members view funnel submissions" on public.funnel_submissions
  for select
  using (funnel_id in (
    select f.id from public.funnels f
    join public.memberships m on m.org_id = f.org_id
    where m.profile_id = auth.uid()
  ));
