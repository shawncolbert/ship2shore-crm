-- Phase 1 of load-board integration: no API access from Central Dispatch or
-- Super Dispatch on any plan available to us, so instead of a separate
-- "Dispatch Engine" board, every job on the existing Pipeline just gets
-- tagged with where it came from. One board to work from, not several --
-- Phase 2 (auto-capturing won loads from confirmation emails) builds on
-- this same column later.

alter table public.opportunities
  add column source_board text,
  add column board_order_number text;
