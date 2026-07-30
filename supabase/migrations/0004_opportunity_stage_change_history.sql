-- Applied to project ofntwhbbhujwyttmvlew.
-- Records every opportunity stage transition so reporting can count exactly
-- when jobs closed (moved into Completed/Paid), instead of approximating from
-- updated_at.
create table if not exists public.opportunity_stage_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  from_stage_id uuid,
  to_stage_id uuid,
  from_stage text,
  to_stage text,
  changed_at timestamptz not null default now()
);
create index if not exists opp_stage_changes_reporting_idx
  on public.opportunity_stage_changes (org_id, to_stage, changed_at);
create index if not exists opp_stage_changes_opp_idx
  on public.opportunity_stage_changes (opportunity_id);

-- SECURITY DEFINER so the insert works regardless of who performs the update
-- (the client does the UPDATE as the authed user).
create or replace function public.log_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_to text;
begin
  if (tg_op = 'INSERT') then
    select name into v_to from public.stages where id = new.stage_id;
    insert into public.opportunity_stage_changes
      (org_id, opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage)
    values (new.org_id, new.id, null, new.stage_id, null, v_to);
  elsif (tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id) then
    select name into v_from from public.stages where id = old.stage_id;
    select name into v_to from public.stages where id = new.stage_id;
    insert into public.opportunity_stage_changes
      (org_id, opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage)
    values (new.org_id, new.id, old.stage_id, new.stage_id, v_from, v_to);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_stage_change_ins on public.opportunities;
create trigger trg_log_stage_change_ins
  after insert on public.opportunities
  for each row execute function public.log_stage_change();

drop trigger if exists trg_log_stage_change_upd on public.opportunities;
create trigger trg_log_stage_change_upd
  after update of stage_id on public.opportunities
  for each row execute function public.log_stage_change();

-- Read access for org members (the dashboard reads it); inserts happen via the
-- SECURITY DEFINER trigger, so no insert policy is needed.
alter table public.opportunity_stage_changes enable row level security;
drop policy if exists "members read stage changes" on public.opportunity_stage_changes;
create policy "members read stage changes" on public.opportunity_stage_changes
  for select using (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

-- One-time backfill: seed history for jobs already sitting in Completed/Paid,
-- using their last-updated time as the change time.
insert into public.opportunity_stage_changes
  (org_id, opportunity_id, to_stage_id, to_stage, changed_at)
select o.org_id, o.id, o.stage_id, s.name, o.updated_at
from public.opportunities o
join public.stages s on s.id = o.stage_id
where s.name in ('Completed','Paid')
  and not exists (
    select 1 from public.opportunity_stage_changes c
    where c.opportunity_id = o.id and c.to_stage = s.name
  );
