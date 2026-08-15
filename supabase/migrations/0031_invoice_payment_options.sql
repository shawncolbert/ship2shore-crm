-- Lets an invoice carry more than just the auto-generated Stripe pay link.
-- Wave Checkout links are single-use (Wave has no API to mint one per
-- invoice automatically) so a dispatcher pastes a fresh one in per invoice,
-- rather than this being a reusable org-wide handle like Zelle/Venmo.
-- `payment_options` records which of the org's payment methods (Stripe,
-- Wave, and the existing Zelle/Venmo/Cash App/Apple Pay handles from
-- payment_settings) should actually be shown on this specific invoice.
-- Defaults to {"stripe": true} so every existing invoice keeps behaving
-- exactly like it did before this column existed.
alter table public.invoices
  add column if not exists wave_checkout_url text,
  add column if not exists payment_options jsonb not null default '{"stripe": true}'::jsonb;
