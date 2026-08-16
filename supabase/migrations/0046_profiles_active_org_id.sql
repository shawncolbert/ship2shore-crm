alter table public.profiles
  add column active_org_id uuid references public.organizations(id) on delete set null;

comment on column public.profiles.active_org_id is
  'Which org this user is currently working in, for users who belong to more than one (e.g. a platform admin testing multiple client orgs). Null for the common case of a user with exactly one membership -- org resolution falls back to that single membership. Not itself a security boundary: RLS on every org-scoped table still checks real membership rows independently.';
