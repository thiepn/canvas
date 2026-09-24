drop policy if exists "canvas ci asset cleanup read" on storage.objects;
create policy "canvas ci asset cleanup read"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'canvas-ci-assets'
  and name ~ '^sha256/[0-9a-f]{64}$'
);
