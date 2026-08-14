-- In-app invoicing (replaces the need for Wave's paid API tier for this).
-- Line items snapshot a service's name/price at invoice time so editing or
-- deleting a service later never changes a past invoice's numbers.

create sequence if not exists public.invoice_number_seq start 1001;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  contact_id uuid references public.contacts(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,

  invoice_number text not null default ('INV-' || nextval('public.invoice_number_seq')::text),
  po_number text,

  bill_to_name text,
  bill_to_address text,
  bill_to_phone text,
  bill_to_email text,

  ship_to_name text,
  ship_to_address text,
  ship_to_phone text,

  invoice_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue')),
  notes text,

  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_due numeric(12,2) not null default 0,

  stripe_payment_link_id text,
  stripe_payment_link_url text,
  stripe_checkout_session_id text,
  paid_at timestamptz,
  payment_method text,

  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, invoice_number)
);

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoices_org_id_idx on public.invoices (org_id);
create index if not exists invoices_contact_id_idx on public.invoices (contact_id);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);
create index if not exists invoice_line_items_org_id_idx on public.invoice_line_items (org_id);
-- The Stripe webhook looks up an invoice by payment link id -- needs to be
-- fast and only ever matches one row.
create unique index if not exists invoices_stripe_payment_link_id_idx
  on public.invoices (stripe_payment_link_id) where stripe_payment_link_id is not null;

alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;

create policy "org members manage their invoices" on public.invoices
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

create policy "org members manage their invoice line items" on public.invoice_line_items
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

-- Business info printed on the invoice header (name/address/phone/website/EIN).
-- Nullable and separate from the org's display `name` -- an org may want a
-- different legal/billing name on invoices than what shows in the app nav.
alter table public.organizations
  add column if not exists invoice_business_name text,
  add column if not exists invoice_business_address text,
  add column if not exists invoice_business_phone text,
  add column if not exists invoice_business_website text,
  add column if not exists invoice_business_ein text;
