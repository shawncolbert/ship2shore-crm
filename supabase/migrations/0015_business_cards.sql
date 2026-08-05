-- Applied to project ofntwhbbhujwyttmvlew.
-- Digital business card feature: one row per org, a public share page at
-- /card/:slug, and a self-serve builder at /settings/business-card. See
-- src/lib/businessCard.js for the shape of tools_list/locations_list/
-- payment_methods.

create table public.business_cards (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null unique references public.organizations(id) on delete cascade,
  slug                      text not null unique,

  -- Branding
  brand_name                text,
  brand_logo_url            text,
  brand_icon                text not null default '⚓',
  primary_bg                text not null default '#0c1a24',
  panel_bg                  text not null default '#152633',
  accent_color              text not null default '#22d3ee',
  cta_color                 text not null default '#e8a317',

  -- Identity
  full_name                 text,
  title                     text,
  company_line              text,
  address_line1             text,
  address_line2             text,

  -- Credential badge
  credential_badge_text     text,
  credential_badge_enabled  boolean not null default false,

  -- Contact buttons
  phone                     text,
  sms_number                text,
  email                     text,

  -- CTAs
  primary_cta_label         text not null default 'Save to Contacts',
  secondary_cta_label       text,
  secondary_cta_url         text,

  -- Repeatable sections
  tools_list                jsonb not null default '[]'::jsonb,
  tools_section_label       text not null default 'Documents & Tools',
  locations_list            jsonb not null default '[]'::jsonb,
  locations_section_label   text not null default 'Locations',
  payment_methods           jsonb not null default '[]'::jsonb,

  -- Footer + sharing
  footer_tagline            text,
  hours_line                text,
  share_prompt_text         text not null default 'Send your info',

  is_published              boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index ix_business_cards_org on public.business_cards(org_id);

alter table public.business_cards enable row level security;

drop policy if exists "members manage business card" on public.business_cards;
create policy "members manage business card" on public.business_cards
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

create or replace function public.touch_business_cards_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_touch_business_cards on public.business_cards;
create trigger trg_touch_business_cards before update on public.business_cards
  for each row execute function public.touch_business_cards_updated_at();

-- Seed a default row for every org that already exists so the builder is
-- never a blank crash on first login.
insert into public.business_cards (org_id, slug, brand_name, full_name)
select o.id,
       coalesce(nullif(o.slug, ''), 'card-' || substr(o.id::text, 1, 8)),
       o.name,
       o.name
from public.organizations o
where not exists (select 1 from public.business_cards bc where bc.org_id = o.id);
