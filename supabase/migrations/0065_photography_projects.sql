-- Extends opportunities with photography project tracking (Tre Colbert
-- Photography) instead of a parallel clients/projects schema -- reuses the
-- existing contacts/opportunities/pipeline system every other org already
-- runs on. scheduled_at already covers "shoot date"; these three are
-- genuinely new milestones/data with no existing column to reuse.
alter table opportunities add column if not exists project_type text check (project_type in ('wedding', 'real_estate'));
alter table opportunities add column if not exists shot_completed_at timestamptz;
alter table opportunities add column if not exists gallery_link text;

-- Mirrors contacts.custom_fields (already used for vendor tagging) --
-- venue name, property address, whatever a given org's job type needs,
-- without a schema change per field.
alter table opportunities add column if not exists custom_fields jsonb not null default '{}'::jsonb;
