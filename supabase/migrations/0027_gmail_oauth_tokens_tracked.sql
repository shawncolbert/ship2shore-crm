-- Applied to project ofntwhbbhujwyttmvlew.
-- Tracks the gmail_oauth_tokens table, which already existed live (created
-- directly, no migration) with Ship2Shore's own connected account in it.
-- `create table if not exists` is a no-op against the live table/data; the
-- new unique(org_id) constraint is what's actually new here -- safe today
-- since exactly one row exists, and it's what makes the upcoming
-- "Connect Gmail" OAuth callback's upsert-by-org_id well-defined (one
-- connected Gmail account per org, same model as tiktok_oauth_tokens).

create table if not exists public.gmail_oauth_tokens (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  email         text not null,
  refresh_token text not null,
  access_token  text,
  token_expiry  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.gmail_oauth_tokens
  add constraint gmail_oauth_tokens_org_id_key unique (org_id);

alter table public.gmail_oauth_tokens enable row level security;

drop policy if exists "service role only" on public.gmail_oauth_tokens;
create policy "service role only" on public.gmail_oauth_tokens
  for all using (false);
