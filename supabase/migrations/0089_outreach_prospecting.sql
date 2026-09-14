-- Prospecting & Outreach add-on (Phase 1: see the feature spec) -- lets any
-- org find local businesses and run compliant, email-only outreach
-- sequences against them. Gated behind the 'outreach' feature flag at the
-- application layer (same pattern as every other feature -- RLS here only
-- ever enforces org isolation, never entitlement).
create table if not exists public.prospects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  business_name text not null,
  industry      text,
  website       text,
  phone         text,
  email         text,
  city          text,
  state         text,
  audit_score   jsonb not null default '{}'::jsonb,
  status        text not null default 'new' check (status in ('new', 'contacted', 'replied', 'converted', 'do_not_contact')),
  source        text not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Partial (not full) unique index: multiple prospects with no email at all
-- are fine, but two rows for the same address in one org are not.
create unique index if not exists uq_prospects_org_email on public.prospects (org_id, lower(email)) where email is not null;
create index if not exists ix_prospects_org_status on public.prospects (org_id, status);

create table if not exists public.outreach_sequences (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  -- [{ subject, body, delay_days }, ...] -- delay_days on step 0 is ignored
  -- (it sends immediately on enrollment); every step after that waits that
  -- many days after the previous one sent.
  steps      jsonb not null default '[]'::jsonb,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  prospect_id        uuid not null references public.prospects(id) on delete cascade,
  sequence_id        uuid not null references public.outreach_sequences(id) on delete cascade,
  current_step       integer not null default 0,
  status             text not null default 'active' check (status in ('active', 'paused', 'completed', 'stopped')),
  -- Generated once at enroll time and reused for every step -- one
  -- unsubscribe link works for the whole sequence, not one per email.
  unsubscribe_token  text not null unique default encode(gen_random_bytes(16), 'hex'),
  enrolled_at        timestamptz not null default now(),
  next_send_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (prospect_id, sequence_id)
);
create index if not exists ix_outreach_enrollments_due on public.outreach_enrollments (org_id, status, next_send_at);

create table if not exists public.outreach_sends (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  prospect_id  uuid not null references public.prospects(id) on delete cascade,
  sequence_id  uuid not null references public.outreach_sequences(id) on delete cascade,
  enrollment_id uuid not null references public.outreach_enrollments(id) on delete cascade,
  step_index   integer not null,
  subject      text,
  sent_at      timestamptz not null default now(),
  bounced      boolean not null default false
);

-- One central suppression list per org -- checked before every single send
-- regardless of which sequence or prospect list it came from. A prospect
-- can land here via the unsubscribe link, a bounce, or a manual add.
create table if not exists public.do_not_contact (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  email      text not null,
  reason     text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_do_not_contact_org_email on public.do_not_contact (org_id, lower(email));

alter table public.prospects enable row level security;
alter table public.outreach_sequences enable row level security;
alter table public.outreach_enrollments enable row level security;
alter table public.outreach_sends enable row level security;
alter table public.do_not_contact enable row level security;

drop policy if exists "org members manage prospects" on public.prospects;
create policy "org members manage prospects" on public.prospects for all
  using (org_id in (select org_id from memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from memberships where profile_id = auth.uid()));

drop policy if exists "org members manage outreach sequences" on public.outreach_sequences;
create policy "org members manage outreach sequences" on public.outreach_sequences for all
  using (org_id in (select org_id from memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from memberships where profile_id = auth.uid()));

drop policy if exists "org members manage outreach enrollments" on public.outreach_enrollments;
create policy "org members manage outreach enrollments" on public.outreach_enrollments for all
  using (org_id in (select org_id from memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from memberships where profile_id = auth.uid()));

drop policy if exists "org members view outreach sends" on public.outreach_sends;
create policy "org members view outreach sends" on public.outreach_sends for select
  using (org_id in (select org_id from memberships where profile_id = auth.uid()));

drop policy if exists "org members manage do not contact" on public.do_not_contact;
create policy "org members manage do not contact" on public.do_not_contact for all
  using (org_id in (select org_id from memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from memberships where profile_id = auth.uid()));
