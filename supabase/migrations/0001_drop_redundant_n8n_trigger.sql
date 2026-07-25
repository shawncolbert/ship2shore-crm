-- Applied to project ofntwhbbhujwyttmvlew.
-- Removes a duplicate/competing n8n path so there is exactly ONE trigger that
-- fires the stage-change webhook.
--
-- The canonical path is:
--   trg_notify_stage_change (AFTER UPDATE on opportunities)
--     -> notify_stage_change()  (pg_net POST)
--     -> stage-change-webhook Edge Function
--     -> n8n (N8N_STAGE_CHANGE_WEBHOOK_URL)
--
-- The trigger below was an earlier, separate attempt that POSTed directly to a
-- per-org automation_settings.n8n_webhook_url. It's redundant now.

drop trigger if exists trg_opportunity_stage_change on public.opportunities;
drop function if exists public.notify_n8n_stage_change();
