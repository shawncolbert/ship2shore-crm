-- Prospecting failsafe: a per-org daily send cap for outreach, so an
-- accidental mass-enrollment (huge CSV import, "select all" + enroll)
-- can't blast hundreds of cold emails/texts in one scheduled run. Defaults
-- are conservative starting points for a brand-new sender reputation; each
-- org can raise or lower them once its own sending history justifies it.
alter table public.organizations
  add column if not exists outreach_daily_email_limit integer not null default 150,
  add column if not exists outreach_daily_sms_limit integer not null default 100;
