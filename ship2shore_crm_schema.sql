-- ============================================================================
-- Ship2Shore CRM — Phase 1 Schema (the "spine")
-- Target: Supabase (PostgreSQL)
-- ----------------------------------------------------------------------------
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   Safe to re-run: it uses IF NOT EXISTS / ON CONFLICT where possible.
--
-- DESIGN:
--   * Multi-tenant from day one. Every business table carries org_id.
--   * Row-Level Security (RLS) isolates each org — a future white-label
--     client can never see Ship2Shore's rows, and vice versa.
--   * Backend webhooks (Twilio inbound SMS, Gmail sync) should use the
--     Supabase service_role key, which bypasses RLS to insert on any org.
--   * Ship2Shore is seeded as org #1 with its pipeline + rate catalog.
-- ============================================================================

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ===========================================================================
-- 1. ORGANIZATIONS (tenants)
-- ===========================================================================
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_org_updated on public.organizations;
create trigger trg_org_updated before update on public.organizations
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. PROFILES  (1:1 with Supabase auth.users)
-- ===========================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- 3. MEMBERSHIPS  (which user belongs to which org, and their role)
-- ===========================================================================
create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'owner'
              check (role in ('owner','admin','agent','viewer')),
  created_at  timestamptz not null default now(),
  unique (org_id, profile_id)
);

-- Helper: org_ids the current user belongs to.
-- SECURITY DEFINER so it can read memberships without tripping RLS recursion.
create or replace function public.current_user_org_ids()
returns setof uuid language sql stable security definer
set search_path = public as $$
  select org_id from public.memberships where profile_id = auth.uid()
$$;

-- ===========================================================================
-- 4. SERVICES  (rate catalog — data-driven so each org sets its own prices)
-- ===========================================================================
create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  code          text not null,
  name          text not null,
  default_rate  numeric(10,2) not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (org_id, code)
);

-- ===========================================================================
-- 4b. PRICING ZONES + SURCHARGES  (staff-only quoting catalog, same
--     data-driven-per-org pattern as services -- never fetched by any
--     public page; used by the pipeline card's price estimator to turn a
--     lead's pickup/dropoff address into a rate range once staff pick the
--     matching zone by hand)
-- ===========================================================================
create table if not exists public.pricing_zones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  rate_min    numeric(10,2) not null,
  rate_max    numeric(10,2) not null,
  note        text,                 -- e.g. drive time, shown next to the zone name
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ix_pricing_zones_org on public.pricing_zones(org_id, sort_order);

create table if not exists public.pricing_surcharges (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  amount_min  numeric(10,2) not null,
  amount_max  numeric(10,2) not null,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ix_pricing_surcharges_org on public.pricing_surcharges(org_id, sort_order);

-- ===========================================================================
-- 5. CONTACTS
-- ===========================================================================
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  full_name     text,
  company       text,
  phone         text,                 -- store E.164, e.g. +13107480040
  email         text,
  segment       text check (segment in
                ('broker','dispatcher','military','transporter','private','other')),
  tags          text[] not null default '{}',
  custom_fields jsonb  not null default '{}',
  source        text,                 -- calendly | pwa | sms | manual | import
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_contacts_org_phone
  on public.contacts(org_id, phone) where phone is not null;
create index if not exists ix_contacts_org_email on public.contacts(org_id, email);
create index if not exists ix_contacts_org_segment on public.contacts(org_id, segment);
drop trigger if exists trg_contacts_updated on public.contacts;
create trigger trg_contacts_updated before update on public.contacts
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 6. PIPELINES + 7. STAGES
-- ===========================================================================
create table if not exists public.pipelines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.stages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name        text not null,
  position    int  not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists ix_stages_pipeline on public.stages(pipeline_id, position);

-- ===========================================================================
-- 8. OPPORTUNITIES  (a job / booking)
-- ===========================================================================
create table if not exists public.opportunities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  pipeline_id   uuid not null references public.pipelines(id),
  stage_id      uuid not null references public.stages(id),
  title         text,
  service_code  text,                 -- references services.code (per org)
  port          text check (port in
                ('long_beach','wilmington','matson','other')),
  value         numeric(10,2) not null default 0,
  status        text not null default 'open'
                check (status in ('open','won','lost','cancelled')),
  scheduled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ix_opps_org_stage on public.opportunities(org_id, stage_id);
create index if not exists ix_opps_org_contact on public.opportunities(org_id, contact_id);
drop trigger if exists trg_opps_updated on public.opportunities;
create trigger trg_opps_updated before update on public.opportunities
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 9. APPOINTMENTS  (from Calendly / booking PWA / manual)
-- ===========================================================================
create table if not exists public.appointments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  source        text,                 -- calendly | pwa | manual
  external_id   text,                 -- Calendly event id, etc.
  title         text,
  port          text,
  service_code  text,
  start_at      timestamptz,
  end_at        timestamptz,
  status        text not null default 'scheduled'
                check (status in ('scheduled','completed','no_show','cancelled')),
  created_at    timestamptz not null default now()
);
create index if not exists ix_appts_org_start on public.appointments(org_id, start_at);

-- ===========================================================================
-- 10. CONVERSATIONS + 11. MESSAGES  (unified inbox: SMS + email)
-- ===========================================================================
create table if not exists public.conversations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  channel        text not null check (channel in ('sms','email')),
  last_message_at timestamptz,
  unread         boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (org_id, contact_id, channel)
);
create index if not exists ix_convo_org_recent
  on public.conversations(org_id, last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction       text not null check (direction in ('inbound','outbound')),
  channel         text not null check (channel in ('sms','email')),
  body            text,
  from_addr       text,
  to_addr         text,
  provider        text,               -- twilio | gmail
  provider_msg_id text,
  ai_generated    boolean not null default false,
  status          text,               -- queued | sent | delivered | failed | received
  created_at      timestamptz not null default now()
);
create index if not exists ix_msgs_convo on public.messages(conversation_id, created_at);

-- ===========================================================================
-- 12. ACTIVITIES  (per-contact timeline: notes, status changes, system events)
-- ===========================================================================
create table if not exists public.activities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  actor_id      uuid references public.profiles(id) on delete set null,  -- null = system
  type          text not null default 'note'
                check (type in ('note','status_change','call','system')),
  body          text,
  created_at    timestamptz not null default now()
);
create index if not exists ix_activities_contact on public.activities(contact_id, created_at);

-- ===========================================================================
-- ROW-LEVEL SECURITY
--   Every business table: a user can touch a row only if they belong to its org.
--   service_role (backend webhooks) bypasses RLS automatically.
-- ===========================================================================
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.profiles      enable row level security;
alter table public.services      enable row level security;
alter table public.pricing_zones      enable row level security;
alter table public.pricing_surcharges enable row level security;
alter table public.contacts      enable row level security;
alter table public.pipelines     enable row level security;
alter table public.stages        enable row level security;
alter table public.opportunities enable row level security;
alter table public.appointments  enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.activities    enable row level security;

-- Profiles: a user sees/edits only their own profile row.
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Organizations: visible to their members.
drop policy if exists p_org_members on public.organizations;
create policy p_org_members on public.organizations
  for all using (id in (select public.current_user_org_ids()))
  with check (id in (select public.current_user_org_ids()));

-- Memberships: a user sees membership rows for orgs they belong to.
drop policy if exists p_memberships_scope on public.memberships;
create policy p_memberships_scope on public.memberships
  for all using (org_id in (select public.current_user_org_ids()))
  with check (org_id in (select public.current_user_org_ids()));

-- Generic org-scoped policy for every remaining tenant table.
do $$
declare t text;
begin
  foreach t in array array[
    'services','pricing_zones','pricing_surcharges','contacts','pipelines','stages','opportunities',
    'appointments','conversations','messages','activities'
  ] loop
    execute format('drop policy if exists p_%1$s_org on public.%1$s;', t);
    execute format($f$
      create policy p_%1$s_org on public.%1$s
      for all
      using (org_id in (select public.current_user_org_ids()))
      with check (org_id in (select public.current_user_org_ids()));
    $f$, t);
  end loop;
end $$;

-- ===========================================================================
-- SEED — Ship2Shore (org #1)
-- ===========================================================================
insert into public.organizations (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'Ship2Shore Booking', 'ship2shore')
on conflict (id) do nothing;

-- Rate catalog (your real rates)
insert into public.services (org_id, code, name, default_rate) values
  ('11111111-1111-1111-1111-111111111111','twic_escort','TWIC Vehicle Escort',85.00),
  ('11111111-1111-1111-1111-111111111111','hotshot','Hotshot',200.00),
  ('11111111-1111-1111-1111-111111111111','semi_container','Semi Load-Unload & Container',325.00)
on conflict (org_id, code) do nothing;

-- Vehicle-transport quoting catalog (from the whaleyinc.net public
-- calculator -- kept here for staff quoting only; see pricing_zones above)
insert into public.pricing_zones (org_id, name, rate_min, rate_max, note, sort_order) values
  ('11111111-1111-1111-1111-111111111111','Los Angeles (Local)',275,325,null,10),
  ('11111111-1111-1111-1111-111111111111','Orange County',300,350,null,20),
  ('11111111-1111-1111-1111-111111111111','Ventura County',325,375,null,30),
  ('11111111-1111-1111-1111-111111111111','Valencia / Santa Clarita',350,400,'~45 min – 1.5 hrs',40),
  ('11111111-1111-1111-1111-111111111111','Riverside / San Bernardino',400,475,'~1 – 2 hrs',50),
  ('11111111-1111-1111-1111-111111111111','San Diego',600,675,'~1.5 – 2.5 hrs',60),
  ('11111111-1111-1111-1111-111111111111','Northern California',625,725,null,70);

insert into public.pricing_surcharges (org_id, name, amount_min, amount_max, sort_order) values
  ('11111111-1111-1111-1111-111111111111','Non-Operating Vehicle',200,200,10),
  ('11111111-1111-1111-1111-111111111111','Requires Winching',125,125,20),
  ('11111111-1111-1111-1111-111111111111','Oversized Vehicle',125,125,30),
  ('11111111-1111-1111-1111-111111111111','Lifted / Modified Vehicle',125,175,40);

-- Default pipeline + stages
insert into public.pipelines (id, org_id, name, is_default)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111','Ship2Shore Jobs', true)
on conflict (id) do nothing;

insert into public.stages (org_id, pipeline_id, name, position, is_won, is_lost) values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','New Booking',0,false,false),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Scheduled',1,false,false),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','In Progress',2,false,false),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Completed',3,false,false),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Paid',4,true,false)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- LAST STEP (run once, after you sign up in the app so you have an auth user):
--   Find your user id in Supabase → Authentication → Users, then:
--
--   insert into public.profiles (id, full_name, email)
--   values ('<YOUR-AUTH-USER-ID>', 'Shawn', 'shawn@ship2shorebooking.com')
--   on conflict (id) do nothing;
--
--   insert into public.memberships (org_id, profile_id, role)
--   values ('11111111-1111-1111-1111-111111111111','<YOUR-AUTH-USER-ID>','owner')
--   on conflict do nothing;
-- ---------------------------------------------------------------------------
