create table if not exists job_tracking (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  pickup_arrived_at timestamptz,
  dropoff_arrived_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_ping_at timestamptz,
  created_at timestamptz not null default now()
);

alter table job_tracking enable row level security;

-- Only org members (via Supabase auth) read/write this table. The
-- driver-facing /track/:token page is public and never touches Supabase
-- directly -- it goes through the tracking-* Netlify functions, which use
-- the service-role key and look rows up by token instead of by RLS.
create policy p_job_tracking_org on job_tracking
  for all
  using (org_id in (select current_user_org_ids()))
  with check (org_id in (select current_user_org_ids()));
