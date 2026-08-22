-- Separate deposit-paid tracking from the existing balance-paid flag
-- (opportunities.paid), so the pipeline card can show "what's actually come
-- in" at a glance instead of one generic paid/unpaid state.

alter table public.opportunities
  add column deposit_paid boolean not null default false;

comment on column public.opportunities.deposit_paid is 'Manually toggled on the pipeline card, independent of opportunities.paid (the balance/final payment).';
