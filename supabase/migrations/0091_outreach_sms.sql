-- Prospecting & Outreach Phase 3 (SMS half only -- Instagram/Facebook DM
-- needs a full Meta Business API setup and stays out of scope). Each org
-- owns its own Twilio number, same isolation principle as Gmail/Telegram --
-- an org's SMS sequence never goes out under another org's number.
alter table public.organizations add column if not exists twilio_account_sid text;
alter table public.organizations add column if not exists twilio_auth_token text;
alter table public.organizations add column if not exists twilio_phone_number text;

-- Phone-side suppression, parallel to the existing email column. A STOP
-- reply suppresses the phone; it says nothing about that person's email,
-- and vice versa -- the two channels opt out independently. email was
-- previously required on every row; a phone-only STOP (no email on file)
-- needs that relaxed, backed by a check that at least one is always set.
alter table public.do_not_contact alter column email drop not null;
alter table public.do_not_contact add column if not exists phone text;
alter table public.do_not_contact drop constraint if exists ck_do_not_contact_has_contact;
alter table public.do_not_contact add constraint ck_do_not_contact_has_contact check (email is not null or phone is not null);
create unique index if not exists uq_do_not_contact_org_phone on public.do_not_contact (org_id, phone) where phone is not null;

-- Which channel actually sent -- subject stays email-only (SMS has no
-- subject line), channel is what the sequence-sender and any reporting
-- filter on.
alter table public.outreach_sends add column if not exists channel text not null default 'email' check (channel in ('email', 'sms'));
