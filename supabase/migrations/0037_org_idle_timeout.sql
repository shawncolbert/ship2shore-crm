-- Optional per-org idle timeout: after this many minutes of no mouse/
-- keyboard/touch activity, kick back to the branded "Enter CRM" front door
-- (useful for a shared/kiosk-style dispatch terminal). Off by default --
-- nothing changes for an org until they turn it on.
alter table public.organizations
  add column if not exists idle_timeout_enabled boolean not null default false,
  add column if not exists idle_timeout_minutes integer not null default 60;
