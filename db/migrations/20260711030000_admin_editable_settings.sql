-- ============================================================================
-- Admin editable settings: audit log + schema hardening.
-- ============================================================================

-- 1) Admin settings audit log
create table if not exists public.admin_settings_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  admin_email text,
  setting_area text not null,
  setting_key text not null,
  old_value jsonb,
  new_value jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_settings_audit_logs_created_at_idx
  on public.admin_settings_audit_logs (created_at desc);

create index if not exists admin_settings_audit_logs_area_key_idx
  on public.admin_settings_audit_logs (setting_area, setting_key);

alter table public.admin_settings_audit_logs enable row level security;

-- 2) Pastikan feature_credit_costs punya chapter_unlock
insert into public.feature_credit_costs (
  feature_key,
  credits_required,
  is_active,
  pricing_version,
  metadata
)
values (
  'chapter_unlock',
  5,
  true,
  '2026-07-default',
  '{}'::jsonb
)
on conflict (feature_key) do nothing;

-- 3) Pastikan ai_model_routes.fallback_models adalah text[] (sudah dari migrasi awal).
-- Kalau masih single fallback text, tidak ada migrasi — gunakan langsung text[].
