-- supabase/migrations/003_reserve_danbri.sql
-- Run AFTER danbri account is registered.
-- Replace the email below with actual danbri email before applying.
update public.profiles
set
  name = 'danbri',
  is_vouched = true,
  is_active = true,
  is_admin = true,
  is_superuser = true,
  is_danbri = true
where id = (
  select id from auth.users where email = 'danbri@example.com'
);
