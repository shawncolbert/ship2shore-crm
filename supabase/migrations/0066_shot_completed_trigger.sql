-- Stamps shot_completed_at the moment a job's stage changes to one named
-- "Shot" (case-insensitive), whichever code path moved it -- drag, the
-- progress-bar tap, or a direct API call. A trigger instead of client-side
-- logic so this can't be missed by adding another way to move a stage later.
create or replace function set_shot_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is distinct from old.stage_id and new.shot_completed_at is null then
    if exists (select 1 from stages where id = new.stage_id and lower(name) = 'shot') then
      new.shot_completed_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_shot_completed_at on opportunities;
create trigger trg_set_shot_completed_at
  before update on opportunities
  for each row
  execute function set_shot_completed_at();
