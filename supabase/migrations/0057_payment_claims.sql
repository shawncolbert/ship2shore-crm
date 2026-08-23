-- A customer saying "I paid it" in an email reply is not proof money moved
-- (only the bank's own Zelle notification is, see zelle_payments) -- so this
-- never auto-marks anything paid. It just flags the claim so a dispatcher
-- notices it and goes to check the bank themselves, via an in-app popup
-- (while they're using the app) and an internal alert email (for when
-- they're not). Detected by gmail-sync from a known contact's inbound
-- email; provider_msg_id is the dedupe key against reprocessing.
create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  provider_msg_id text not null,
  sender_name text,
  message_snippet text,
  status text not null default 'pending' check (status in ('pending', 'acknowledged')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (org_id, provider_msg_id)
);

comment on table public.payment_claims is 'A customer email claiming they already paid an invoice/deposit. Informational only -- never auto-marks an invoice paid, since only a bank notification (zelle_payments) is proof. Surfaced as an in-app popup and an internal alert email; status=acknowledged means a dispatcher dismissed it after checking.';

alter table public.payment_claims enable row level security;

create policy "members manage payment claims" on public.payment_claims for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create index idx_payment_claims_org_status on public.payment_claims (org_id, status);
