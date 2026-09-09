create schema if not exists canvas_admin;
revoke all on schema canvas_admin from public, anon, authenticated;

create table if not exists canvas_admin.element_history (
  history_id bigint generated always as identity primary key,
  source_txid bigint not null,
  recorded_at timestamptz not null default clock_timestamp(),
  element_id text not null,
  version bigint not null,
  version_nonce bigint not null,
  is_deleted boolean not null,
  element jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null
);

revoke all on table canvas_admin.element_history from public, anon, authenticated;
revoke all on sequence canvas_admin.element_history_history_id_seq from public, anon, authenticated;

create index if not exists canvas_element_history_tx_idx
  on canvas_admin.element_history (source_txid, history_id);
create index if not exists canvas_element_history_element_idx
  on canvas_admin.element_history (element_id, history_id desc);

create or replace function canvas_admin.capture_element_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, canvas_admin, public
as $$
begin
  insert into canvas_admin.element_history (
    source_txid, element_id, version, version_nonce, is_deleted, element, updated_by, updated_at
  ) values (
    txid_current(), old.id, old.version, old.version_nonce, old.is_deleted, old.element, old.updated_by, old.updated_at
  );

  delete from canvas_admin.element_history
  where history_id in (
    select history_id
    from canvas_admin.element_history
    where element_id = old.id
    order by history_id desc
    offset 20
  );

  return old;
end;
$$;
revoke all on function canvas_admin.capture_element_history() from public, anon, authenticated;

drop trigger if exists zz_canvas_capture_history on public.canvas_elements;
create trigger zz_canvas_capture_history
before update or delete on public.canvas_elements
for each row execute function canvas_admin.capture_element_history();

create or replace view canvas_admin.recovery_transactions as
select
  source_txid,
  min(recorded_at) as started_at,
  max(recorded_at) as finished_at,
  count(*) as history_rows,
  count(distinct element_id) as affected_elements
from canvas_admin.element_history
group by source_txid;
revoke all on canvas_admin.recovery_transactions from public, anon, authenticated;

create or replace function canvas_admin.restore_transaction(p_source_txid bigint)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, canvas_admin, public
as $$
declare
  restored_count integer := 0;
begin
  if not exists (
    select 1 from canvas_admin.element_history where source_txid = p_source_txid
  ) then
    raise exception 'Canvas recovery transaction % was not found', p_source_txid;
  end if;

  with source_rows as (
    select distinct on (h.element_id)
      h.element_id,
      h.version,
      h.version_nonce,
      h.is_deleted,
      h.element
    from canvas_admin.element_history h
    where h.source_txid = p_source_txid
    order by h.element_id, h.history_id desc
  ),
  prepared as (
    select
      s.element_id,
      greatest(s.version + 1, coalesce(current_row.version + 1, s.version + 1)) as next_version,
      s.version_nonce,
      s.is_deleted,
      s.element
    from source_rows s
    left join public.canvas_elements current_row on current_row.id = s.element_id
  ),
  restored as (
    insert into public.canvas_elements (
      id, version, version_nonce, is_deleted, element, updated_by
    )
    select
      p.element_id,
      p.next_version,
      p.version_nonce,
      p.is_deleted,
      jsonb_set(
        jsonb_set(
          jsonb_set(p.element, '{version}', to_jsonb(p.next_version), true),
          '{versionNonce}', to_jsonb(p.version_nonce), true
        ),
        '{isDeleted}', to_jsonb(p.is_deleted), true
      ),
      left('recovery:' || p_source_txid::text, 128)
    from prepared p
    on conflict (id) do update set
      version = excluded.version,
      version_nonce = excluded.version_nonce,
      is_deleted = excluded.is_deleted,
      element = excluded.element,
      updated_by = excluded.updated_by
    returning 1
  )
  select count(*) into restored_count from restored;

  return restored_count;
end;
$$;
revoke all on function canvas_admin.restore_transaction(bigint) from public, anon, authenticated;
