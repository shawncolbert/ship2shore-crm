-- Applied to project ofntwhbbhujwyttmvlew.
-- Foundation for per-org customizable pipelines (the "Per-Org
-- Customization" brief). Two additions to the *existing* stages table
-- rather than a new parallel org_pipeline_stages table -- stages/pipelines
-- are already org_id-scoped and deeply wired into opportunities,
-- automations, the dashboard, and the AI agent, so forking a second
-- stages concept would create two competing systems.
--
-- color: purely cosmetic, shown on the pipeline board / admin UI.
--
-- is_intake: every booking-creation code path (create-booking.js,
-- funnel-submit.js, public-booking.js, createContactWithBooking) needs to
-- find "the stage new work lands in" for an org whose stage names it
-- doesn't control. Previously that was a hardcoded string match on "New
-- Booking", which only worked for Ship2Shore -- a photography org wants
-- their intake stage called "New Lead", a real estate org might want
-- "New Listing". is_intake decouples the *role* from the *name*: exactly
-- one stage per pipeline may be flagged (enforced by the partial unique
-- index below), and lookups check the flag first, falling back to a
-- "New Booking" name match only for backward compatibility with any org
-- that predates this column.

alter table public.stages add column if not exists color text;
alter table public.stages add column if not exists is_intake boolean not null default false;

-- Backfill: flag Ship2Shore's existing "New Booking" stage, and the first
-- (position 0) stage of any other org's pipeline that doesn't already
-- have one flagged.
update public.stages set is_intake = true
where lower(name) = 'new booking'
  and org_id = '11111111-1111-1111-1111-111111111111';

update public.stages s set is_intake = true
where s.position = 0
  and s.org_id <> '11111111-1111-1111-1111-111111111111'
  and not exists (select 1 from public.stages s2 where s2.pipeline_id = s.pipeline_id and s2.is_intake = true);

create unique index if not exists uq_stages_one_intake_per_pipeline
  on public.stages (pipeline_id) where is_intake = true;

-- Backfill: any org with zero pipelines (broken dashboard/booking flow)
-- gets a simple 4-stage starter pipeline. admin-create-org.js seeds the
-- same shape for every org created from here on.
do $$
declare
  v_org record;
  v_pipeline_id uuid;
begin
  for v_org in
    select o.id from public.organizations o
    where not exists (select 1 from public.pipelines p where p.org_id = o.id)
  loop
    insert into public.pipelines (org_id, name, is_default)
    values (v_org.id, 'Main Pipeline', true)
    returning id into v_pipeline_id;

    insert into public.stages (org_id, pipeline_id, name, position, color, is_intake) values
      (v_org.id, v_pipeline_id, 'New Lead', 0, '#e8a317', true),
      (v_org.id, v_pipeline_id, 'Scheduled', 1, '#22d3ee', false),
      (v_org.id, v_pipeline_id, 'Completed', 2, '#1fa97a', false),
      (v_org.id, v_pipeline_id, 'Canceled', 100, '#d9534f', false);
  end loop;
end $$;
