-- Old/existing clients (the pre-transport, escort-vehicle-service customer
-- base) get tagged 'escort' so they're never contacted about transport --
-- see the backfill in the same migration set. New contacts default to
-- transport-eligible (no segment, or one of the existing values) unless
-- someone manually tags them escort.
alter table public.contacts drop constraint contacts_segment_check;
alter table public.contacts add constraint contacts_segment_check
  check (segment = any (array['broker', 'dispatcher', 'military', 'transporter', 'private', 'other', 'escort']));
