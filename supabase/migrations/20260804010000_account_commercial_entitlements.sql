-- Migration 20260804010000_account_commercial_entitlements.sql
-- Account commercial states, starter story claim, welcome grant (with strict idempotency validation),
-- explicit commercial_origin column without unsafe permanent default, hardened spend_credits_v1 (reservation-aware),
-- and strict ACL hardening.

-- 1) Account Commercial States table (INTERNAL ONLY - NO READER RLS ACCESS)
create table if not exists public.account_commercial_states (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  starter_story_id          text null,
  starter_claimed_at        timestamptz null,
  welcome_credit_granted_at timestamptz null,
  welcome_credit_event_id   uuid null,
  risk_state                text not null default 'NORMAL' check (risk_state in ('NORMAL', 'WATCH', 'CHALLENGE', 'BLOCK')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Enable RLS and DO NOT add policies for anon/authenticated (strictly service_role only)
alter table public.account_commercial_states enable row level security;

-- 2) Add commercial_origin column to stories table (NO UNSAFE DEFAULT)
alter table public.stories
  add column if not exists commercial_origin text
  check (commercial_origin in ('STARTER_FREE', 'PENDING_PAID_START', 'PAID_START', 'LEGACY_GRANDFATHERED', 'ADMIN_GRANTED'));

-- Explicit deterministic backfill ONLY for pre-existing owned private/personalized story instances
update public.stories
set commercial_origin = 'LEGACY_GRANDFATHERED'
where owner_user_id is not null
  and id not like 'demo:%'
  and visibility in ('private', 'unlisted')
  and commercial_origin is null;

-- 3) Seed/update canonical DB pricing in feature_credit_costs (chapter_unlock = 8, story_start = 24)
insert into public.feature_credit_costs (feature_key, credits_required, is_active, pricing_version)
values
  ('chapter_unlock', 8, true, 'v1.1'),
  ('story_start', 24, true, 'v1.1')
on conflict (feature_key) do update
set credits_required = excluded.credits_required,
    is_active = true,
    updated_at = clock_timestamp();

-- 4) RPC: spend_credits_v1 (HARDENED: Reservation-Aware Spend)
-- Normal spend MUST exclude ACTIVE, unexpired reservations so reservations cannot be bypassed by legacy spend.
create or replace function public.spend_credits_v1(
  p_user_id uuid,
  p_ref     text,
  p_credits integer,
  p_reason  text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_available integer;
  v_rows      integer;
begin
  if p_user_id is null or p_ref is null or trim(p_ref) = '' or p_credits is null or p_credits <= 0 then
    raise exception 'spend_credits_v1: invalid arguments';
  end if;

  -- Uniform Advisory User Lock
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Idempotency Check
  if exists (select 1 from public.credit_ledger where ref = p_ref) then
    return 'duplicate';
  end if;

  -- Lazy cleanup of expired reservations under advisory lock
  perform public.expire_user_reservations_lazy_v1(p_user_id);

  -- Available balance excludes ACTIVE unexpired reservations
  v_available := public.available_credit_balance_v1(p_user_id);
  if v_available < p_credits then
    return 'insufficient';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_user_id, -p_credits, p_reason, p_ref)
  on conflict (ref) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;

  return 'ok';
end;
$$;

-- 5) RPC: claim_starter_story_v1
-- Concurrency-safe via pg_advisory_xact_lock. Authority is starter_claimed_at IS NOT NULL (durable even if story deleted).
-- Checks DB story ownership AND eligible story mode (reader-owned private/unlisted, not demo).
create or replace function public.claim_starter_story_v1(
  p_user_id  uuid,
  p_story_id text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_state            public.account_commercial_states%rowtype;
  v_story_owner      uuid;
  v_story_visibility text;
begin
  if p_user_id is null or p_story_id is null or trim(p_story_id) = '' then
    raise exception 'claim_starter_story_v1: invalid arguments';
  end if;

  -- Shared lock for all user credit & commercial entitlement mutations
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Ownership and story mode verification
  select owner_user_id, visibility into v_story_owner, v_story_visibility
  from public.stories
  where id = p_story_id;

  if not found or v_story_owner is distinct from p_user_id then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NOT_STORY_OWNER'
    );
  end if;

  if v_story_visibility not in ('private', 'unlisted') or p_story_id like 'demo:%' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NOT_ELIGIBLE_STORY_MODE'
    );
  end if;

  -- Ensure row exists
  insert into public.account_commercial_states (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_state
  from public.account_commercial_states
  where user_id = p_user_id
  for update;

  -- Durable starter claim authority is starter_claimed_at IS NOT NULL
  if v_state.starter_claimed_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'STARTER_ALREADY_CLAIMED',
      'starter_story_id', v_state.starter_story_id
    );
  end if;

  update public.account_commercial_states
  set starter_story_id = p_story_id,
      starter_claimed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  update public.stories
  set commercial_origin = 'STARTER_FREE'
  where id = p_story_id;

  return jsonb_build_object(
    'ok', true,
    'starter_story_id', p_story_id
  );
end;
$$;

-- 6) RPC: grant_welcome_credit_v1
-- Server-authoritative exactly-once welcome grant (+20 credits). Validates idempotency conflict.
create or replace function public.grant_welcome_credit_v1(
  p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_state        public.account_commercial_states%rowtype;
  v_ref          text;
  v_granted      boolean;
  v_ledger_row   public.credit_ledger%rowtype;
  c_welcome_amount constant integer := 20;
begin
  if p_user_id is null then
    raise exception 'grant_welcome_credit_v1: invalid arguments';
  end if;

  -- Shared lock for all user credit & commercial entitlement mutations
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  insert into public.account_commercial_states (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_state
  from public.account_commercial_states
  where user_id = p_user_id
  for update;

  if v_state.welcome_credit_granted_at is not null then
    return jsonb_build_object(
      'ok', true,
      'granted', false,
      'already_granted', true
    );
  end if;

  v_ref := 'welcome:' || p_user_id::text;
  v_granted := public.grant_credits_v1(p_user_id, v_ref, c_welcome_amount, 'welcome_grant');

  if not v_granted then
    -- Verify existing ledger row matches exact welcome parameters
    select * into v_ledger_row from public.credit_ledger where ref = v_ref;
    if not found or v_ledger_row.user_id <> p_user_id or v_ledger_row.delta <> c_welcome_amount or v_ledger_row.reason <> 'welcome_grant' then
      raise exception 'IDEMPOTENCY_CONFLICT: welcome credit ref conflict for user %', p_user_id;
    end if;
  else
    select * into v_ledger_row from public.credit_ledger where ref = v_ref;
  end if;

  update public.account_commercial_states
  set welcome_credit_granted_at = clock_timestamp(),
      welcome_credit_event_id = v_ledger_row.id,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'granted', v_granted,
    'already_granted', not v_granted,
    'credits', c_welcome_amount
  );
end;
$$;

-- 7) SECURITY & ACL HARDENING
REVOKE ALL ON FUNCTION public.credit_balance_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_credits_v1(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spend_credits_v1(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_starter_story_v1(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_welcome_credit_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_balance_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits_v1(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credits_v1(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_starter_story_v1(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_welcome_credit_v1(uuid) TO service_role;
