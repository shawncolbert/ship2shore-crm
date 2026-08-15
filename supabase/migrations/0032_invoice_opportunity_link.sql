-- Lets a pipeline card find (or create) its own invoice. Nullable and
-- on delete set null -- an invoice is a billing record that should outlive
-- the pipeline card it was created from if that job is ever deleted.
alter table public.invoices
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;

create index if not exists invoices_opportunity_id_idx on public.invoices (opportunity_id);
