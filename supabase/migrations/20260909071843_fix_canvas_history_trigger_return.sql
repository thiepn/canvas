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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function canvas_admin.capture_element_history() from public, anon, authenticated;
