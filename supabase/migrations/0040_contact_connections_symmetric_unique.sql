-- The original unique constraint only blocked an exact-order duplicate
-- (A,B) -- it didn't stop someone also inserting (B,A) for the same pair,
-- which fetchConnections() would then show as two identical rows. The app's
-- UI already avoids offering an already-connected contact as an option (it
-- checks both directions before showing the picker), but that's a soft
-- guard, not something the database itself enforces. A unique index on the
-- pair's sorted order closes that gap regardless of insert order.
alter table public.contact_connections
  drop constraint contact_connections_contact_id_connected_contact_id_key;

create unique index contact_connections_unordered_pair_idx
  on public.contact_connections (least(contact_id, connected_contact_id), greatest(contact_id, connected_contact_id));
