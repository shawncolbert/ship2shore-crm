-- Platform-admin "System Controls" (AdminOrgs.jsx) -- lets Shawn record
-- what he's actually charging a given client for a given feature, separate
-- from enabled_features (which controls visibility). A feature can be on
-- with no price recorded yet (bundled into a flat monthly rate, or just not
-- priced out yet) -- price is a reference for him, not something the app
-- enforces or bills automatically.
create table if not exists public.feature_pricing (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  feature_key   text not null,
  price_usd     numeric(10,2),
  updated_at    timestamptz not null default now(),
  unique (org_id, feature_key)
);

alter table public.feature_pricing enable row level security;

-- Platform-admin only, same gate as the enabled_features toggle itself --
-- ordinary org members (including the org's own owner) never see what
-- they're being charged per feature through this table; that's Shawn's
-- own pricing sheet, not client-facing billing.
drop policy if exists "platform admin manages feature pricing" on public.feature_pricing;
create policy "platform admin manages feature pricing" on public.feature_pricing
  for all
  using (exists (select 1 from public.profiles where id = auth.uid() and platform_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and platform_admin));
