alter table public.forum_replies
add column if not exists parent_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'forum_replies_parent_id_fkey'
      and conrelid = 'public.forum_replies'::regclass
  ) then
    alter table public.forum_replies
      add constraint forum_replies_parent_id_fkey
      foreign key (parent_id) references public.forum_replies(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'forum_replies_parent_not_self'
      and conrelid = 'public.forum_replies'::regclass
  ) then
    alter table public.forum_replies
      add constraint forum_replies_parent_not_self
      check (parent_id is null or parent_id <> id) not valid;
    alter table public.forum_replies validate constraint forum_replies_parent_not_self;
  end if;
end $$;

create index if not exists forum_replies_parent_created_idx
on public.forum_replies (parent_id, created_at, id)
where parent_id is not null;

create or replace function public.validate_forum_reply_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_topic_id bigint;
  parent_is_hidden boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  select topic_id, is_hidden
  into parent_topic_id, parent_is_hidden
  from public.forum_replies
  where id = new.parent_id;

  if parent_topic_id is null then
    raise exception 'Parent reply not found.' using errcode = '23503';
  end if;

  if parent_topic_id <> new.topic_id then
    raise exception 'Parent reply must belong to the same topic.' using errcode = '23514';
  end if;

  if parent_is_hidden and not public.is_moderator() then
    raise exception 'Parent reply is not available.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists forum_replies_validate_parent on public.forum_replies;
create trigger forum_replies_validate_parent
before insert or update of parent_id, topic_id on public.forum_replies
for each row execute function public.validate_forum_reply_parent();

grant insert (topic_id, parent_id, author_id, body) on public.forum_replies to authenticated;
