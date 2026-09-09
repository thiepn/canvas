create table if not exists public.canvas_elements (
  id text primary key,
  version bigint not null,
  version_nonce bigint not null default 0,
  is_deleted boolean not null default false,
  element jsonb not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint canvas_elements_id_length check (char_length(id) between 1 and 128),
  constraint canvas_elements_version_range check (version between 0 and 2147483647),
  constraint canvas_elements_nonce_range check (version_nonce between -2147483648 and 2147483647),
  constraint canvas_elements_updater_length check (char_length(updated_by) <= 128),
  constraint canvas_elements_json_object check (jsonb_typeof(element) = 'object'),
  constraint canvas_elements_json_size check (octet_length(element::text) <= 262144),
  constraint canvas_elements_allowed_type check ((element ->> 'type') in ('rectangle','diamond','ellipse','line','arrow','freedraw','text','frame')),
  constraint canvas_elements_matching_id check ((element ->> 'id') = id)
);

create index if not exists canvas_elements_active_updated_idx
  on public.canvas_elements (is_deleted, updated_at desc);

alter table public.canvas_elements enable row level security;

grant select, insert, update on table public.canvas_elements to anon, authenticated;
revoke delete, truncate, references, trigger on table public.canvas_elements from anon, authenticated;

drop policy if exists "canvas public read" on public.canvas_elements;
create policy "canvas public read"
  on public.canvas_elements for select
  to anon, authenticated
  using (true);

drop policy if exists "canvas public insert" on public.canvas_elements;
create policy "canvas public insert"
  on public.canvas_elements for insert
  to anon, authenticated
  with check (
    version = coalesce((element ->> 'version')::bigint, version)
    and version_nonce = coalesce((element ->> 'versionNonce')::bigint, version_nonce)
    and is_deleted = coalesce((element ->> 'isDeleted')::boolean, false)
  );

drop policy if exists "canvas public update" on public.canvas_elements;
create policy "canvas public update"
  on public.canvas_elements for update
  to anon, authenticated
  using (true)
  with check (
    version = coalesce((element ->> 'version')::bigint, version)
    and version_nonce = coalesce((element ->> 'versionNonce')::bigint, version_nonce)
    and is_deleted = coalesce((element ->> 'isDeleted')::boolean, false)
  );

create or replace function public.canvas_keep_newest_element()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.version < old.version
       or (new.version = old.version and new.version_nonce <= old.version_nonce) then
      return null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists canvas_keep_newest_element on public.canvas_elements;
create trigger canvas_keep_newest_element
before update on public.canvas_elements
for each row execute function public.canvas_keep_newest_element();

alter table public.canvas_elements replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'canvas_elements'
  ) then
    alter publication supabase_realtime add table public.canvas_elements;
  end if;
end $$;
