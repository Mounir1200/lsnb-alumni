begin;

-- Career steps gain optional start and end months. Without them, a step that
-- ended earlier this year could only be told apart from an ongoing one by its
-- year, and finished paths were shown as "en cours". The function accepts every
-- value the previous version accepted, so existing rows stay valid.
create or replace function public.is_valid_career_steps(p_steps jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  step jsonb;
  field text;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 12 then
    return false;
  end if;

  for step in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(step) <> 'object' then return false; end if;
    if exists (
      select 1 from jsonb_object_keys(step) as keys(name)
      where keys.name not in ('kind', 'title', 'organization', 'location', 'start_year', 'start_month', 'end_year', 'end_month')
    ) then
      return false;
    end if;
    if coalesce(step ->> 'kind', '') not in ('education', 'work') then return false; end if;
    if jsonb_typeof(step -> 'title') is distinct from 'string'
      or char_length(step ->> 'title') not between 2 and 120
      or step ->> 'title' <> btrim(step ->> 'title') then
      return false;
    end if;
    foreach field in array array['organization', 'location'] loop
      if step ? field and (
        jsonb_typeof(step -> field) <> 'string'
        or char_length(step ->> field) > 120
        or step ->> field <> btrim(step ->> field)
      ) then
        return false;
      end if;
    end loop;
    -- Years are whole numbers; an absent or null end year means "ongoing".
    if jsonb_typeof(step -> 'start_year') is distinct from 'number'
      or step ->> 'start_year' !~ '^[0-9]{4}$'
      or (step ->> 'start_year')::integer not between 1950 and 2100 then
      return false;
    end if;
    if jsonb_typeof(step -> 'end_year') = 'number' then
      if step ->> 'end_year' !~ '^[0-9]{4}$'
        or (step ->> 'end_year')::integer not between (step ->> 'start_year')::integer and 2100 then
        return false;
      end if;
    elsif step ? 'end_year' and jsonb_typeof(step -> 'end_year') <> 'null' then
      return false;
    end if;
    -- Months are optional whole numbers from 1 to 12; an end month needs an end year.
    foreach field in array array['start_month', 'end_month'] loop
      if step ? field and (
        jsonb_typeof(step -> field) is distinct from 'number'
        or step ->> field !~ '^[0-9]{1,2}$'
        or (step ->> field)::integer not between 1 and 12
      ) then
        return false;
      end if;
    end loop;
    if step ? 'end_month' and jsonb_typeof(step -> 'end_year') is distinct from 'number' then
      return false;
    end if;
    -- Within a single year, the end month cannot precede the start month.
    if step ? 'start_month' and step ? 'end_month'
      and (step ->> 'end_year')::integer = (step ->> 'start_year')::integer
      and (step ->> 'end_month')::integer < (step ->> 'start_month')::integer then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on column public.profiles.career_steps is
  'Up to 12 steps: {kind: education|work, title, organization?, location?, start_year, start_month? (1-12), end_year|null (ongoing), end_month? (1-12, with end_year)}. Visible like the rest of the profile.';

notify pgrst, 'reload schema';

commit;
