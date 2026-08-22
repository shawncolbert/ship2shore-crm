-- Auto-detects Zelle "you received money" notification emails in each
-- org's connected Gmail account (gmail-sync, every 15 min) and matches
-- them to an open invoice by amount + sender name. An unambiguous match
-- (exactly one open invoice at that amount, name lines up) is marked paid
-- automatically; anything else lands here as 'pending' for a one-click
-- confirm/dismiss instead of guessing. Every detected Zelle email gets a
-- row either way, so this doubles as the dedupe key (provider_msg_id) that
-- keeps the next sync run from reprocessing the same email.
create table public.zelle_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider_msg_id text not null,
  amount numeric not null,
  sender_name text,
  memo text,
  invoice_id uuid references public.invoices(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'matched', 'dismissed')),
  auto_matched boolean not null default false,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (org_id, provider_msg_id)
);

comment on table public.zelle_payments is 'One row per detected "Zelle payment received" email. status=matched means it was applied to an invoice (auto_matched=true) or confirmed by a dispatcher (auto_matched=false); pending means it needs a one-click confirm; dismissed means a dispatcher ruled it out.';

alter table public.zelle_payments enable row level security;

create policy "members manage zelle payments" on public.zelle_payments for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create index idx_zelle_payments_org_status on public.zelle_payments (org_id, status);
