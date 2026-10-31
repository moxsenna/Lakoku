-- Migration: reader_taste_profiles
-- Menyimpan preferensi selera cerita pembaca (genre, trope, intensitas, gaya, batas).
-- Satu baris per user; guest hanya pakai localStorage fallback.

create table if not exists public.reader_taste_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  taste_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Satu profile per user.
create unique index if not exists reader_taste_profiles_user_uidx
  on public.reader_taste_profiles (user_id);

alter table public.reader_taste_profiles enable row level security;

-- SELECT: hanya pemilik.
drop policy if exists reader_taste_profiles_select_self on public.reader_taste_profiles;
create policy reader_taste_profiles_select_self
  on public.reader_taste_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- INSERT: hanya untuk diri sendiri.
drop policy if exists reader_taste_profiles_insert_self on public.reader_taste_profiles;
create policy reader_taste_profiles_insert_self
  on public.reader_taste_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- UPDATE: hanya pemilik.
drop policy if exists reader_taste_profiles_update_self on public.reader_taste_profiles;
create policy reader_taste_profiles_update_self
  on public.reader_taste_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
