-- MC (Motor Carrier authority) number, alongside DOT number -- Lead Finder's
-- "Verify a DOT/MC number" section checks both so a claimed identity can be
-- cross-referenced thoroughly rather than trusting a single number.
alter table public.fmcsa_leads
  add column if not exists mc_number text;
