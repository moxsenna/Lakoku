-- Migration: story_setup_jobs
-- Job latar belakang perakitan story bible (cast → mystery → world → lock).
-- Menggantikan server action panjang tunggal yang merakit semuanya dalam satu
-- request — pola lama rawan dipotong timeout proxy (Cloudflare ±100s → 524)
-- di depan pembaca sebelum cerita selesai disusun.
-- Status: queued → running → succeeded | failed. Hasil per tahap dipersist
-- (cast/mystery/world) agar retry bisa melanjutkan dari tahap yang gagal
-- tanpa membakar ulang panggilan tahap yang sudah sukses.
-- Akses hanya dari server (Kysely admin) — tanpa RLS, mengikuti konvensi
-- tabel job lain di schema ini.

create extension if not exists pgcrypto;

create table if not exists public.story_setup_jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public."user" (id) on delete cascade,
  status             text not null default 'queued',
  stage              text not null default 'cast',
  error_code         text,
  error_message      text,
  premise            jsonb not null,
  creative_direction jsonb,
  cast_result        jsonb,
  mystery_result     jsonb,
  world_result       jsonb,
  story_id           text,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists story_setup_jobs_user_id_idx
  on public.story_setup_jobs (user_id, created_at desc);

-- Index parsial untuk antrean aktif (polling status & supersede job lama).
create index if not exists story_setup_jobs_active_idx
  on public.story_setup_jobs (user_id)
  where status in ('queued', 'running');
