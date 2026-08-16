-- Social media presence found via Lead Finder's "Find website & social
-- media" discovery step (Firecrawl search), saved alongside website_url.
alter table public.fmcsa_leads
  add column if not exists social_links jsonb;
