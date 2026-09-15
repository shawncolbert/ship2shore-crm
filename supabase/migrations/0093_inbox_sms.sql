-- Inbox SMS lane (Phase 1): two-way texting with real customers, separate
-- from Prospecting's cold-outreach SMS. Consent is per-contact and explicit
-- -- having a phone number on file is never enough on its own. Granted via
-- a booking-form checkbox (future work) or the "Ask to text" one-time
-- consent-request message; a STOP reply always revokes it.
alter table public.contacts add column if not exists sms_consent boolean not null default false;
alter table public.contacts add column if not exists sms_consent_at timestamptz;

-- A second Twilio number dedicated to this lane, kept separate from
-- twilio_phone_number (Prospecting's) so the two traffic patterns don't mix
-- on one number's carrier reputation. Null until a dedicated number is
-- purchased -- the app falls back to twilio_phone_number until then, so
-- this lane can go live today and switch numbers later with zero code
-- changes, just filling in this column.
alter table public.organizations add column if not exists inbox_twilio_phone_number text;
