-- Decouples SMS-send eligibility from the general pipeline status field.
-- status is freely editable by staff for pipeline tracking (e.g. flipping
-- someone to "replied" because they answered a cold email) -- sms_opted_in
-- is the actual gate an SMS sequence step checks, and it can only ever be
-- set true by the real inbound-SMS webhook, never by hand in the UI. This
-- closes the gap where a staff-entered email reply could otherwise unlock
-- texting someone who never consented to that channel.
alter table public.prospects add column if not exists sms_opted_in boolean not null default false;
