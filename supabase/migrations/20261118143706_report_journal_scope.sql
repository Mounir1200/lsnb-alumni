begin;

-- Settling a report copies its note to the journal, which showed it to every
-- team member covering the promotion: the reported moderator and their peers
-- read a note that hub_reports keeps from them, and learnt they were reported.
-- A report's journal entries now follow the rule hub_reports applies to that
-- note, private.report_in_scope; every other entry is unchanged.
create or replace function public.hub_audit(p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  return (with filtered as (select id,created_at,actor_name,action,target_name,graduation_year,reason from private.hub_audit
    where private.staff_covers(staff, graduation_year)
      and (action not in ('report_resolved', 'report_dismissed') or private.report_in_scope(staff, target_id))),
    page_rows as (select * from filtered order by id desc limit 25 offset (p_page-1)*25)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',p_page,'page_size',25));
end;
$$;

commit;
