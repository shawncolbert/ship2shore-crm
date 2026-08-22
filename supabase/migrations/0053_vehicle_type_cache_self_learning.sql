-- Turns vehicle_type_cache into a self-learning cache: every job saved with
-- a vehicle type + year/make/model teaches the cache, so the second time any
-- dispatcher sees a given vehicle (however unusual -- JDM imports especially,
-- which no VIN decoder covers well) it's an instant, correct answer instead
-- of "pick it yourself" again. A real NHTSA VIN decode is still ground truth
-- and can never be overwritten by a manual save; only another manual save
-- can correct a manual entry.

alter table public.vehicle_type_cache
  add column source text not null default 'nhtsa' check (source in ('nhtsa', 'manual'));

comment on column public.vehicle_type_cache.source is 'nhtsa = confirmed via a real VIN decode, protected from being overwritten by a manual save. manual = learned from a dispatcher-saved job; only another manual save or a real NHTSA decode can overwrite it.';

create or replace function public.learn_vehicle_type_cache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vehicle_type_cache (make, model, year, vehicle_type, body_class, source)
  values (new.vehicle_make, new.vehicle_model, new.vehicle_year, new.vehicle_type, new.vehicle_body_class, 'manual')
  on conflict (make, model, year) do update
    set vehicle_type = excluded.vehicle_type, body_class = coalesce(excluded.body_class, vehicle_type_cache.body_class), source = 'manual'
    where vehicle_type_cache.source = 'manual';
  return new;
end;
$$;

revoke all on function public.learn_vehicle_type_cache() from public, anon, authenticated;

create trigger trg_learn_vehicle_type_cache
  after insert or update of vehicle_type, vehicle_year, vehicle_make, vehicle_model
  on public.opportunities
  for each row
  when (new.vehicle_type is not null and new.vehicle_year is not null and new.vehicle_make is not null and new.vehicle_model is not null)
  execute function public.learn_vehicle_type_cache();
