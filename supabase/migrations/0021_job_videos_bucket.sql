insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-videos', 'job-videos', false, 524288000, array['video/mp4','video/quicktime','video/webm','video/x-msvideo'])
on conflict (id) do nothing;

-- Same org-scoped path convention as delivery-orders: path is "{org_id}/...".
create policy "org members read job videos" on storage.objects
  for select using (
    bucket_id = 'job-videos'
    and (split_part(name, '/', 1))::uuid in (select memberships.org_id from memberships where memberships.profile_id = auth.uid())
  );

create policy "org members upload job videos" on storage.objects
  for insert with check (
    bucket_id = 'job-videos'
    and (split_part(name, '/', 1))::uuid in (select memberships.org_id from memberships where memberships.profile_id = auth.uid())
  );

create policy "org members delete job videos" on storage.objects
  for delete using (
    bucket_id = 'job-videos'
    and (split_part(name, '/', 1))::uuid in (select memberships.org_id from memberships where memberships.profile_id = auth.uid())
  );
