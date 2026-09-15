-- Phase 2 of the Inbox SMS lane: an automation rule can now text a customer
-- on a stage move, same opt-in-per-rule pattern as send_payment_request.
-- Actually sending is gated on contacts.sms_consent in stage-change-webhook
-- (the edge function) -- a rule with no consented contact just skips,
-- same "never text without consent" guarantee as everywhere else.
alter table public.automation_rules add column if not exists sms_body text;

alter table public.automation_rules drop constraint if exists automation_rules_action_check;
alter table public.automation_rules add constraint automation_rules_action_check
  check (action in ('send_customer_email','notify_internal','log_only','send_payment_request','send_customer_sms'));

-- Pre-existing gap found while wiring up SMS here: stage-change-webhook has
-- always logged automation runs as activities.type = 'automation', but that
-- value was never in this constraint -- every automation's audit-trail
-- entry has been silently failing (the actual email/payment/etc. action
-- itself already succeeded by that point, so nothing else was lost).
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check
  check (type in ('note','status_change','call','system','automation'));
