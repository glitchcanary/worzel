-- supabase/migrations/002_account_relations.sql
create type public.relation_type as enum (
  'vouches_for',
  'follows',
  'sockpuppet',
  'responsible_party',
  'responsible_human'
);

create table public.account_relations (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  relation relation_type not null,
  asserted_by uuid references public.profiles(id),  -- admin who asserted it
  created_at timestamptz not null default now()
);

-- No duplicates per relation type between same pair
create unique index account_relations_unique
  on public.account_relations (from_id, to_id, relation);

alter table public.account_relations enable row level security;

-- Only admins can insert/update/delete relations
create policy "Admins can manage relations"
  on public.account_relations for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and (p.is_admin or p.is_superuser)
    )
  );

-- Anyone can read relations (public social graph)
create policy "Anyone can view relations"
  on public.account_relations for select
  using (true);
