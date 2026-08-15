-- Small text shown under the org's name in the sidebar and the "Enter CRM"
-- front door. Blank by default -- previously this was a hardcoded "Dispatch"
-- for every org regardless of what kind of business they actually run.
alter table public.organizations
  add column if not exists tagline text;
