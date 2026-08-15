-- Opt-in payment reminders (per invoice, off by default) and a "job
-- completed" marker distinct from payment status -- a job can be done
-- (car picked up / service performed) before the invoice is paid, and the
-- two need their own dates.
alter table public.invoices
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_interval_days integer,
  add column if not exists last_reminder_sent_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;
