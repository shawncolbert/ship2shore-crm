-- Vehicle description, used in the auto-generated social caption ("{{vehicle}}
-- picked up at {{port}}") and shown alongside title/port on the job card.
alter table public.opportunities
  add column vehicle text;

-- Gate location the completion video was shot at. NULL until a human
-- explicitly tags it -- the completion-video webhook only ever fires for
-- 'outside_gate'; untagged or 'inside_gate' videos are never auto-posted.
alter table public.attachments
  add column gate_status text;

alter table public.attachments
  add constraint attachments_gate_status_check
    check (gate_status is null or gate_status = any (array['outside_gate'::text, 'inside_gate'::text]));

-- Fires once per completion-video attachment tagged outside_gate. Mirrors
-- notify_stage_change()'s pg_net pattern exactly (see
-- 0001_drop_redundant_n8n_trigger.sql for why there's only ever one trigger
-- per event type, not competing paths).
create or replace function public.notify_completion_video()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.kind = 'completion_video' and new.gate_status = 'outside_gate' then
    perform net.http_post(
      url := 'https://ofntwhbbhujwyttmvlew.supabase.co/functions/v1/completion-video-webhook',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'attachment_id', new.id,
        'opportunity_id', new.opportunity_id,
        'contact_id', new.contact_id,
        'org_id', new.org_id
      )
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_completion_video
  after insert on public.attachments
  for each row execute function public.notify_completion_video();
