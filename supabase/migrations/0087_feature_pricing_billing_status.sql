-- System Controls (AdminOrgs.jsx) -- separates "does this org have the
-- feature turned on" (enabled_features, unchanged) from "are they actually
-- being charged for it" (billing_active here). Lets Shawn give someone a
-- free trial month on a feature -- flip it on, leave billing_active off,
-- optionally set free_until as his own reminder of when to turn billing
-- back on -- without it ever looking like a real charge to anyone, since
-- this table is platform-admin-only regardless.
alter table public.feature_pricing add column if not exists billing_active boolean not null default true;
alter table public.feature_pricing add column if not exists free_until date;
