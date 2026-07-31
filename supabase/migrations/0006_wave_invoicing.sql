-- Applied to project ofntwhbbhujwyttmvlew.
-- Wave (waveapps.com) invoicing integration.
alter table public.opportunities add column if not exists wave_invoice_id text;
alter table public.opportunities add column if not exists payment_status text not null default 'unpaid';
alter table public.opportunities drop constraint if exists opportunities_payment_status_check;
alter table public.opportunities add constraint opportunities_payment_status_check
  check (payment_status in ('unpaid','sent','paid'));
create index if not exists opportunities_wave_invoice_id_idx on public.opportunities (wave_invoice_id) where wave_invoice_id is not null;

-- Cache the Wave customer id per contact so repeat invoices reuse the same
-- Wave customer instead of creating a duplicate on every send.
alter table public.contacts add column if not exists wave_customer_id text;
