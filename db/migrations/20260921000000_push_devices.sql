-- ============================================================================
-- Push notification: perangkat + log kirim (FCM unified web & android)
-- Scope: .unlazy/push leaf-1.1.1
-- Pola: tinta_ledger (event RLS: select own, tulis via service_role/RPC saja)
-- ============================================================================

-- ===== 1) push_devices: satu baris per (user, fcm_token) =====
create table if not exists public.push_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null check (platform in ('web', 'android')),
  fcm_token     text not null unique,
  consent_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists push_devices_user_idx
  on public.push_devices (user_id, last_seen_at desc);

create index if not exists push_devices_platform_idx
  on public.push_devices (platform, last_seen_at desc);

alter table public.push_devices enable row level security;

drop policy if exists push_devices_own_read on public.push_devices;
create policy push_devices_own_read on public.push_devices
  for select using (auth.uid() = user_id);
-- Tidak ada policy write: tulis/hapus hanya via service_role (route /api/push/*).

-- ===== 2) push_log: audit setiap kirim (transaksional + broadcast) =====
create table if not exists public.push_log (
  id            uuid primary key default gen_random_uuid(),
  audience      text not null,          -- 'user:<uuid>' | 'all' | 'web' | 'android'
  title         text not null,
  body          text not null,
  deep_link     text,                   -- rute internal mis. /baca/<id>/1
  dedupe_key    text unique,            -- idempotency transaksional, NULL untuk broadcast
  sent_by       uuid references auth.users(id) on delete set null,
  status        text not null default 'queued'
                check (status in ('queued', 'sent', 'partial', 'failed', 'skipped_disabled')),
  success_count integer not null default 0,
  failure_count integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists push_log_audience_idx
  on public.push_log (audience, created_at desc);

alter table public.push_log enable row level security;
-- Tidak ada policy baca/tulis publik: dibaca admin via service_role saja.
