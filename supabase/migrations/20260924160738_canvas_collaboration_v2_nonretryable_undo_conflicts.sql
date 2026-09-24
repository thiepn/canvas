create or replace function public.canvas_apply_own_undo(p_changes jsonb, p_updated_by text)
returns setof public.canvas_elements
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_change jsonb;
  v_current public.canvas_elements%rowtype;
  v_id text;
  v_expected_version bigint;
  v_expected_nonce bigint;
  v_expected_deleted boolean;
  v_count integer;
begin
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Canvas undo changes must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_changes);
  if v_count < 1 or v_count > 100 then
    raise exception 'Canvas undo must contain between 1 and 100 changes';
  end if;
  if p_updated_by is null or char_length(p_updated_by) > 128 then
    raise exception 'Canvas undo updater is invalid';
  end if;
  if (
    select count(*) <> count(distinct item ->> 'id')
    from jsonb_array_elements(p_changes) as items(item)
  ) then
    raise exception 'Canvas undo contains duplicate element IDs';
  end if;

  perform e.id
  from public.canvas_elements e
  join jsonb_array_elements(p_changes) as items(item)
    on e.id = items.item ->> 'id'
  order by e.id
  for update;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_id := v_change ->> 'id';
    v_expected_version := (v_change ->> 'expectedVersion')::bigint;
    v_expected_nonce := (v_change ->> 'expectedVersionNonce')::bigint;
    v_expected_deleted := (v_change ->> 'expectedIsDeleted')::boolean;

    select *
    into v_current
    from public.canvas_elements
    where id = v_id;

    if not found
       or v_current.version <> v_expected_version
       or v_current.version_nonce <> v_expected_nonce
       or v_current.is_deleted <> v_expected_deleted then
      raise sqlstate 'PT409' using message = format('Canvas undo conflict for element %s', v_id);
    end if;
  end loop;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    update public.canvas_elements
    set
      version = (v_change ->> 'version')::bigint,
      version_nonce = (v_change ->> 'versionNonce')::bigint,
      is_deleted = (v_change ->> 'isDeleted')::boolean,
      element = v_change -> 'element',
      updated_by = p_updated_by
    where id = v_change ->> 'id'
    returning * into v_current;

    if not found then
      raise exception 'Canvas undo update failed for element %', v_change ->> 'id';
    end if;
    return next v_current;
  end loop;
end;
$$;

revoke all on function public.canvas_apply_own_undo(jsonb, text) from public;
grant execute on function public.canvas_apply_own_undo(jsonb, text) to anon, authenticated;

create or replace function public.canvas_ci_apply_own_undo(p_changes jsonb, p_updated_by text)
returns setof public.canvas_ci_elements
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_change jsonb;
  v_current public.canvas_ci_elements%rowtype;
  v_id text;
  v_expected_version bigint;
  v_expected_nonce bigint;
  v_expected_deleted boolean;
  v_count integer;
begin
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Canvas undo changes must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_changes);
  if v_count < 1 or v_count > 100 then
    raise exception 'Canvas undo must contain between 1 and 100 changes';
  end if;
  if p_updated_by is null or char_length(p_updated_by) > 128 then
    raise exception 'Canvas undo updater is invalid';
  end if;
  if (
    select count(*) <> count(distinct item ->> 'id')
    from jsonb_array_elements(p_changes) as items(item)
  ) then
    raise exception 'Canvas undo contains duplicate element IDs';
  end if;

  perform e.id
  from public.canvas_ci_elements e
  join jsonb_array_elements(p_changes) as items(item)
    on e.id = items.item ->> 'id'
  order by e.id
  for update;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_id := v_change ->> 'id';
    v_expected_version := (v_change ->> 'expectedVersion')::bigint;
    v_expected_nonce := (v_change ->> 'expectedVersionNonce')::bigint;
    v_expected_deleted := (v_change ->> 'expectedIsDeleted')::boolean;

    select *
    into v_current
    from public.canvas_ci_elements
    where id = v_id;

    if not found
       or v_current.version <> v_expected_version
       or v_current.version_nonce <> v_expected_nonce
       or v_current.is_deleted <> v_expected_deleted then
      raise sqlstate 'PT409' using message = format('Canvas undo conflict for element %s', v_id);
    end if;
  end loop;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    update public.canvas_ci_elements
    set
      version = (v_change ->> 'version')::bigint,
      version_nonce = (v_change ->> 'versionNonce')::bigint,
      is_deleted = (v_change ->> 'isDeleted')::boolean,
      element = v_change -> 'element',
      updated_by = p_updated_by
    where id = v_change ->> 'id'
    returning * into v_current;

    if not found then
      raise exception 'Canvas undo update failed for element %', v_change ->> 'id';
    end if;
    return next v_current;
  end loop;
end;
$$;

revoke all on function public.canvas_ci_apply_own_undo(jsonb, text) from public;
grant execute on function public.canvas_ci_apply_own_undo(jsonb, text) to anon, authenticated;
