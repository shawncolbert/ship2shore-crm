-- Applied to project ofntwhbbhujwyttmvlew.
-- Part 5: auto-match Delivery Order / Ports America gate-pass PDFs from Gmail.

-- Ocean bill-of-lading / booking number the documents are matched on. Distinct
-- from billing_number (the ship billing # the dispatcher types on the card),
-- though matching checks both.
alter table public.opportunities add column if not exists bl_number text;
create index if not exists opportunities_bl_number_idx on public.opportunities (bl_number);

-- Fields for auto-ingested documents (source = 'gmail_auto').
alter table public.attachments add column if not exists bl_number text;
alter table public.attachments add column if not exists needs_review boolean not null default false;
alter table public.attachments add column if not exists source text;
alter table public.attachments add column if not exists provider_msg_id text;

-- Dedupe guard so the same Gmail attachment isn't stored twice across runs.
create unique index if not exists attachments_provider_msg_file_uniq
  on public.attachments (provider_msg_id, file_name)
  where provider_msg_id is not null;
