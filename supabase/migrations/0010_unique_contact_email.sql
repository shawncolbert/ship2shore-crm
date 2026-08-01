-- Applied to project ofntwhbbhujwyttmvlew.
-- Makes duplicate contacts structurally impossible.
--
-- Background: gmail-enrichment looked contacts up with .maybeSingle(), which
-- errors (rather than returning null) when more than one row matches. That
-- error was swallowed, so any contact that already had a duplicate looked
-- "not found" on every run and was re-inserted every 15 minutes. One contact
-- reached 27 copies. The lookup is fixed, and 86 duplicate rows across 52
-- people were merged (children reassigned first, so no messages, jobs,
-- attachments or upload links were lost).
--
-- This index is the backstop: even if some future write path forgets to
-- normalise, Postgres now refuses the duplicate outright. Case-insensitive,
-- because the original divergence was purely one of casing -- the Calendly
-- webhook stored the invitee's raw input while every other path lowercased.

create unique index if not exists uq_contacts_org_email_lower
  on public.contacts (org_id, lower(email))
  where email is not null;
