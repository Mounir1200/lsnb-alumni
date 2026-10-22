begin;

-- Key steps of a member's path (studies, jobs), shown as the profile timeline.
-- They live on the profile row and follow its existing RLS and grants.
alter table public.profiles
  add column career_steps jsonb not null default '[]'::jsonb;

comment on column public.profiles.career_steps is
  'Up to 12 steps: {kind: education|work, title, organization?, location?, start_year, end_year|null (ongoing)}. Visible like the rest of the profile.';

-- Validated at the database boundary as well as in the forms. Immutable and
-- table-free so it can back a CHECK constraint.
create function public.is_valid_career_steps(p_steps jsonb)
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
      where keys.name not in ('kind', 'title', 'organization', 'location', 'start_year', 'end_year')
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
  end loop;
  return true;
end;
$$;

revoke all on function public.is_valid_career_steps(jsonb) from public, anon;
grant execute on function public.is_valid_career_steps(jsonb) to authenticated, service_role;

alter table public.profiles
  add constraint profiles_career_steps_check check (public.is_valid_career_steps(career_steps));

-- Email sign-ups have no session until confirmation: their steps travel in the
-- sign-up metadata. Runs after on_auth_user_created (trigger names sort), once
-- the profile exists. Invalid metadata is ignored rather than blocking sign-up.
create function private.copy_signup_career_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  steps jsonb := new.raw_user_meta_data -> 'career_steps';
begin
  if steps is not null and public.is_valid_career_steps(steps) then
    update public.profiles set career_steps = steps where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.copy_signup_career_steps() from public, anon, authenticated, service_role;

create trigger on_auth_user_created_career_steps
after insert on auth.users
for each row execute function private.copy_signup_career_steps();

notify pgrst, 'reload schema';

commit;
