-- Applied to project ofntwhbbhujwyttmvlew.
-- Manual payment-request sending (Zelle/Venmo/Cash App/Apple Pay) — no API,
-- so these platforms can never confirm payment automatically; a dispatcher
-- still moves the card to Paid by hand once the money lands.

create table if not exists public.payment_settings (
  org_id uuid primary key,
  zelle_handle text,
  venmo_handle text,
  cashapp_handle text,
  apple_pay_handle text,
  default_method text,
  updated_at timestamptz not null default now()
);
alter table public.payment_settings
  add constraint payment_settings_default_method_check
  check (default_method in ('zelle','venmo','cashapp','apple_pay') or default_method is null);

alter table public.payment_settings enable row level security;
drop policy if exists "members manage payment settings" on public.payment_settings;
create policy "members manage payment settings" on public.payment_settings
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

create or replace function public.touch_payment_settings_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_touch_payment_settings on public.payment_settings;
create trigger trg_touch_payment_settings before update on public.payment_settings
  for each row execute function public.touch_payment_settings_updated_at();

-- Stamp on the opportunity: when a payment request last went out, and via
-- which method (also doubles as "the method to reuse" for the automation
-- action below).
alter table public.opportunities add column if not exists payment_requested_at timestamptz;
alter table public.opportunities add column if not exists payment_method_requested text;
alter table public.opportunities drop constraint if exists opportunities_payment_method_requested_check;
alter table public.opportunities add constraint opportunities_payment_method_requested_check
  check (payment_method_requested in ('zelle','venmo','cashapp','apple_pay') or payment_method_requested is null);

-- Let an automation rule fire a payment request on a stage move (Part 1's
-- automation_rules system) -- opt-in per rule via the existing enabled toggle.
alter table public.automation_rules drop constraint if exists automation_rules_action_check;
alter table public.automation_rules add constraint automation_rules_action_check
  check (action in ('send_customer_email','notify_internal','log_only','send_payment_request'));
