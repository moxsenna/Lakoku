-- ============================================================================
-- Dompet Imbalan & Komisi Referral (M1 dengan rel M2)
-- Spec: docs/superpowers/specs/2026-09-17-dompet-imbalan-referral-design.md
-- ============================================================================

-- 1) referral_codes: kode permanen per user (dibuat saat registrasi atau on-demand)
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists referral_codes_code_idx on public.referral_codes(code);
alter table public.referral_codes enable row level security;

drop policy if exists referral_codes_own_read on public.referral_codes;
create policy referral_codes_own_read on public.referral_codes
  for select using (auth.uid() = user_id);

-- 2) referral_attributions: ikatan pengajak dan pembaca baru (unik seumur hidup)
create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  source text not null default 'referral_code',
  shared_link_id uuid references public.shared_story_links(id) on delete set null,
  attributed_at timestamptz not null default now(),
  window_ends_at timestamptz not null,
  constraint referral_attributions_no_self_referral check (referrer_user_id <> referred_user_id),
  constraint referral_attributions_source_check check (source in ('referral_code', 'share_link'))
);

create index if not exists referral_attributions_referrer_idx
  on public.referral_attributions(referrer_user_id, attributed_at desc);

alter table public.referral_attributions enable row level security;

drop policy if exists referral_attributions_own_read on public.referral_attributions;
create policy referral_attributions_own_read on public.referral_attributions
  for select using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);

-- 3) reward_ledger: buku kas rupiah terpisah dari kredit (arus satu arah)
create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_idr integer not null,
  reason text not null,
  ref text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists reward_ledger_user_idx
  on public.reward_ledger(user_id, created_at desc);

alter table public.reward_ledger enable row level security;

drop policy if exists reward_ledger_own_read on public.reward_ledger;
create policy reward_ledger_own_read on public.reward_ledger
  for select using (auth.uid() = user_id);

-- RPC reward_balance_v1: hitung saldo rupiah user
create or replace function public.reward_balance_v1(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(delta_idr), 0)::int
  from public.reward_ledger
  where user_id = p_user_id;
$$;

grant execute on function public.reward_balance_v1(uuid) to authenticated, service_role;

-- RPC grant_reward_v1: tulis entri ledger idempoten
create or replace function public.grant_reward_v1(
  p_user_id uuid,
  p_ref text,
  p_delta_idr integer,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_delta_idr = 0 then
    raise exception 'grant_reward_v1: delta_idr cannot be zero';
  end if;

  insert into public.reward_ledger (user_id, delta_idr, reason, ref)
  values (p_user_id, p_delta_idr, p_reason, p_ref);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

grant execute on function public.grant_reward_v1(uuid, text, integer, text) to service_role;

-- 4) reward_policy: konfigurasi baris tunggal (id = true), editable lewat admin
create table if not exists public.reward_policy (
  id boolean primary key default true check (id = true),
  commission_percent integer not null default 10 check (commission_percent >= 0 and commission_percent <= 50),
  window_days integer not null default 30 check (window_days >= 1 and window_days <= 365),
  attribution_cookie_days integer not null default 30 check (attribution_cookie_days >= 1 and attribution_cookie_days <= 365),
  redeem_rate_idr_per_credit integer not null default 250 check (redeem_rate_idr_per_credit >= 50 and redeem_rate_idr_per_credit <= 10000),
  redeem_min_idr integer not null default 1000 check (redeem_min_idr >= 0),
  commission_enabled boolean not null default false,
  redeem_enabled boolean not null default true,
  payout_enabled boolean not null default false,
  payout_min_idr integer not null default 50000 check (payout_min_idr >= 0),
  updated_at timestamptz not null default now()
);

insert into public.reward_policy (
  id,
  commission_percent,
  window_days,
  attribution_cookie_days,
  redeem_rate_idr_per_credit,
  redeem_min_idr,
  commission_enabled,
  redeem_enabled,
  payout_enabled,
  payout_min_idr
) values (
  true,
  10,
  30,
  30,
  250,
  1000,
  false,
  true,
  false,
  50000
)
on conflict (id) do nothing;

alter table public.reward_policy enable row level security;

drop policy if exists reward_policy_read on public.reward_policy;
create policy reward_policy_read on public.reward_policy
  for select using (true);
