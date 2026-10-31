-- Tabel atribusi akuisisi (OQ1=A).
-- Desain: docs/designs/PRELAUNCH_ANALYTICS_PROMOTION_GATE.md
-- Kontrak: tepat satu baris per user (UNIQUE user_id); taksonomi kanal tertutup;
-- tanpa teks bebas (reader-safe) — nilai UTM dinormalisasi jadi slug di lib/acquisition/policy.ts.
create extension if not exists pgcrypto;

create table if not exists public.user_acquisition (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  source text not null check (source in (
    'direct',
    'whatsapp',
    'instagram',
    'tiktok',
    'x_twitter',
    'email',
    'google',
    'share_link',
    'referral_code',
    'other'
  )),
  utm_source text null,
  utm_campaign text null,
  referrer_host text null,
  created_at timestamptz not null default now()
);

-- RLS_AUDIT: user_acquisition_service_only
alter table public.user_acquisition enable row level security;
