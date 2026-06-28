create table if not exists public.content_comments (
  id bigint generated always as identity primary key,
  parent_id bigint references public.content_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null,
  content_id text not null,
  page_url text not null,
  page_title text not null,
  body text not null,
  vote_score integer not null default 0,
  reply_count integer not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_comments_type_check check (content_type in ('game', 'video', 'article')),
  constraint content_comments_content_id_format check (content_id ~ '^[a-z0-9:_-]{1,120}$'),
  constraint content_comments_page_title_length check (char_length(page_title) between 2 and 140),
  constraint content_comments_page_url_length check (char_length(page_url) between 1 and 300),
  constraint content_comments_body_length check (char_length(body) between 2 and 6000)
);

create table if not exists public.content_comment_votes (
  comment_id bigint not null references public.content_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id),
  constraint content_comment_votes_value_check check (vote in (-1, 1))
);

create index if not exists content_comments_lookup_idx
on public.content_comments (content_type, content_id, is_hidden, parent_id, created_at desc, id desc);

create index if not exists content_comments_author_idx
on public.content_comments (author_id, created_at desc);

create index if not exists content_comment_votes_user_idx
on public.content_comment_votes (user_id, updated_at desc);

drop trigger if exists content_comments_set_updated_at on public.content_comments;
create trigger content_comments_set_updated_at
before update on public.content_comments
for each row execute function public.set_updated_at();

drop trigger if exists content_comment_votes_set_updated_at on public.content_comment_votes;
create trigger content_comment_votes_set_updated_at
before update on public.content_comment_votes
for each row execute function public.set_updated_at();

create or replace function public.refresh_content_comment_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_parent_id bigint;
begin
  affected_parent_id = coalesce(new.parent_id, old.parent_id);
  if affected_parent_id is not null then
    update public.content_comments
    set reply_count = (
      select count(*)::integer
      from public.content_comments child
      where child.parent_id = affected_parent_id
        and child.is_hidden = false
    )
    where id = affected_parent_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists content_comments_refresh_parent on public.content_comments;
create trigger content_comments_refresh_parent
after insert or update or delete on public.content_comments
for each row execute function public.refresh_content_comment_reply_count();

create or replace function public.refresh_content_comment_vote_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_comment_id bigint;
begin
  affected_comment_id = coalesce(new.comment_id, old.comment_id);
  update public.content_comments
  set vote_score = coalesce((
    select sum(vote)::integer
    from public.content_comment_votes
    where comment_id = affected_comment_id
  ), 0)
  where id = affected_comment_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists content_comment_votes_refresh_score on public.content_comment_votes;
create trigger content_comment_votes_refresh_score
after insert or update or delete on public.content_comment_votes
for each row execute function public.refresh_content_comment_vote_score();

alter table public.content_comments enable row level security;
alter table public.content_comment_votes enable row level security;

drop policy if exists content_comments_public_read on public.content_comments;
create policy content_comments_public_read on public.content_comments
for select using (is_hidden = false or (select public.is_moderator()));

drop policy if exists content_comments_insert_own on public.content_comments;
create policy content_comments_insert_own on public.content_comments
for insert to authenticated
with check (author_id = (select auth.uid()));

drop policy if exists content_comments_update_owner_or_mod on public.content_comments;
create policy content_comments_update_owner_or_mod on public.content_comments
for update to authenticated
using (author_id = (select auth.uid()) or (select public.is_moderator()))
with check (author_id = (select auth.uid()) or (select public.is_moderator()));

drop policy if exists content_comment_votes_read_own on public.content_comment_votes;
create policy content_comment_votes_read_own on public.content_comment_votes
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists content_comment_votes_insert_own on public.content_comment_votes;
create policy content_comment_votes_insert_own on public.content_comment_votes
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists content_comment_votes_update_own on public.content_comment_votes;
create policy content_comment_votes_update_own on public.content_comment_votes
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists content_comment_votes_delete_own on public.content_comment_votes;
create policy content_comment_votes_delete_own on public.content_comment_votes
for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on public.content_comments from anon, authenticated;
grant select on public.content_comments to anon, authenticated;
grant insert (parent_id, author_id, content_type, content_id, page_url, page_title, body) on public.content_comments to authenticated;
grant update (body, updated_at) on public.content_comments to authenticated;

revoke all on public.content_comment_votes from anon, authenticated;
grant select, insert, update, delete on public.content_comment_votes to authenticated;

grant usage, select on all sequences in schema public to authenticated;
