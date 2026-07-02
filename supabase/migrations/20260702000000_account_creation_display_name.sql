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
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
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
