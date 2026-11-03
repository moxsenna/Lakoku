-- Shell skema auth legacy (Supabase GoTrue) untuk rebuild fresh.
--
-- Latar (audit 2026-11-04): sebagian besar DDL tabel domain (paycore, misi,
-- referral, dst.) inline menulis `references auth.users(id)`, dan policy RLS
-- sejak migrasi pertama memanggil auth.uid(). Di produksi FK itu tidak
-- pernah terpasang (tabel sudah ada sebelum migrasinya berjalan), tetapi
-- pada rebuild dari nol keduanya butuh schema auth ADA sejak awal.
--
-- Shell ini hanya target FK + stub auth.uid() yang identik dengan
-- auth_uid_guc_fix (20261004): membaca GUC request.jwt.claim.sub yang
-- di-set transaksi aplikasi. Produksi tidak terdampak (semua statement
-- idempoten; auth.uid() di-replace dengan body yang sama).
-- Setelah 20261104130000 seluruh FK domain merepoint ke public."user";
-- shell ini tetap diperlukan agar DDL inline lama tetap bisa dieksekusi.

create schema if not exists auth;

-- Skema extensions (konvensi Supabase) + ekstensi yang dipakai migrasi.
-- pgcrypto dipasang DI DALAM extensions (migrasi memanggil
-- extensions.gen_random_bytes / extensions.digest / extensions.hmac).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Role bawaan lingkungan Supabase yang di-GRANT oleh banyak migrasi.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
