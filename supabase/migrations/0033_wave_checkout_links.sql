-- Wave Checkout links turn out to be reusable (they're meant for repeat
-- customers, like a barcode/link you keep handing out), not single-use as
-- first assumed -- so this replaces the old paste-a-fresh-link-per-invoice
-- field with a small saved library per org, picked from a dropdown on the
-- invoice instead of retyped every time.
create table if not exists public.wave_checkout_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  label text not null,
  amount numeric(12,2),
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists wave_checkout_links_org_id_idx on public.wave_checkout_links (org_id);

alter table public.wave_checkout_links enable row level security;

create policy "org members manage their wave checkout links" on public.wave_checkout_links
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

-- Invoices keep referencing the specific saved link (for the dropdown to
-- reselect it on re-edit) alongside the existing wave_checkout_url, which
-- stays as a snapshot of the URL at save time so a past invoice keeps
-- working even if the saved link is later edited or deleted.
alter table public.invoices
  add column if not exists wave_checkout_link_id uuid references public.wave_checkout_links(id) on delete set null;
