-- Per-org TikTok OAuth tokens, populated by the tiktok-oauth-callback
-- function after a real human completes TikTok's own consent screen.
-- Same shape/lockdown as gmail_oauth_tokens: service-role only, no client
-- role (including the org's own authenticated members) can read these.
create table public.tiktok_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  open_id text,
  username text,
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

alter table public.tiktok_oauth_tokens enable row level security;

create policy "service role only" on public.tiktok_oauth_tokens
  for all using (false);
