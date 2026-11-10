begin;

-- An administrator could make anyone an administrator, or remove another
-- administrator, from the hub. Administrators now manage moderators only:
-- appointing or removing an administrator needs direct database access
-- (docs/administration.md). With no removal left in the hub, the last
-- administrator needs no special guard.
create or replace function public.hub_set_staff(p_member_id uuid,p_role text,p_promotion integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles; old_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff(true);
  if p_role = 'admin' then raise exception 'Administrator roles are managed in the database' using errcode = '42501'; end if;
  if p_role is not null and p_role <> 'moderator' then raise exception 'Invalid staff role' using errcode = '22023'; end if;
  if p_member_id = staff.user_id then raise exception 'You cannot change your own staff role' using errcode = '42501'; end if;
  select role into old_role from private.hub_staff where user_id = p_member_id;
  if old_role = 'admin' then raise exception 'Administrator roles are managed in the database' using errcode = '42501'; end if;
  select * into target from public.profiles where id = p_member_id for update;
  if not found or not target.is_active or not target.profile_completed then
    raise exception 'Staff must have an active completed profile' using errcode = '22023'; end if;
  if p_role = 'moderator' and (p_promotion is null or p_promotion is distinct from target.graduation_year) then
    raise exception 'Moderators must belong to their assigned promotion' using errcode = '22023'; end if;
  if p_role is null then delete from private.hub_staff where user_id = p_member_id;
  else insert into private.hub_staff(user_id,role,graduation_year) values(p_member_id,p_role,p_promotion)
    on conflict(user_id) do update set role = excluded.role, graduation_year = excluded.graduation_year; end if;
  perform private.audit_action('staff_changed',p_member_id,target.graduation_year,
    concat('Role: ',coalesce(old_role,'member'),' → ',coalesce(p_role,'member')));
end;
$$;

commit;
