-- S3: roles and profiles. Applied via `supabase db push` / `supabase start`
-- once Docker + the Supabase CLI are available (see plan §6-S3).

create type public.role_enum as enum ('customer', 'operator', 'admin');

create table public.profiles (
  id text primary key default ('prof_' || upper(substr(md5(random()::text), 1, 26))),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role public.role_enum not null default 'customer',
  name text not null default '',
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create a profile row automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- A user may read their own profile.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

-- A user may update their own profile, but never their role: the update is
-- only permitted when the row's role stays what it already is. Role changes
-- happen exclusively through the service-role key in server code.
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and role = (select p.role from public.profiles p where p.user_id = auth.uid())
  );

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Table-level privileges. RLS policies above filter WHICH rows each role sees,
-- but Postgres still requires base GRANTs for the role to touch the table at
-- all. The authenticated role reads/updates its own row (rows restricted by
-- RLS); service_role bypasses RLS for server-side administration.
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
