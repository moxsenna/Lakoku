-- ============================================================================
-- Ops credit & admin config: bonus topup, order snapshot, admin grant,
-- generation policy, AI model routes, feature credit costs.
-- Source of truth bisnis pindah ke DB; code hanya validasi + fallback aman.
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1) credit_products: bonus normal + first topup + badge + bonus_active.
-- -----------------------------------------------------------------------
alter table public.credit_products
  add column if not exists normal_bonus_credits integer not null default 0 check (normal_bonus_credits >= 0),
  add column if not exists first_topup_bonus_credits integer not null default 0 check (first_topup_bonus_credits >= 0),
  add column if not exists marketing_badge text,
  add column if not exists bonus_active boolean not null default true;

create index if not exists credit_products_active_sort_idx
  on public.credit_products (active, sort_order);

-- Seed bonus values untuk 6 SKU existing (idempotent update).
update public.credit_products
set
  normal_bonus_credits = case product_key
    when 'credits_starter' then 3
    when 'credits_basic' then 8
    when 'credits_plus' then 20
    when 'credits_pro' then 60
    when 'credits_max' then 175
    when 'credits_ultra' then 600
    else normal_bonus_credits
  end,
  first_topup_bonus_credits = case product_key
    when 'credits_starter' then 10
    when 'credits_basic' then 20
    when 'credits_plus' then 40
    when 'credits_pro' then 100
    when 'credits_max' then 250
    when 'credits_ultra' then 800
    else first_topup_bonus_credits
  end,
  marketing_badge = case product_key
    when 'credits_starter' then 'Bonus pemula'
    when 'credits_basic' then 'Populer'
    when 'credits_plus' then 'Bonus ekstra'
    when 'credits_pro' then 'Best value'
    when 'credits_max' then 'Hemat besar'
    when 'credits_ultra' then 'Power reader'
    else marketing_badge
  end
where product_key in (
  'credits_starter',
  'credits_basic',
  'credits_plus',
  'credits_pro',
  'credits_max',
  'credits_ultra'
);

-- -----------------------------------------------------------------------
-- 2) credit_orders: snapshot order (harga & kredit beku saat checkout).
-- -----------------------------------------------------------------------
create table if not exists public.credit_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_key text not null,
  price_idr integer not null check (price_idr >= 0),
  base_credits integer not null check (base_credits >= 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  total_credits integer not null check (total_credits >= 0),
  bonus_kind text not null default 'none' check (bonus_kind in ('none', 'normal', 'first_topup')),
  status text not null default 'created' check (status in ('created', 'paid', 'duplicate', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists credit_orders_user_idx
  on public.credit_orders (user_id, created_at desc);

alter table public.credit_orders enable row level security;

drop policy if exists credit_orders_own_read on public.credit_orders;
create policy credit_orders_own_read
  on public.credit_orders
  for select
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------
-- 3) has_paid_topup_v1: cek apakah user sudah pernah topup berbayar.
-- -----------------------------------------------------------------------
create or replace function public.has_paid_topup_v1(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.credit_ledger
    where user_id = p_user_id
      and delta > 0
      and ref like 'paycore:%'
  );
$$;

grant execute on function public.has_paid_topup_v1(uuid) to service_role;

-- -----------------------------------------------------------------------
-- 4) admin_credit_grants: audit trail untuk grant kredit manual admin.
-- -----------------------------------------------------------------------
create table if not exists public.admin_credit_grants (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  credits integer not null check (credits > 0 and credits <= 100000),
  reason text not null check (length(reason) >= 3 and length(reason) <= 500),
  ledger_ref text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists admin_credit_grants_target_idx
  on public.admin_credit_grants (target_user_id, created_at desc);

create index if not exists admin_credit_grants_admin_idx
  on public.admin_credit_grants (admin_user_id, created_at desc);

alter table public.admin_credit_grants enable row level security;
-- Tidak ada policy write public. Semua write via service_role route.

-- -----------------------------------------------------------------------
-- 5) admin_grant_credits_v1: RPC atomic grant + audit dalam satu tx.
-- -----------------------------------------------------------------------
create or replace function public.admin_grant_credits_v1(
  p_target_user_id uuid,
  p_admin_user_id uuid,
  p_credits integer,
  p_reason text,
  p_ref text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_credits <= 0 or p_credits > 100000 then
    raise exception 'admin_grant_credits_v1: invalid credits';
  end if;

  if length(coalesce(p_reason, '')) < 3 then
    raise exception 'admin_grant_credits_v1: reason too short';
  end if;

  insert into public.admin_credit_grants (
    target_user_id,
    admin_user_id,
    credits,
    reason,
    ledger_ref
  )
  values (
    p_target_user_id,
    p_admin_user_id,
    p_credits,
    p_reason,
    p_ref
  )
  on conflict (ledger_ref) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return false;
  end if;

  insert into public.credit_ledger (
    user_id,
    delta,
    reason,
    ref
  )
  values (
    p_target_user_id,
    p_credits,
    'admin_grant',
    p_ref
  );

  return true;
end;
$$;

grant execute on function public.admin_grant_credits_v1(uuid, uuid, integer, text, text) to service_role;

-- -----------------------------------------------------------------------
-- 6) generation_policy: target panjang bab 800–1000 kata.
-- -----------------------------------------------------------------------
create table if not exists public.generation_policy (
  id integer primary key default 1 check (id = 1),
  target_words_min integer not null default 800 check (target_words_min >= 100),
  target_words_max integer not null default 1000 check (target_words_max >= target_words_min),
  target_scenes integer not null default 3 check (target_scenes >= 1 and target_scenes <= 8),
  updated_at timestamptz not null default now()
);

insert into public.generation_policy (
  id,
  target_words_min,
  target_words_max,
  target_scenes
)
values (1, 800, 1000, 3)
on conflict (id) do update
set
  target_words_min = excluded.target_words_min,
  target_words_max = excluded.target_words_max,
  target_scenes = excluded.target_scenes,
  updated_at = now();

alter table public.generation_policy enable row level security;

drop policy if exists generation_policy_read on public.generation_policy;
create policy generation_policy_read
  on public.generation_policy
  for select
  using (true);

-- -----------------------------------------------------------------------
-- 7) ai_model_routes: route model AI per use_case (DB-backed).
-- -----------------------------------------------------------------------
create table if not exists public.ai_model_routes (
  id uuid primary key default gen_random_uuid(),
  use_case text not null,
  provider text not null check (provider in ('custom', 'openrouter', 'gateway', 'deterministic')),
  model_id text not null,
  fallback_models text[] not null default '{}',
  temperature numeric,
  max_output_tokens integer,
  is_active boolean not null default true,
  route_version text not null default 'default',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_model_routes_use_case_idx
  on public.ai_model_routes (use_case, is_active);

alter table public.ai_model_routes enable row level security;

-- Hanya satu route aktif per use_case (partial unique index).
drop index if exists ai_model_routes_one_active_idx;
create unique index if not exists ai_model_routes_one_active_idx
  on public.ai_model_routes (use_case)
  where is_active = true;

-- Seed route default.
insert into public.ai_model_routes (
  use_case,
  provider,
  model_id,
  fallback_models,
  route_version,
  notes
)
values (
  'chapter_prose',
  'openrouter',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  array['deepseek/deepseek-v3.2'],
  '2026-07-default',
  'Default prose route'
)
on conflict do nothing;

-- -----------------------------------------------------------------------
-- 8) feature_credit_costs: biaya kredit per fitur (siap untuk fitur baru).
-- -----------------------------------------------------------------------
create table if not exists public.feature_credit_costs (
  feature_key text primary key,
  credits_required integer not null check (credits_required >= 0),
  is_active boolean not null default true,
  pricing_version text not null default 'default',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.feature_credit_costs enable row level security;

drop policy if exists feature_credit_costs_read on public.feature_credit_costs;
create policy feature_credit_costs_read
  on public.feature_credit_costs
  for select
  using (true);

insert into public.feature_credit_costs (
  feature_key,
  credits_required,
  pricing_version
)
values
  ('chapter_unlock', 5, '2026-07-default'),
  ('chapter_generate', 0, '2026-07-default')
on conflict (feature_key) do nothing;
