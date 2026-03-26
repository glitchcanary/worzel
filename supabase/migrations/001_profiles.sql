-- supabase/migrations/001_profiles.sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  is_vouched boolean not null default false,
  is_active boolean not null default true,
  is_guest boolean not null default false,
  is_admin boolean not null default false,
  is_superuser boolean not null default false,
  is_danbri boolean not null default false,
  guest_color text,  -- e.g. 'Purple', 'Red', null for non-guests
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS: users can read their own profile; admins can read all
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and (p.is_admin or p.is_superuser)
    )
  );

create policy "Admins can update all profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and (p.is_admin or p.is_superuser)
    )
  );
