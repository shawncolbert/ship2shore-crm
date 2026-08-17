-- Per-org "what am I asking the customer for" picker on the Contact page's
-- Request a Document flow. Used to be a single hardcoded set of freight-
-- specific presets (Delivery Order, Doc Receipt, Gate Pass) that every org
-- saw regardless of what kind of business they run -- a t-shirt shop or a
-- photographer has no use for "Gate Pass." Each org now manages its own
-- list; body_template uses a literal {{first_name}} placeholder,
-- interpolated client-side same as the old hardcoded presets were.

create table if not exists public.document_request_presets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  label text not null,
  subject text not null,
  body_template text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists document_request_presets_org_id_idx on public.document_request_presets (org_id);

alter table public.document_request_presets enable row level security;

create policy "org members manage their document presets" on public.document_request_presets
  for all
  using (org_id in (select org_id from public.memberships where profile_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where profile_id = auth.uid()));

-- Every existing org gets a generic starter preset -- freight-specific
-- terminology doesn't belong here anymore.
insert into public.document_request_presets (org_id, label, subject, body_template, position)
select id, 'Supporting Documents', 'Supporting Documents Needed',
  'Hi {{first_name}},' || chr(10) || chr(10) || 'Could you send over any supporting documents for this? Whatever you have is a help.',
  0
from public.organizations;

-- Ship2Shore specifically keeps its existing freight-specific presets too,
-- so nothing changes for them -- same three options that were hardcoded
-- before, now just editable instead of fixed in code. Delivery Order stays
-- position 0 so it's still the default selection, same as the old
-- hardcoded applyPreset('delivery_order').
insert into public.document_request_presets (org_id, label, subject, body_template, position)
values
  ('11111111-1111-1111-1111-111111111111', 'Delivery Order', 'Delivery Order Needed',
    'Hi {{first_name}},' || chr(10) || chr(10) || 'We''re ready to move forward and need your delivery order (POA and delivery details) to proceed.', 0),
  ('11111111-1111-1111-1111-111111111111', 'Doc Receipt', 'Documentation Receipt Needed',
    'Hi {{first_name}},' || chr(10) || chr(10) || 'We need the documentation receipt to pick up the container/cargo. Please send it over so we can proceed.', 1),
  ('11111111-1111-1111-1111-111111111111', 'Gate Pass', 'Gate Pass Needed',
    'Hi {{first_name}},' || chr(10) || chr(10) || 'We need your gate pass to proceed with pickup. Please send it over when you get a chance.', 2);

update public.document_request_presets set position = 3
  where org_id = '11111111-1111-1111-1111-111111111111' and label = 'Supporting Documents';
