-- Agent 2 (in-house dispatch assignment) matches against Shawn's own
-- digital-business-card people, not third-party carrier contacts -- a
-- driver marks themselves eligible here, checked once per card, so future
-- cards opt in the same way instead of a hardcoded name list.
alter table public.business_cards
  add column offers_vehicle_transport boolean not null default false;

-- Which driver (business card) a job is currently assigned to -- a human
-- pick, never auto-assigned. Nullable: most jobs won't have one until a
-- dispatcher actually assigns it.
alter table public.opportunities
  add column assigned_driver_card_id uuid references public.business_cards(id) on delete set null;
