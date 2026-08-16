-- Known Connections: links two contact records together, with an optional
-- note. Also includes a helper function to check a new prospect (by name/
-- phone/email) against existing contacts, so the prospecting tool can flag
-- "warm" leads -- a match here means the app should then look up
-- contact_connections for that matched contact to surface who they're
-- connected to.
--
-- Adapted to this project's actual schema: contacts (not "clients"),
-- full_name (not "name"), and public.memberships keyed by profile_id
-- (not "org_members"/user_id) -- see e.g. 0028_invoices.sql for the same
-- membership-check pattern used elsewhere in this codebase.

create table if not exists public.contact_connections (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  connected_contact_id uuid not null references public.contacts(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  constraint contact_connections_not_self check (contact_id <> connected_contact_id),
  unique (contact_id, connected_contact_id)
);

create index if not exists contact_connections_contact_id_idx on public.contact_connections(contact_id);
create index if not exists contact_connections_connected_contact_id_idx on public.contact_connections(connected_contact_id);

-- contacts.org_id is authoritative; contact_connections has no org_id of its
-- own, so guard against ever linking two contacts from different orgs (the
-- RLS policies below only check contact_id's org, so without this a member
-- could point connected_contact_id at another org's contact row).
create or replace function public.enforce_contact_connections_same_org()
returns trigger
language plpgsql
as $$
begin
  if (select org_id from public.contacts where id = new.contact_id)
     is distinct from
     (select org_id from public.contacts where id = new.connected_contact_id)
  then
    raise exception 'contact_connections: contact_id and connected_contact_id must belong to the same org';
  end if;
  return new;
end;
$$;

create trigger contact_connections_same_org
  before insert or update on public.contact_connections
  for each row execute function public.enforce_contact_connections_same_org();

alter table public.contact_connections enable row level security;

create policy "Org members can read their org's connections"
  on public.contact_connections for select
  using (
    contact_id in (
      select id from public.contacts where org_id in (
        select org_id from public.memberships where profile_id = auth.uid()
      )
    )
  );

create policy "Org members can manage their org's connections"
  on public.contact_connections for all
  using (
    contact_id in (
      select id from public.contacts where org_id in (
        select org_id from public.memberships where profile_id = auth.uid()
      )
    )
  )
  with check (
    contact_id in (
      select id from public.contacts where org_id in (
        select org_id from public.memberships where profile_id = auth.uid()
      )
    )
  );

-- Helper: given a prospect's name/phone/email, check if it matches an
-- existing contact. Returns matched contact rows.
-- Usage from the prospecting tool: call this per prospect before outreach,
-- and if it returns a row, mark that lead "warm" in the UI (then query
-- contact_connections for that contact_id to show who they're connected to).
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
  select id, full_name, 'direct match on name/phone/email' as match_reason
  from public.contacts
  where org_id = p_org_id
    and (
      (p_phone is not null and phone = p_phone)
      or (p_email is not null and email = p_email)
      or (p_name is not null and full_name ilike '%' || p_name || '%')
    )
$$;
