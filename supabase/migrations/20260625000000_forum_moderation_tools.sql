create or replace function public.moderate_forum_topic(
  p_topic_id bigint,
  p_is_hidden boolean default null,
  p_is_locked boolean default null,
  p_is_pinned boolean default null,
  p_report_id bigint default null,
  p_report_status text default null
)
returns public.forum_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic public.forum_topics;
  v_status text;
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can moderate forum topics.' using errcode = '42501';
  end if;

  v_status = coalesce(p_report_status, case when p_report_id is not null then 'closed' else null end);
  if v_status is not null and v_status not in ('open', 'reviewing', 'closed') then
    raise exception 'Invalid report status.' using errcode = '22023';
  end if;

  update public.forum_topics
  set
    is_hidden = coalesce(p_is_hidden, is_hidden),
    is_locked = coalesce(p_is_locked, is_locked),
    is_pinned = coalesce(p_is_pinned, is_pinned),
    updated_at = now()
  where id = p_topic_id
  returning * into v_topic;

  if not found then
    raise exception 'Topic not found.' using errcode = 'P0002';
  end if;

  if p_report_id is not null then
    update public.forum_reports
    set
      status = v_status,
      updated_at = now()
    where id = p_report_id
      and topic_id = p_topic_id;
  end if;

  return v_topic;
end;
$$;

create or replace function public.moderate_forum_reply(
  p_reply_id bigint,
  p_is_hidden boolean default null,
  p_report_id bigint default null,
  p_report_status text default null
)
returns public.forum_replies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply public.forum_replies;
  v_status text;
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can moderate forum replies.' using errcode = '42501';
  end if;

  v_status = coalesce(p_report_status, case when p_report_id is not null then 'closed' else null end);
  if v_status is not null and v_status not in ('open', 'reviewing', 'closed') then
    raise exception 'Invalid report status.' using errcode = '22023';
  end if;

  update public.forum_replies
  set
    is_hidden = coalesce(p_is_hidden, is_hidden),
    updated_at = now()
  where id = p_reply_id
  returning * into v_reply;

  if not found then
    raise exception 'Reply not found.' using errcode = 'P0002';
  end if;

  if p_report_id is not null then
    update public.forum_reports
    set
      status = v_status,
      updated_at = now()
    where id = p_report_id
      and reply_id = p_reply_id;
  end if;

  return v_reply;
end;
$$;

revoke all on function public.moderate_forum_topic(bigint, boolean, boolean, boolean, bigint, text) from public;
revoke all on function public.moderate_forum_reply(bigint, boolean, bigint, text) from public;
grant execute on function public.moderate_forum_topic(bigint, boolean, boolean, boolean, bigint, text) to authenticated;
grant execute on function public.moderate_forum_reply(bigint, boolean, bigint, text) to authenticated;
