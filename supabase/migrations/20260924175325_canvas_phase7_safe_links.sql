alter table public.canvas_elements
  drop constraint if exists canvas_elements_safe_link;
alter table public.canvas_elements
  add constraint canvas_elements_safe_link check (
    coalesce(element ->> 'link', '') = ''
    or (
      char_length(element ->> 'link') <= 4096
      and (
        (element ->> 'link') ~* '^https?://'
        or (element ->> 'link') ~ '^#'
      )
    )
  );

alter table public.canvas_ci_elements
  drop constraint if exists canvas_ci_elements_safe_link;
alter table public.canvas_ci_elements
  add constraint canvas_ci_elements_safe_link check (
    coalesce(element ->> 'link', '') = ''
    or (
      char_length(element ->> 'link') <= 4096
      and (
        (element ->> 'link') ~* '^https?://'
        or (element ->> 'link') ~ '^#'
      )
    )
  );
