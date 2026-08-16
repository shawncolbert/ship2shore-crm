-- Saved leads pulled from FMCSA's public carrier/broker census data via the
-- Lead Finder tool. The raw search results themselves are never persisted
-- (that's a live pull every time) -- a row here only exists once someone
-- clicks "Save" on a company worth tracking, same "ephemeral results,
-- persist on save" shape as Prospecting.
create table if not exists public.fmcsa_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dot_number text not null,
  legal_name text,
  dba_name text,
  entity_type text,        -- 'carrier' | 'broker' | 'freight_forwarder'
  phone text,
  city text,
  state text,
  power_units integer,
  drivers integer,
  cargo_classification text,
  website_url text,
  site_notes text,         -- Claude-identified operational bottlenecks
  pitch_email text,        -- Claude-drafted outreach email
  status text not null default 'new',  -- 'new' | 'contacted' | 'added_to_contacts' | 'dismissed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, dot_number)
);

create index if not exists fmcsa_leads_org_id_idx on public.fmcsa_leads(org_id);

alter table public.fmcsa_leads enable row level security;

create policy "Org members can read their org's fmcsa leads"
  on public.fmcsa_leads for select
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

create policy "Org members can manage their org's fmcsa leads"
  on public.fmcsa_leads for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));
