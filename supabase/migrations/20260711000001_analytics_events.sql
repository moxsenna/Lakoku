-- Migration: analytics_events
-- Tabel event analytics ringan untuk funnel story creation.
-- Insert melalui admin client (service role), bukan RLS user.
-- Tidak menyimpan raw customIdea, jawaban quiz, atau profile mentah.

create extension if not exists pgcrypto;

create table if not exists public.analytics_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid null references auth.users (id) on delete set null,
  anonymous_id  text null,
  event_name    text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists analytics_events_event_name_idx
  on public.analytics_events (event_name);
create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at);
create index if not exists analytics_events_user_id_idx
  on public.analytics_events (user_id);
create index if not exists analytics_events_anonymous_id_idx
  on public.analytics_events (anonymous_id);

alter table public.analytics_events enable row level security;

-- Tidak ada public policy. Insert hanya lewat admin client (service role).