-- Applied to project ofntwhbbhujwyttmvlew.
-- Line-item services/fees on a job, used by the AI agent's
-- add_service_item_to_opportunity / get_opportunity_items /
-- update_opportunity_total_from_items tools (netlify/functions/agent-controller.js).
-- Those tools were built against this table, but it was never created --
-- every call failed with "relation does not exist". This migration is the
-- backfill; the tool code itself needed no changes.

create table if not exists public.opportunity_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  service_type  text not null check (service_type = any (array['escort','storage','hotshot','big_rig','other'])),
  description   text,
  quantity      numeric not null default 1,
  unit_price    numeric not null default 0,
  total_price   numeric not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ix_opportunity_items_opportunity on public.opportunity_items(opportunity_id);
create index if not exists ix_opportunity_items_org on public.opportunity_items(org_id);

alter table public.opportunity_items enable row level security;

drop policy if exists "members manage opportunity items" on public.opportunity_items;
create policy "members manage opportunity items" on public.opportunity_items
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));
