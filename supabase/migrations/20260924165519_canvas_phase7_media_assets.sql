alter table public.canvas_elements
  drop constraint if exists canvas_elements_allowed_type;
alter table public.canvas_elements
  drop constraint if exists canvas_elements_image_contract;
alter table public.canvas_elements
  add constraint canvas_elements_allowed_type
    check ((element ->> 'type') in ('rectangle','diamond','ellipse','line','arrow','freedraw','text','frame','image'));
alter table public.canvas_elements
  add constraint canvas_elements_image_contract
    check (
      (element ->> 'type') <> 'image'
      or (
        coalesce(element ->> 'status', '') = 'saved'
        and coalesce(element ->> 'fileId', '') ~ '^[0-9a-f]{64}$'
        and jsonb_typeof(element -> 'scale') = 'array'
        and jsonb_array_length(element -> 'scale') = 2
      )
    );

alter table public.canvas_ci_elements
  drop constraint if exists canvas_ci_elements_allowed_type;
alter table public.canvas_ci_elements
  drop constraint if exists canvas_ci_elements_image_contract;
alter table public.canvas_ci_elements
  add constraint canvas_ci_elements_allowed_type
    check ((element ->> 'type') in ('rectangle','diamond','ellipse','line','arrow','freedraw','text','frame','image'));
alter table public.canvas_ci_elements
  add constraint canvas_ci_elements_image_contract
    check (
      (element ->> 'type') <> 'image'
      or (
        coalesce(element ->> 'status', '') = 'saved'
        and coalesce(element ->> 'fileId', '') ~ '^[0-9a-f]{64}$'
        and jsonb_typeof(element -> 'scale') = 'array'
        and jsonb_array_length(element -> 'scale') = 2
      )
    );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('canvas-assets', 'canvas-assets', true, 12582912, array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']),
  ('canvas-ci-assets', 'canvas-ci-assets', true, 12582912, array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "canvas assets immutable upload" on storage.objects;
create policy "canvas assets immutable upload"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id in ('canvas-assets','canvas-ci-assets')
  and name ~ '^sha256/[0-9a-f]{64}$'
);

drop policy if exists "canvas ci asset cleanup" on storage.objects;
create policy "canvas ci asset cleanup"
on storage.objects
for delete
to anon, authenticated
using (
  bucket_id = 'canvas-ci-assets'
  and name ~ '^sha256/[0-9a-f]{64}$'
);
