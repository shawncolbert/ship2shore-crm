-- No ORDER BY meant Postgres could return a fuzzy name match's multiple
-- hits in a different order on different calls (whatever the planner
-- picked that time) -- the Prospecting UI only ever shows the first row,
-- so which contact appeared as "the match" was non-deterministic. Order by
-- name for a stable, predictable result.
create or replace function public.find_warm_lead_matches(
  p_org_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null
)
returns table (
  contact_id uuid,
  contact_name text,
  match_reason text
)
language sql
stable
as $$
  select id, full_name,
    case
      when p_phone is not null and phone = p_phone then 'phone matches an existing contact'
      when p_email is not null and email = p_email then 'email matches an existing contact'
      else 'name is similar to an existing contact'
    end as match_reason
  from public.contacts
  where org_id = p_org_id
    and (
      (p_phone is not null and phone = p_phone)
      or (p_email is not null and email = p_email)
      or (p_name is not null and full_name ilike '%' || p_name || '%')
    )
  order by full_name
$$;
