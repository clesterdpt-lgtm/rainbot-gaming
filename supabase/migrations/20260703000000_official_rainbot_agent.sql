alter table public.profiles
  add column if not exists is_bot boolean not null default false,
  add column if not exists bot_label text,
  add column if not exists bot_mode text not null default 'off',
  add column if not exists bot_posting_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bot_label_length'
  ) then
    alter table public.profiles
      add constraint profiles_bot_label_length
      check (bot_label is null or char_length(bot_label) between 2 and 40);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bot_mode_check'
  ) then
    alter table public.profiles
      add constraint profiles_bot_mode_check
      check (bot_mode in ('off', 'draft', 'approved', 'limited'));
  end if;
end;
$$;

create table if not exists public.agent_actions (
  id bigint generated always as identity primary key,
  agent_profile_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null,
  target_type text not null default 'site',
  target_id text,
  target_url text,
  title text,
  body text,
  status text not null default 'draft',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  model text,
  openclaw_session_id text,
  created_by uuid references public.profiles(id) on delete set null,
  executed_at timestamptz,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_actions_action_type_check check (
    action_type in ('content_comment', 'forum_topic', 'forum_reply', 'game_run', 'score_note', 'moderation_note', 'profile_update')
  ),
  constraint agent_actions_target_type_check check (
    target_type in ('site', 'game', 'video', 'article', 'forum_topic', 'forum_reply')
  ),
  constraint agent_actions_status_check check (
    status in ('draft', 'approved', 'posted', 'rejected', 'failed', 'skipped')
  ),
  constraint agent_actions_target_id_length check (target_id is null or char_length(target_id) between 1 and 160),
  constraint agent_actions_target_url_length check (target_url is null or char_length(target_url) <= 300),
  constraint agent_actions_title_length check (title is null or char_length(title) <= 160),
  constraint agent_actions_body_length check (body is null or char_length(body) <= 6000),
  constraint agent_actions_reason_length check (reason is null or char_length(reason) <= 800)
);

create index if not exists agent_actions_agent_status_idx
on public.agent_actions (agent_profile_id, status, created_at desc);

create index if not exists agent_actions_target_idx
on public.agent_actions (target_type, target_id, created_at desc);

drop trigger if exists agent_actions_set_updated_at on public.agent_actions;
create trigger agent_actions_set_updated_at
before update on public.agent_actions
for each row execute function public.set_updated_at();

alter table public.content_comments
  add column if not exists agent_action_id bigint references public.agent_actions(id) on delete set null;

alter table public.forum_topics
  add column if not exists agent_action_id bigint references public.agent_actions(id) on delete set null;

alter table public.forum_replies
  add column if not exists agent_action_id bigint references public.agent_actions(id) on delete set null;

create index if not exists content_comments_agent_action_idx
on public.content_comments (agent_action_id)
where agent_action_id is not null;

create index if not exists forum_topics_agent_action_idx
on public.forum_topics (agent_action_id)
where agent_action_id is not null;

create index if not exists forum_replies_agent_action_idx
on public.forum_replies (agent_action_id)
where agent_action_id is not null;

create or replace function public.is_official_bot_profile(p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and is_bot = true
  );
$$;

create or replace function public.enforce_agent_post_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_action public.agent_actions;
  v_count integer;
  v_expected_action text;
  v_parent_author uuid;
begin
  select is_bot, bot_posting_enabled, bot_mode
    into v_profile
  from public.profiles
  where id = new.author_id;

  if not found or not coalesce(v_profile.is_bot, false) then
    if new.agent_action_id is not null then
      raise exception 'Only official bot profiles can attach agent actions.' using errcode = '42501';
    end if;
    return new;
  end if;

  if not coalesce(v_profile.bot_posting_enabled, false)
    or coalesce(v_profile.bot_mode, 'off') not in ('approved', 'limited') then
    raise exception 'Official bot public posting is disabled.' using errcode = '42501';
  end if;

  if new.agent_action_id is null then
    raise exception 'Official bot posts require an approved agent action.' using errcode = '42501';
  end if;

  select *
    into v_action
  from public.agent_actions
  where id = new.agent_action_id
    and agent_profile_id = new.author_id
  for update;

  if not found then
    raise exception 'Agent action does not belong to this bot profile.' using errcode = '42501';
  end if;

  if v_action.status <> 'approved' then
    raise exception 'Agent action must be approved before public posting.' using errcode = '42501';
  end if;

  v_expected_action = case TG_TABLE_NAME
    when 'content_comments' then 'content_comment'
    when 'forum_topics' then 'forum_topic'
    when 'forum_replies' then 'forum_reply'
    else null
  end;

  if v_action.action_type <> v_expected_action then
    raise exception 'Approved agent action type does not match target table.' using errcode = '23514';
  end if;

  select count(*) into v_count
  from (
    select created_at from public.content_comments where author_id = new.author_id and created_at > now() - interval '24 hours'
    union all
    select created_at from public.forum_topics where author_id = new.author_id and created_at > now() - interval '24 hours'
    union all
    select created_at from public.forum_replies where author_id = new.author_id and created_at > now() - interval '24 hours'
  ) recent_posts;

  if v_count >= 3 then
    raise exception 'Official bot daily public-post limit reached.' using errcode = '42501';
  end if;

  select count(*) into v_count
  from (
    select created_at from public.content_comments where author_id = new.author_id and created_at > now() - interval '30 minutes'
    union all
    select created_at from public.forum_topics where author_id = new.author_id and created_at > now() - interval '30 minutes'
    union all
    select created_at from public.forum_replies where author_id = new.author_id and created_at > now() - interval '30 minutes'
  ) recent_posts;

  if v_count > 0 then
    raise exception 'Official bot public-post cooldown is still active.' using errcode = '42501';
  end if;

  if TG_TABLE_NAME = 'content_comments' then
    if new.parent_id is not null then
      select author_id into v_parent_author
      from public.content_comments
      where id = new.parent_id;
      if v_parent_author = new.author_id then
        raise exception 'Official bot cannot reply to itself.' using errcode = '42501';
      end if;
    else
      select count(*) into v_count
      from public.content_comments
      where author_id = new.author_id
        and content_type = new.content_type
        and content_id = new.content_id
        and parent_id is null;
      if v_count > 0 then
        raise exception 'Official bot already has a top-level comment on this content.' using errcode = '42501';
      end if;
    end if;
  elsif TG_TABLE_NAME = 'forum_topics' then
    select count(*) into v_count
    from public.forum_topics
    where author_id = new.author_id
      and created_at > now() - interval '24 hours';
    if v_count >= 1 then
      raise exception 'Official bot daily forum-topic limit reached.' using errcode = '42501';
    end if;
  elsif TG_TABLE_NAME = 'forum_replies' then
    select author_id into v_parent_author
    from public.forum_topics
    where id = new.topic_id;
    if v_parent_author = new.author_id then
      raise exception 'Official bot cannot reply to its own topic.' using errcode = '42501';
    end if;

    if new.parent_id is not null then
      select author_id into v_parent_author
      from public.forum_replies
      where id = new.parent_id;
      if v_parent_author = new.author_id then
        raise exception 'Official bot cannot reply to itself.' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.mark_agent_action_posted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_action_id is not null then
    update public.agent_actions
    set
      status = 'posted',
      target_id = coalesce(nullif(target_id, ''), new.id::text),
      metadata = jsonb_set(
        jsonb_set(coalesce(metadata, '{}'::jsonb), '{postedTable}', to_jsonb(TG_TABLE_NAME), true),
        '{postedRowId}',
        to_jsonb(new.id::text),
        true
      ),
      executed_at = coalesce(executed_at, now()),
      error_text = null,
      updated_at = now()
    where id = new.agent_action_id
      and agent_profile_id = new.author_id;
  end if;
  return new;
end;
$$;

drop trigger if exists content_comments_agent_guard on public.content_comments;
create trigger content_comments_agent_guard
before insert on public.content_comments
for each row execute function public.enforce_agent_post_guard();

drop trigger if exists forum_topics_agent_guard on public.forum_topics;
create trigger forum_topics_agent_guard
before insert on public.forum_topics
for each row execute function public.enforce_agent_post_guard();

drop trigger if exists forum_replies_agent_guard on public.forum_replies;
create trigger forum_replies_agent_guard
before insert on public.forum_replies
for each row execute function public.enforce_agent_post_guard();

drop trigger if exists content_comments_agent_mark_posted on public.content_comments;
create trigger content_comments_agent_mark_posted
after insert on public.content_comments
for each row execute function public.mark_agent_action_posted();

drop trigger if exists forum_topics_agent_mark_posted on public.forum_topics;
create trigger forum_topics_agent_mark_posted
after insert on public.forum_topics
for each row execute function public.mark_agent_action_posted();

drop trigger if exists forum_replies_agent_mark_posted on public.forum_replies;
create trigger forum_replies_agent_mark_posted
after insert on public.forum_replies
for each row execute function public.mark_agent_action_posted();

alter table public.agent_actions enable row level security;

drop policy if exists agent_actions_select_own_or_mod on public.agent_actions;
create policy agent_actions_select_own_or_mod on public.agent_actions
for select to authenticated
using (agent_profile_id = (select auth.uid()) or (select public.is_moderator()));

drop policy if exists agent_actions_insert_own_bot_draft on public.agent_actions;
create policy agent_actions_insert_own_bot_draft on public.agent_actions
for insert to authenticated
with check (
  agent_profile_id = (select auth.uid())
  and (select public.is_official_bot_profile(auth.uid()))
  and status = 'draft'
);

drop policy if exists agent_actions_update_own_non_approval on public.agent_actions;
create policy agent_actions_update_own_non_approval on public.agent_actions
for update to authenticated
using (
  agent_profile_id = (select auth.uid())
  and status in ('draft', 'failed')
)
with check (
  agent_profile_id = (select auth.uid())
  and status in ('draft', 'failed', 'skipped')
);

drop policy if exists agent_actions_update_mod on public.agent_actions;
create policy agent_actions_update_mod on public.agent_actions
for update to authenticated
using ((select public.is_moderator()))
with check ((select public.is_moderator()));

revoke all on public.agent_actions from anon, authenticated;
grant select, insert, update on public.agent_actions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant insert (agent_action_id) on public.content_comments to authenticated;
grant insert (agent_action_id) on public.forum_topics to authenticated;
grant insert (agent_action_id) on public.forum_replies to authenticated;
