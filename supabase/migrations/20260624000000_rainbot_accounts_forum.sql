create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Rainbot Player',
  avatar_url text,
  role text not null default 'player',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 2 and 32),
  constraint profiles_role_check check (role in ('player', 'moderator', 'admin'))
);

create table if not exists public.game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  version integer not null default 1,
  save_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  local_saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id),
  constraint game_saves_game_id_format check (game_id ~ '^[a-z0-9:_-]{1,96}$'),
  constraint game_saves_version_positive check (version > 0)
);

create table if not exists public.game_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  score bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id),
  constraint game_scores_game_id_format check (game_id ~ '^[a-z0-9:_-]{1,96}$'),
  constraint game_scores_score_nonnegative check (score >= 0)
);

create table if not exists public.forum_topics (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  category text not null default 'general',
  game_id text,
  reply_count integer not null default 0,
  is_pinned boolean not null default false,
  is_locked boolean not null default false,
  is_hidden boolean not null default false,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_topics_title_length check (char_length(title) between 4 and 110),
  constraint forum_topics_body_length check (char_length(body) between 4 and 6000),
  constraint forum_topics_category_check check (category in ('general', 'game-feedback', 'bug-reports', 'ideas', 'scores-clips', 'announcements')),
  constraint forum_topics_game_id_format check (game_id is null or game_id ~ '^[a-z0-9:_-]{1,96}$')
);

create table if not exists public.forum_replies (
  id bigint generated always as identity primary key,
  topic_id bigint not null references public.forum_topics(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_replies_body_length check (char_length(body) between 2 and 6000)
);

create table if not exists public.forum_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  topic_id bigint references public.forum_topics(id) on delete cascade,
  reply_id bigint references public.forum_replies(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_reports_target_check check (
    (topic_id is not null and reply_id is null) or
    (topic_id is null and reply_id is not null)
  ),
  constraint forum_reports_reason_length check (char_length(reason) between 4 and 800),
  constraint forum_reports_status_check check (status in ('open', 'reviewing', 'closed'))
);

create index if not exists game_saves_user_updated_idx on public.game_saves (user_id, updated_at desc);
create index if not exists game_scores_game_score_idx on public.game_scores (game_id, score desc, updated_at desc);
create index if not exists game_scores_user_updated_idx on public.game_scores (user_id, updated_at desc);
create index if not exists forum_topics_author_idx on public.forum_topics (author_id);
create index if not exists forum_topics_activity_idx on public.forum_topics (is_hidden, category, last_activity_at desc, id desc);
create index if not exists forum_topics_game_idx on public.forum_topics (game_id, last_activity_at desc) where game_id is not null;
create index if not exists forum_replies_topic_created_idx on public.forum_replies (topic_id, created_at, id);
create index if not exists forum_replies_author_idx on public.forum_replies (author_id);
create index if not exists forum_reports_reporter_idx on public.forum_reports (reporter_id, created_at desc);
create index if not exists forum_reports_topic_idx on public.forum_reports (topic_id) where topic_id is not null;
create index if not exists forum_reports_reply_idx on public.forum_reports (reply_id) where reply_id is not null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists game_saves_set_updated_at on public.game_saves;
create trigger game_saves_set_updated_at
before update on public.game_saves
for each row execute function public.set_updated_at();

drop trigger if exists game_scores_set_updated_at on public.game_scores;
create trigger game_scores_set_updated_at
before update on public.game_scores
for each row execute function public.set_updated_at();

drop trigger if exists forum_topics_set_updated_at on public.forum_topics;
create trigger forum_topics_set_updated_at
before update on public.forum_topics
for each row execute function public.set_updated_at();

drop trigger if exists forum_replies_set_updated_at on public.forum_replies;
create trigger forum_replies_set_updated_at
before update on public.forum_replies
for each row execute function public.set_updated_at();

drop trigger if exists forum_reports_set_updated_at on public.forum_reports;
create trigger forum_reports_set_updated_at
before update on public.forum_reports
for each row execute function public.set_updated_at();

create or replace function public.is_moderator()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('moderator', 'admin')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_name text;
begin
  candidate_name = coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1),
    'Rainbot Player'
  );
  if char_length(candidate_name) < 2 then
    candidate_name = 'Rainbot Player';
  end if;

  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(candidate_name, 32)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.refresh_topic_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_topic_id bigint;
begin
  affected_topic_id = coalesce(new.topic_id, old.topic_id);
  update public.forum_topics
  set
    reply_count = (
      select count(*)::integer
      from public.forum_replies
      where topic_id = affected_topic_id
        and is_hidden = false
    ),
    last_activity_at = greatest(
      public.forum_topics.created_at,
      coalesce((
        select max(created_at)
        from public.forum_replies
        where topic_id = affected_topic_id
          and is_hidden = false
      ), public.forum_topics.created_at)
    )
  where id = affected_topic_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists forum_replies_refresh_topic on public.forum_replies;
create trigger forum_replies_refresh_topic
after insert or update or delete on public.forum_replies
for each row execute function public.refresh_topic_reply_count();

create or replace function public.record_high_score(
  p_game_id text,
  p_score bigint,
  p_metadata jsonb default '{}'::jsonb
)
returns public.game_scores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row public.game_scores;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_game_id is null or p_game_id !~ '^[a-z0-9:_-]{1,96}$' then
    raise exception 'invalid game id';
  end if;
  if p_score < 0 then
    raise exception 'invalid score';
  end if;

  insert into public.game_scores (user_id, game_id, score, metadata)
  values (v_user_id, p_game_id, p_score, coalesce(p_metadata, '{}'::jsonb))
  on conflict (user_id, game_id) do update
  set
    score = greatest(public.game_scores.score, excluded.score),
    metadata = case
      when excluded.score >= public.game_scores.score then excluded.metadata
      else public.game_scores.metadata
    end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

alter table public.profiles enable row level security;
alter table public.game_saves enable row level security;
alter table public.game_scores enable row level security;
alter table public.forum_topics enable row level security;
alter table public.forum_replies enable row level security;
alter table public.forum_reports enable row level security;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
for select using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists game_saves_owner_all on public.game_saves;
create policy game_saves_owner_all on public.game_saves
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists game_scores_public_read on public.game_scores;
create policy game_scores_public_read on public.game_scores
for select using (true);

drop policy if exists forum_topics_public_read on public.forum_topics;
create policy forum_topics_public_read on public.forum_topics
for select using (is_hidden = false or (select public.is_moderator()));

drop policy if exists forum_topics_insert_own on public.forum_topics;
create policy forum_topics_insert_own on public.forum_topics
for insert to authenticated
with check (author_id = (select auth.uid()));

drop policy if exists forum_topics_update_owner_or_mod on public.forum_topics;
create policy forum_topics_update_owner_or_mod on public.forum_topics
for update to authenticated
using (author_id = (select auth.uid()) or (select public.is_moderator()))
with check (author_id = (select auth.uid()) or (select public.is_moderator()));

drop policy if exists forum_replies_public_read on public.forum_replies;
create policy forum_replies_public_read on public.forum_replies
for select using (is_hidden = false or (select public.is_moderator()));

drop policy if exists forum_replies_insert_own on public.forum_replies;
create policy forum_replies_insert_own on public.forum_replies
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.forum_topics
    where public.forum_topics.id = public.forum_replies.topic_id
      and is_hidden = false
      and is_locked = false
  )
);

drop policy if exists forum_replies_update_owner_or_mod on public.forum_replies;
create policy forum_replies_update_owner_or_mod on public.forum_replies
for update to authenticated
using (author_id = (select auth.uid()) or (select public.is_moderator()))
with check (author_id = (select auth.uid()) or (select public.is_moderator()));

drop policy if exists forum_reports_insert_own on public.forum_reports;
create policy forum_reports_insert_own on public.forum_reports
for insert to authenticated
with check (reporter_id = (select auth.uid()));

drop policy if exists forum_reports_read_own_or_mod on public.forum_reports;
create policy forum_reports_read_own_or_mod on public.forum_reports
for select to authenticated
using (reporter_id = (select auth.uid()) or (select public.is_moderator()));

drop policy if exists forum_reports_update_mod on public.forum_reports;
create policy forum_reports_update_mod on public.forum_reports
for update to authenticated
using ((select public.is_moderator()))
with check ((select public.is_moderator()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert (id, display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;

revoke all on public.game_saves from anon, authenticated;
grant select, insert, update, delete on public.game_saves to authenticated;

revoke all on public.game_scores from anon, authenticated;
grant select on public.game_scores to anon, authenticated;

revoke all on public.forum_topics from anon, authenticated;
grant select on public.forum_topics to anon, authenticated;
grant insert (author_id, title, body, category, game_id) on public.forum_topics to authenticated;
grant update (title, body, category, game_id, updated_at) on public.forum_topics to authenticated;

revoke all on public.forum_replies from anon, authenticated;
grant select on public.forum_replies to anon, authenticated;
grant insert (topic_id, author_id, body) on public.forum_replies to authenticated;
grant update (body, updated_at) on public.forum_replies to authenticated;

revoke all on public.forum_reports from anon, authenticated;
grant insert (reporter_id, topic_id, reply_id, reason) on public.forum_reports to authenticated;
grant select on public.forum_reports to authenticated;
grant update (status, updated_at) on public.forum_reports to authenticated;

grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.record_high_score(text, bigint, jsonb) to authenticated;
