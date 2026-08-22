-- Customer-facing job contract: sent to secure a load before/alongside the
-- deposit invoice. Renders a snapshot of the agreement text + price at send
-- time (so a later price edit never silently changes what was already
-- signed), and the customer accepts by typing their name + a checkbox on a
-- public page -- no third-party e-signature service.
--
-- No anon/public RLS policy, on purpose: the customer-facing read/sign flow
-- goes through the service-role Netlify functions (contract-send.js,
-- public-contract.js, contract-sign.js), the same pattern already used for
-- public-invoice.js/invoice-send.js. Only org members get direct table
-- access.

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  deposit_invoice_id uuid references public.invoices(id) on delete set null,
  body text not null,
  bill_to_name text,
  bill_to_email text,
  total_price numeric,
  deposit_amount numeric,
  status text not null default 'sent' check (status in ('sent', 'signed', 'void')),
  signer_name text,
  signed_at timestamptz,
  signer_ip text,
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contracts is 'Customer-facing job agreement, sent to secure a load. body is a frozen snapshot of the rendered contract text/price at send time, not a live template.';
comment on column public.contracts.body is 'Fully rendered contract text as shown to the customer -- immutable once sent, even if the template or job details change later.';
comment on column public.contracts.deposit_invoice_id is 'The deposit invoice created and sent automatically once the customer signs.';

alter table public.contracts enable row level security;

create policy "members manage contracts" on public.contracts for all
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));

create trigger trg_touch_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

create index idx_contracts_opportunity on public.contracts (opportunity_id);
