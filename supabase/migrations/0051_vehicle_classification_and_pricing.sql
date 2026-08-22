-- Vehicle classification + auto-pricing on the pipeline card.
-- Adds vehicle type/condition fields to opportunities, a lookup cache for
-- NHTSA VIN decodes, an editable per-org pricing_rules table, and a trigger
-- that computes a suggested_price (never touches confirmed_price/invoice).

alter table public.opportunities
  add column vehicle_body_class    text,
  add column vehicle_type          text check (vehicle_type in ('small','sedan','suv','truck','van','coupe')),
  add column vehicle_gvwr          text,
  add column vehicle_modification  text not null default 'stock' check (vehicle_modification in ('stock','raised','lowered')),
  add column vehicle_extended      boolean not null default false,
  add column suggested_price       numeric,
  add column confirmed_price       numeric;

comment on column public.opportunities.vehicle_body_class is 'Raw NHTSA vPIC BodyClass string, as returned by DecodeVinValues.';
comment on column public.opportunities.vehicle_type is 'Normalized vehicle type bucket used for pricing: small/sedan/suv/truck/van/coupe.';
comment on column public.opportunities.vehicle_gvwr is 'Raw NHTSA GVWR string; data is inconsistent across VINs, manual entry expected for a meaningful share.';
comment on column public.opportunities.vehicle_modification is 'Ride-height condition affecting pricing for suv/truck: stock/raised/lowered.';
comment on column public.opportunities.vehicle_extended is 'Truck-only: extended/long bed, adds a surcharge.';
comment on column public.opportunities.suggested_price is 'Auto-computed from base rate + pricing_rules surcharges. Never applied to the invoice automatically.';
comment on column public.opportunities.confirmed_price is 'Dispatcher-confirmed price, copied from suggested_price only on explicit confirmation.';

create table public.vehicle_type_cache (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  year text not null,
  body_class text,
  vehicle_type text not null check (vehicle_type in ('small','sedan','suv','truck','van','coupe')),
  created_at timestamptz not null default now(),
  unique (make, model, year)
);
comment on table public.vehicle_type_cache is 'Caches NHTSA vPIC make/model/year -> vehicle_type lookups so vin-decode skips repeat API calls. Service-role/edge-function access only, no client policies.';
alter table public.vehicle_type_cache enable row level security;

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  condition text not null check (condition in ('suv','raised','lowered','extended')),
  surcharge_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, condition)
);
comment on table public.pricing_rules is 'Editable per-org surcharge amounts stacked onto the base rate to compute suggested_price.';
alter table public.pricing_rules enable row level security;

create policy "members manage pricing rules" on public.pricing_rules for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

insert into public.pricing_rules (org_id, condition, surcharge_amount) values
  ('11111111-1111-1111-1111-111111111111', 'suv', 200),
  ('11111111-1111-1111-1111-111111111111', 'raised', 125),
  ('11111111-1111-1111-1111-111111111111', 'lowered', 75),
  ('11111111-1111-1111-1111-111111111111', 'extended', 200);

create or replace function public.calculate_suggested_price()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_base numeric;
  v_conditions text[] := array[]::text[];
  v_surcharge numeric;
begin
  select default_rate into v_base from public.services
    where org_id = new.org_id and code = new.service_code and active = true limit 1;
  if v_base is null then v_base := coalesce(new.value, 0); end if;

  if new.vehicle_type = 'suv' then v_conditions := array_append(v_conditions, 'suv'); end if;
  if new.vehicle_modification = 'raised' then v_conditions := array_append(v_conditions, 'raised'); end if;
  if new.vehicle_modification = 'lowered' then v_conditions := array_append(v_conditions, 'lowered'); end if;
  if new.vehicle_type = 'truck' and new.vehicle_extended then v_conditions := array_append(v_conditions, 'extended'); end if;

  select coalesce(sum(surcharge_amount), 0) into v_surcharge
    from public.pricing_rules where org_id = new.org_id and condition = any(v_conditions);

  new.suggested_price := v_base + v_surcharge;
  return new;
end;
$$;

create trigger trg_calculate_suggested_price
  before insert or update of vehicle_type, vehicle_modification, vehicle_extended, value, service_code
  on public.opportunities
  for each row execute function public.calculate_suggested_price();

create or replace function public.preview_suggested_price(
  p_org_id uuid, p_service_code text, p_value numeric,
  p_vehicle_type text, p_vehicle_modification text, p_vehicle_extended boolean
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_base numeric;
  v_conditions text[] := array[]::text[];
  v_surcharge numeric;
begin
  if p_org_id not in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()) then
    raise exception 'Not authorized for this organization';
  end if;

  select default_rate into v_base from public.services
    where org_id = p_org_id and code = p_service_code and active = true limit 1;
  if v_base is null then v_base := coalesce(p_value, 0); end if;

  if p_vehicle_type = 'suv' then v_conditions := array_append(v_conditions, 'suv'); end if;
  if p_vehicle_modification = 'raised' then v_conditions := array_append(v_conditions, 'raised'); end if;
  if p_vehicle_modification = 'lowered' then v_conditions := array_append(v_conditions, 'lowered'); end if;
  if p_vehicle_type = 'truck' and p_vehicle_extended then v_conditions := array_append(v_conditions, 'extended'); end if;

  select coalesce(sum(surcharge_amount), 0) into v_surcharge
    from public.pricing_rules where org_id = p_org_id and condition = any(v_conditions);

  return v_base + v_surcharge;
end;
$$;

revoke all on function public.preview_suggested_price(uuid, text, numeric, text, text, boolean) from public;
grant execute on function public.preview_suggested_price(uuid, text, numeric, text, text, boolean) to authenticated;
