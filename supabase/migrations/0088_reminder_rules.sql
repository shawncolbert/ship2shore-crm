-- Platform-admin-configured reminder rules (System Controls) -- e.g. "flag
-- a lead untouched for 3 days" or "flag an invoice unpaid after 7 days",
-- each with its own custom message. Evaluated client-side against the
-- signed-in user's own org data (ReminderPopupToast.jsx / fetchActiveReminders
-- in supabase.js) since that already goes through the org's normal RLS --
-- no service-role function needed to read contacts/opportunities/invoices,
-- only to manage the rules themselves cross-org.
create table if not exists public.reminder_rules (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  condition_type text not null check (condition_type in ('lead_not_followed_up', 'invoice_unpaid')),
  threshold_days integer not null check (threshold_days > 0),
  message        text not null,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ix_reminder_rules_org on public.reminder_rules(org_id, enabled);

alter table public.reminder_rules enable row level security;

-- Platform-admin only for writes -- same gate as feature_pricing, since this
-- is a Shawn-managed setting for each client, not something an org sets for
-- itself (yet).
drop policy if exists "platform admin manages reminder rules" on public.reminder_rules;
create policy "platform admin manages reminder rules" on public.reminder_rules
  for all
  using (exists (select 1 from public.profiles where id = auth.uid() and platform_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and platform_admin));

-- Org members need read access so their own CRM session can evaluate which
-- rules are active and show the pop-up -- select only, no write.
drop policy if exists "org members view own reminder rules" on public.reminder_rules;
create policy "org members view own reminder rules" on public.reminder_rules
  for select
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));
