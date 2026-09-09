create table if not exists public.canvas_ci_elements (
  id text primary key,
  version bigint not null,
  version_nonce bigint not null default 0,
  is_deleted boolean not null default false,
  element jsonb not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint canvas_ci_elements_id_length check (char_length(id) between 1 and 128),
  constraint canvas_ci_elements_version_range check (version between 0 and 2147483647),
  constraint canvas_ci_elements_nonce_range check (version_nonce between -2147483648 and 2147483647),
  constraint canvas_ci_elements_updater_length check (char_length(updated_by) <= 128),
  constraint canvas_ci_elements_json_object check (jsonb_typeof(element) = 'object'),
  constraint canvas_ci_elements_json_size check (octet_length(element::text) <= 262144),
  constraint canvas_ci_elements_allowed_type check ((element ->> 'type') in ('rectangle','diamond','ellipse','line','arrow','freedraw','text','frame')),
  constraint canvas_ci_elements_matching_id check ((element ->> 'id') = id)
);

alter table public.canvas_ci_elements enable row level security;
grant select, insert, update, delete on table public.canvas_ci_elements to anon, authenticated;

drop policy if exists "canvas ci read" on public.canvas_ci_elements;
create policy "canvas ci read" on public.canvas_ci_elements for select to anon, authenticated using (true);
drop policy if exists "canvas ci insert" on public.canvas_ci_elements;
create policy "canvas ci insert" on public.canvas_ci_elements for insert to anon, authenticated
with check (
  version = coalesce((element ->> 'version')::bigint, version)
  and version_nonce = coalesce((element ->> 'versionNonce')::bigint, version_nonce)
  and is_deleted = coalesce((element ->> 'isDeleted')::boolean, false)
);
drop policy if exists "canvas ci update" on public.canvas_ci_elements;
create policy "canvas ci update" on public.canvas_ci_elements for update to anon, authenticated using (true)
with check (
  version = coalesce((element ->> 'version')::bigint, version)
  and version_nonce = coalesce((element ->> 'versionNonce')::bigint, version_nonce)
  and is_deleted = coalesce((element ->> 'isDeleted')::boolean, false)
);
drop policy if exists "canvas ci cleanup" on public.canvas_ci_elements;
create policy "canvas ci cleanup" on public.canvas_ci_elements for delete to anon, authenticated using (true);

create or replace function public.canvas_ci_keep_newest_element()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then raise exception 'Canvas element IDs are immutable'; end if;
    if new.version < old.version or (new.version = old.version and new.version_nonce <= old.version_nonce) then return null; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists canvas_ci_keep_newest_element on public.canvas_ci_elements;
create trigger canvas_ci_keep_newest_element before update on public.canvas_ci_elements for each row execute function public.canvas_ci_keep_newest_element();

alter table public.canvas_ci_elements replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='canvas_ci_elements') then
    alter publication supabase_realtime add table public.canvas_ci_elements;
  end if;
end $$;
