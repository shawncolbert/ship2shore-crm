-- Emails Lead Finder's audit step actually found on the company's site
-- (or its contact page), separate from pitch_email (the drafted OUTREACH
-- email content) -- these two were being conflated before.
alter table public.fmcsa_leads
  add column if not exists contact_email text;
