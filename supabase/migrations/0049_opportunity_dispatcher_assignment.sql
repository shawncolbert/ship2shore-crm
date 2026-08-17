-- Manual lead assignment: hand a Pipeline job off to a dispatcher contact
-- (e.g. Warrior Auto Transport, Team Auto Transport/Dispatch -- both already
-- exist as contacts with segment='dispatcher'). Deliberately a Contact FK,
-- not a CRM user account -- Shawn's dispatch teams are outside companies he
-- works with by email, not people who log into this app. Manual for now;
-- automation_rules can grow an 'assign_dispatcher' action later the same way
-- send_customer_email/notify_internal already work.
alter table public.opportunities
  add column assigned_dispatcher_id uuid references public.contacts(id) on delete set null;

create index if not exists opportunities_assigned_dispatcher_idx on public.opportunities (assigned_dispatcher_id);
