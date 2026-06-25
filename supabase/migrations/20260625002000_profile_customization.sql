alter table public.profiles
  add column if not exists profile_title text not null default 'Arcade Regular',
  add column if not exists bio text not null default '',
  add column if not exists favorite_game text not null default '',
  add column if not exists avatar_style text not null default 'bot',
  add column if not exists accent_color text not null default 'cyan';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_profile_title_length'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_profile_title_length check (char_length(profile_title) between 2 and 40);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_bio_length'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_length check (char_length(bio) <= 180);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_favorite_game_length'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_favorite_game_length check (char_length(favorite_game) <= 80);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_avatar_style_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_style_check check (avatar_style in ('bot', 'glitch', 'storm', 'slime', 'crown', 'skull'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_accent_color_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_accent_color_check check (accent_color in ('cyan', 'pink', 'yellow', 'green', 'red', 'white'));
  end if;
end $$;

grant insert (id, display_name, avatar_url, profile_title, bio, favorite_game, avatar_style, accent_color, updated_at) on public.profiles to authenticated;
grant update (display_name, avatar_url, profile_title, bio, favorite_game, avatar_style, accent_color, updated_at) on public.profiles to authenticated;
