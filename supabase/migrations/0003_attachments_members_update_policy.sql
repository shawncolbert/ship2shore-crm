-- Applied to project ofntwhbbhujwyttmvlew.
-- attachments had SELECT/INSERT/DELETE policies but no UPDATE, so linking a
-- reviewed document from the Documents page (an UPDATE that sets opportunity_id
-- and clears needs_review) was silently denied under RLS — 0 rows changed, no
-- error. Add the same org-membership check the other attachment policies use.
create policy "members update attachments" on public.attachments
  for update
  using (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()))
  with check (org_id in (select memberships.org_id from memberships where memberships.profile_id = auth.uid()));
