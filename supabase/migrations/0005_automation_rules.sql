-- Applied to project ofntwhbbhujwyttmvlew.
-- User-configurable stage-change automation rules. The stage-change-webhook
-- reads these instead of hardcoded logic; the Automations settings page edits them.
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  from_stage text,                 -- null = any previous stage
  to_stage text not null,          -- stage moved INTO (display name, e.g. 'Scheduled')
  action text not null check (action in ('send_customer_email','notify_internal','log_only')),
  email_subject text,
  email_body text,
  enabled boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_rules_org_idx on public.automation_rules (org_id, to_stage);

alter table public.automation_rules enable row level security;
drop policy if exists "members manage automation rules" on public.automation_rules;
create policy "members manage automation rules" on public.automation_rules
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

create or replace function public.touch_automation_rules_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_touch_automation_rules on public.automation_rules;
create trigger trg_touch_automation_rules before update on public.automation_rules
  for each row execute function public.touch_automation_rules_updated_at();

-- Seed the rules we already had (only if the table is empty).
insert into public.automation_rules (org_id, from_stage, to_stage, action, email_subject, email_body, position)
select * from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, null, 'Scheduled', 'send_customer_email',
   'Your Ship2Shore pickup is scheduled',
   E'Hi {{first_name}},\n\nThis confirms your Ship2Shore booking{{title_suffix}} is scheduled for {{scheduled_at}}.\n\nIf you need to make any changes, just reply to this email.\n\nThank you,\nShip2Shore Dispatch',
   0),
  ('11111111-1111-1111-1111-111111111111'::uuid, null, 'Completed', 'notify_internal', null, null, 1),
  ('11111111-1111-1111-1111-111111111111'::uuid, null, 'Canceled', 'notify_internal', null, null, 2),
  ('11111111-1111-1111-1111-111111111111'::uuid, null, 'Paid', 'log_only', null, null, 3)
) as v(org_id, from_stage, to_stage, action, email_subject, email_body, position)
where not exists (select 1 from public.automation_rules);
