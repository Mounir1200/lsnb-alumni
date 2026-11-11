begin;

-- staff_covers answered NULL, not false, for a moderator and a member without
-- a promotion: `2020 = NULL` is NULL. Under `if not ...` PL/pgSQL reads NULL
-- as false, so hub_approve_member and hub_moderate_member skipped their
-- refusal and let any moderator approve or suspend such a member. The scope
-- check now always answers true or false, so every caller is safe.
create or replace function private.staff_covers(p_staff private.hub_staff, p_promotion integer) returns boolean
language sql immutable set search_path = '' as $$
  select p_staff.graduation_year is null or p_staff.graduation_year is not distinct from p_promotion;
$$;

commit;
