-- ============================================================================
-- Admin users: role-based access control untuk panel admin.
-- Admin/owner diidentifikasi via tabel ini (DB), bukan hardcode email di kode.
-- ============================================================================

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Tidak ada public select/insert/update policy.
-- Table ini hanya dibaca server via service role.

-- Seed: insert moxsenna@gmail.com sebagai owner (bila akun sudah ada di auth.users).
-- Bila akun belum ada, query ini no-op (do nothing).
insert into public.admin_users (
  user_id,
  role
)
select
  id,
  'owner'
from auth.users
where lower(email) = lower('moxsenna@gmail.com')
on conflict (user_id) do update
set
  role = 'owner',
  updated_at = now();
