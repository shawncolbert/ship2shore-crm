-- Per-org Buffer credentials + channel mapping. Buffer has no OAuth
-- "connect" flow here (unlike TikTok) -- the org owner generates a
-- personal access key from their own Buffer account and it's stored
-- per-org rather than a global Netlify env var, for the same reason
-- tiktok_oauth_tokens/gmail_oauth_tokens are: a second org's Buffer key
-- must never be reachable through another org's rows. Service-role only,
-- same lockdown as those tables.
create table public.buffer_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  api_key text not null,
  channel_instagram text,
  channel_facebook text,
  channel_tiktok text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

alter table public.buffer_connections enable row level security;

create policy "service role only" on public.buffer_connections
  for all using (false);
