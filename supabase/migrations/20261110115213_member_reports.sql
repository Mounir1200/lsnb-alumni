begin;

-- Members report what breaks the code of conduct. A report names a member, a
-- reason and optional details; a conversation report also hands the moderators
-- that conversation's 20 latest messages, sealed with the messaging key like the
-- messages themselves. Members file reports through two functions and never read
-- them back; the team reads and settles them through the hub.
create table private.member_reports (
  id uuid primary key default gen_random_uuid(),
  -- Kept when the reporter deletes their account: the report stays valid.
  reporter_id uuid constraint member_reports_reporter_id_fkey references public.profiles(id) on delete set null,
  reported_id uuid not null constraint member_reports_reported_id_fkey references public.profiles(id) on delete cascade,
  reason text not null constraint member_reports_reason check (reason in ('harassment', 'inappropriate', 'minor_safety', 'scam', 'fake_profile', 'other')),
  details text not null default '' constraint member_reports_details check (char_length(details) <= 1000),
  conversation_id uuid constraint member_reports_conversation_id_fkey references public.connection_requests(id) on delete set null,
  evidence bytea,
  evidence_key_version smallint,
  status text not null default 'open' constraint member_reports_status check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default clock_timestamp(),
  handled_by uuid constraint member_reports_handled_by_fkey references public.profiles(id) on delete set null,
  handled_at timestamptz,
  resolution text,
  constraint member_reports_evidence check ((evidence is null) = (evidence_key_version is null)),
  constraint member_reports_handling check (
    (status = 'open' and handled_at is null and resolution is null)
    or (status <> 'open' and handled_at is not null and char_length(resolution) between 10 and 500))
);
create index member_reports_status_idx on private.member_reports(status, created_at desc);
create index member_reports_reporter_idx on private.member_reports(reporter_id, created_at desc);
create index member_reports_reported_idx on private.member_reports(reported_id);
create unique index member_reports_one_open_per_pair_idx on private.member_reports(reporter_id, reported_id) where status = 'open';
alter table private.member_reports enable row level security;
revoke all on private.member_reports from public, anon, authenticated, service_role;

-- One reporter files at most one open report per member and five reports a day.
-- Reports are never deleted by members, so deleting cannot reset the count, and
-- the lock serializes a reporter's parallel calls. There is no global cap: every
-- filer needs an active completed account, and a cap that fake accounts could
-- fill would silence genuine reports.
create function private.file_member_report(p_reported uuid, p_reason text, p_details text, p_conversation uuid, p_evidence bytea)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); clean_details text := btrim(coalesce(p_details, ''));
begin
  if actor is null or private.site_allowed() is distinct from true
    or not exists (select 1 from public.profiles p where p.id = actor and p.is_active and p.profile_completed) then
    raise exception 'An active member account is required to report' using errcode = '42501';
  end if;
  if p_reported = actor then raise exception 'You cannot report yourself' using errcode = 'LS422'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_reported) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'inappropriate', 'minor_safety', 'scam', 'fake_profile', 'other') then
    raise exception 'Unknown report reason' using errcode = '22023';
  end if;
  if char_length(clean_details) > 1000 or (p_reason = 'other' and char_length(clean_details) < 10) then
    raise exception 'Describe the problem in 10 to 1000 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('report:' || actor::text, 0));
  if exists (select 1 from private.member_reports r where r.reporter_id = actor and r.reported_id = p_reported and r.status = 'open') then
    raise exception 'You already reported this member; the team is looking into it' using errcode = '23505';
  end if;
  if (select count(*) from private.member_reports r
      where r.reporter_id = actor and r.created_at > clock_timestamp() - interval '1 day') >= 5 then
    raise exception 'Please wait before filing more reports' using errcode = '54000';
  end if;
  insert into private.member_reports (reporter_id, reported_id, reason, details, conversation_id, evidence, evidence_key_version)
    values (actor, p_reported, p_reason, clean_details, p_conversation, p_evidence, case when p_evidence is not null then 1 end);
end;
$$;

create function public.report_member(p_member_id uuid, p_reason text, p_details text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.file_member_report(p_member_id, p_reason, p_details, null, null);
end;
$$;

-- Signed like every messaging call, so a copied access token alone cannot hand a
-- conversation to the moderators. The evidence is a copy: it stays what it was
-- when reported, and the reporter's own messages give it context.
create function public.messaging_report_conversation(p_conversation_id uuid, p_reason text, p_details text, p_proof jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.messaging_authorize('report', format('%s|%s|%s', p_conversation_id, p_reason, p_details), p_proof);
  request public.connection_requests; evidence jsonb;
begin
  perform private.messaging_require_participant(actor, p_conversation_id);
  select * into request from public.connection_requests where id = p_conversation_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'from', case when m.sender_id = actor then 'reporter' else 'reported' end,
      'sent_at', m.created_at, 'text', private.messaging_open(m)) order by m.sequence), '[]'::jsonb)
    into evidence
    from public.conversation_messages m
    where m.id in (select latest.id from public.conversation_messages latest
      where latest.conversation_id = p_conversation_id order by latest.sequence desc limit 20);
  perform private.file_member_report(
    case when actor = request.requester_id then request.recipient_id else request.requester_id end,
    p_reason, p_details, p_conversation_id, private.messaging_seal(convert_to(evidence::text, 'UTF8')));
end;
$$;

-- What the team may see: administrators every report; a moderator the reports
-- about members of their promotion, except reports about the team, which go to
-- administrators only, like any action on a team member.
create function private.report_in_scope(p_staff private.hub_staff, p_reported uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_staff.role = 'admin' or (
    exists (select 1 from public.profiles p where p.id = p_reported and p.graduation_year = p_staff.graduation_year)
    and not exists (select 1 from private.hub_staff s where s.user_id = p_reported));
$$;

create function public.hub_reports(p_status text default 'open', p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_status is null or p_status not in ('open', 'handled') or p_page is null or p_page not between 1 and 100000 then
    raise exception 'Invalid report filters' using errcode = '22023';
  end if;
  return (with visible as (
      select r.* from private.member_reports r
      where private.report_in_scope(staff, r.reported_id) and (r.status = 'open') = (p_status = 'open')
    ), page_rows as (select * from visible order by created_at desc, id limit 25 offset (p_page - 1) * 25)
    select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at,
        'handled_at', r.handled_at, 'resolution', r.resolution,
        'handled_by_name', (select concat_ws(' ', h.first_name, h.last_name) from public.profiles h where h.id = r.handled_by),
        'reported', (select jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name),
          'graduation_year', p.graduation_year,
          'is_suspended', exists (select 1 from private.hub_suspensions x where x.user_id = p.id) or (not p.is_active and p.profile_completed))
          from public.profiles p where p.id = r.reported_id),
        'reporter', (select jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name), 'graduation_year', p.graduation_year)
          from public.profiles p where p.id = r.reporter_id),
        'messages', case when r.evidence is not null
          then convert_from(private.messaging_unseal(r.evidence, r.evidence_key_version), 'UTF8')::jsonb end
      ) order by r.created_at desc, r.id) from page_rows r), '[]'::jsonb),
      'total', (select count(*) from visible), 'page', p_page, 'page_size', 25));
end;
$$;

-- A report is settled once, with an outcome and a note that the journal keeps.
-- Nobody settles a report they filed, except an administrator.
create function public.hub_resolve_report(p_report_id uuid, p_status text, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; report private.member_reports;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration', 0));
  staff := private.require_staff();
  if p_status is null or p_status not in ('resolved', 'dismissed') then
    raise exception 'Choose an outcome: resolved or dismissed' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_resolution, ''))) not between 10 and 500 then
    raise exception 'Explain the outcome in 10 to 500 characters' using errcode = '22023';
  end if;
  select * into report from private.member_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if not private.report_in_scope(staff, report.reported_id) then
    raise exception 'Forbidden: report outside your scope' using errcode = '42501';
  end if;
  if staff.role = 'moderator' and report.reporter_id = staff.user_id then
    raise exception 'Forbidden: a report you filed yourself goes to another team member' using errcode = '42501';
  end if;
  if report.status <> 'open' then raise exception 'This report was already settled' using errcode = '22023'; end if;
  update private.member_reports
    set status = p_status, handled_by = staff.user_id, handled_at = clock_timestamp(), resolution = btrim(p_resolution)
    where id = p_report_id;
  perform private.audit_action(case p_status when 'resolved' then 'report_resolved' else 'report_dismissed' end,
    report.reported_id, (select p.graduation_year from public.profiles p where p.id = report.reported_id), btrim(p_resolution));
end;
$$;

revoke all on function private.file_member_report(uuid, text, text, uuid, bytea), private.report_in_scope(private.hub_staff, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.report_member(uuid, text, text), public.messaging_report_conversation(uuid, text, text, jsonb),
  public.hub_reports(text, integer), public.hub_resolve_report(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.report_member(uuid, text, text), public.messaging_report_conversation(uuid, text, text, jsonb),
  public.hub_reports(text, integer), public.hub_resolve_report(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
