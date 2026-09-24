alter table public.canvas_elements
  drop constraint if exists canvas_elements_geometry_contract;
alter table public.canvas_elements
  add constraint canvas_elements_geometry_contract check (
    jsonb_typeof(element -> 'x') = 'number'
    and jsonb_typeof(element -> 'y') = 'number'
    and jsonb_typeof(element -> 'width') = 'number'
    and jsonb_typeof(element -> 'height') = 'number'
    and jsonb_typeof(element -> 'angle') = 'number'
    and abs((element ->> 'x')::numeric) <= 1000000000
    and abs((element ->> 'y')::numeric) <= 1000000000
    and abs((element ->> 'width')::numeric) <= 100000000
    and abs((element ->> 'height')::numeric) <= 100000000
    and abs((element ->> 'angle')::numeric) <= 1000
  );

alter table public.canvas_ci_elements
  drop constraint if exists canvas_ci_elements_geometry_contract;
alter table public.canvas_ci_elements
  add constraint canvas_ci_elements_geometry_contract check (
    jsonb_typeof(element -> 'x') = 'number'
    and jsonb_typeof(element -> 'y') = 'number'
    and jsonb_typeof(element -> 'width') = 'number'
    and jsonb_typeof(element -> 'height') = 'number'
    and jsonb_typeof(element -> 'angle') = 'number'
    and abs((element ->> 'x')::numeric) <= 1000000000
    and abs((element ->> 'y')::numeric) <= 1000000000
    and abs((element ->> 'width')::numeric) <= 100000000
    and abs((element ->> 'height')::numeric) <= 100000000
    and abs((element ->> 'angle')::numeric) <= 1000
  );
