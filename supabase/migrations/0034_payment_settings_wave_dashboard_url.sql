-- Org-specific shortcut to that org's own Wave payouts/checkout-settings
-- page, so the "Create a new Wave Checkout" button can jump straight there
-- instead of Wave's generic login page. Deliberately per-org (not a
-- hardcoded URL in app code) -- Wave account URLs are business-specific,
-- so hardcoding one would send every other org straight to a stranger's
-- Wave payouts page.
alter table public.payment_settings
  add column if not exists wave_dashboard_url text;
