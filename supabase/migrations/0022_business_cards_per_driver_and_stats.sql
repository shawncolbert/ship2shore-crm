-- One card per org used to be enforced; now an org can have one card per
-- driver. Keep org_id indexed since it's still the main lookup path.
alter table public.business_cards drop constraint business_cards_org_id_key;
create index business_cards_org_id_idx on public.business_cards (org_id);

alter table public.business_cards
  add column share_count integer not null default 0,
  add column download_count integer not null default 0,
  add column scan_count integer not null default 0;

-- Atomic increments from the public (unauthenticated) card page -- called
-- via the service-role client in public-business-card.js, so this only
-- needs to be race-safe, not independently access-controlled.
create or replace function public.increment_business_card_stat(p_slug text, p_kind text)
returns void
language plpgsql
security definer
as $$
begin
  if p_kind = 'share' then
    update public.business_cards set share_count = share_count + 1 where slug = p_slug;
  elsif p_kind = 'download' then
    update public.business_cards set download_count = download_count + 1 where slug = p_slug;
  elsif p_kind = 'scan' then
    update public.business_cards set scan_count = scan_count + 1 where slug = p_slug;
  end if;
end;
$$;
