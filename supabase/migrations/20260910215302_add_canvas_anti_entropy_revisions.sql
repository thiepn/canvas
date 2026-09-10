create sequence if not exists public.canvas_elements_revision_seq as bigint;
create sequence if not exists public.canvas_ci_elements_revision_seq as bigint;

grant usage, select on sequence public.canvas_elements_revision_seq to anon, authenticated;
grant usage, select on sequence public.canvas_ci_elements_revision_seq to anon, authenticated;

alter table public.canvas_elements
  add column if not exists revision bigint default nextval('public.canvas_elements_revision_seq');
alter table public.canvas_ci_elements
  add column if not exists revision bigint default nextval('public.canvas_ci_elements_revision_seq');

alter table public.canvas_elements alter column revision set not null;
alter table public.canvas_ci_elements alter column revision set not null;

alter table public.canvas_elements alter column revision drop default;
alter table public.canvas_ci_elements alter column revision drop default;

create unique index if not exists canvas_elements_revision_idx on public.canvas_elements (revision);
create unique index if not exists canvas_ci_elements_revision_idx on public.canvas_ci_elements (revision);

create or replace function public.canvas_keep_newest_element()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then
      raise exception 'Canvas element IDs are immutable';
    end if;
    if new.version < old.version
       or (new.version = old.version and new.version_nonce >= old.version_nonce) then
      return null;
    end if;
  end if;
  new.updated_at := now();
  new.revision := nextval('public.canvas_elements_revision_seq');
  return new;
end;
$$;

create or replace function public.canvas_ci_keep_newest_element()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then
      raise exception 'Canvas element IDs are immutable';
    end if;
    if new.version < old.version
       or (new.version = old.version and new.version_nonce >= old.version_nonce) then
      return null;
    end if;
  end if;
  new.updated_at := now();
  new.revision := nextval('public.canvas_ci_elements_revision_seq');
  return new;
end;
$$;

drop trigger if exists canvas_keep_newest_element on public.canvas_elements;
create trigger canvas_keep_newest_element
before insert or update on public.canvas_elements
for each row execute function public.canvas_keep_newest_element();

drop trigger if exists canvas_ci_keep_newest_element on public.canvas_ci_elements;
create trigger canvas_ci_keep_newest_element
before insert or update on public.canvas_ci_elements
for each row execute function public.canvas_ci_keep_newest_element();
