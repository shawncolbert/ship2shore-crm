-- Backfill: documents add_google_marketing_tokens, applied directly against
-- the database on 2026-09-04 (Supabase migration history:
-- 20260904205722_add_google_marketing_tokens) without a matching file ever
-- landing in this repo. See 0077_seo_analytics_tables.sql for why this
-- exists. Per-org OAuth connection to Google Search Console + Analytics
-- (webmasters.readonly, analytics.readonly). Separate from
-- gmail_oauth_tokens on purpose -- an org may want SEO visibility without
-- granting Gmail access, or vice versa.
create table public.google_marketing_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamptz not null,
  gsc_site_url text,
  ga4_property_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

comment on table public.google_marketing_tokens is 'Per-org OAuth connection to Google Search Console + Analytics (webmasters.readonly, analytics.readonly). Populates search_performance and site_analytics via google-marketing-sync.js. Separate from gmail_oauth_tokens on purpose -- an org may want SEO visibility without granting Gmail access, or vice versa.';

alter table public.google_marketing_tokens enable row level security;

create policy "service role only" on public.google_marketing_tokens
  for all using (false);
