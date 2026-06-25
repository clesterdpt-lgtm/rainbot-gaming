alter table public.profiles
  drop constraint if exists profiles_avatar_style_check;

alter table public.profiles
  add constraint profiles_avatar_style_check
  check (
    avatar_style in (
      'bot',
      'glitch',
      'storm',
      'slime',
      'crown',
      'skull',
      'wizard',
      'ninja',
      'pilot',
      'lava',
      'crystal',
      'joystick',
      'cassette',
      'racer',
      'hacker',
      'comet',
      'moon',
      'cube',
      'flame',
      'trophy'
    )
  );
