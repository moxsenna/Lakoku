-- Migration 20260804020000_credit_reservations.sql
-- Credit reservation primitives, fail-closed DB price derivation, server-owned TTL,
-- DB ownership & canonical story_mode enforcement, commercial_origin state matrix enforcement,
-- uniform lock ordering (deadlock-free), EXPIRED reservation re-activation semantics,
-- hardened financial capture (Phase 1: CHAPTER_UNLOCK only with fail-closed ledger conflict check), and ACL hardening.

-- 1) Table credit_reservations
create table if not exists public.credit_reservations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  story_id         text not null,
  chapter_number   integer null,
  reservation_kind text not null check (reservation_kind in ('CHAPTER_UNLOCK', 'STORY_START')),
  amount           integer not null check (amount > 0),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED')),
  ref              text not null unique,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  updated_at       timestamptz not null default now()
);

create index if not exists credit_reservations_user_active_idx
  on public.credit_reservations (user_id, status)
  where status = 'ACTIVE';

-- Logical uniqueness constraint: prevent duplicate ACTIVE reservations for same user/story/chapter
create unique index if not exists credit_reservations_chapter_active_uniq_idx
  on public.credit_reservations (user_id, story_id, chapter_number, reservation_kind)
  where status = 'ACTIVE' and reservation_kind = 'CHAPTER_UNLOCK';

create unique index if not exists credit_reservations_story_start_active_uniq_idx
  on public.credit_reservations (user_id, story_id, reservation_kind)
  where status = 'ACTIVE' and reservation_kind = 'STORY_START';

-- Enable RLS and DO NOT add policies for anon/authenticated (strictly service_role only)
alter table public.credit_reservations enable row level security;

-- 2) RPC: available_credit_balance_v1
-- Ledger balance minus sum of ACTIVE, UNEXPIRED reservations.
create or replace function public.available_credit_balance_v1(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select sum(delta) from public.credit_ledger where user_id = p_user_id),
    0
  )::int - coalesce(
    (select sum(amount) from public.credit_reservations
     where user_id = p_user_id
       and status = 'ACTIVE'
       and expires_at > clock_timestamp()),
    0
  )::int;
$$;

-- Internal Helper: Lazy expiry for past-due active reservations under uniform user advisory lock
create or replace function public.expire_user_reservations_lazy_v1(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  -- Uniform Advisory User Lock
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  update public.credit_reservations
  set status = 'EXPIRED',
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and status = 'ACTIVE'
    and expires_at <= clock_timestamp();
end;
$$;

-- 3) RPC: reserve_chapter_unlock_v1
-- Reserve credits for chapter unlock. Checks DB ownership & canonical story_mode, paid chapter status, existing unlocks.
-- Fail-closed commercial_origin matrix: DENIES if commercial_origin IS NULL or PENDING_PAID_START.
-- Fail-closed DB price lookup. Handles re-activation of EXPIRED reservation for exact same chapter under user lock.
create or replace function public.reserve_chapter_unlock_v1(
  p_user_id        uuid,
  p_story_id       text,
  p_chapter_number integer
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cost              integer;
  v_available         integer;
  v_canonical_ref     text;
  v_existing          public.credit_reservations%rowtype;
  v_story_owner       uuid;
  v_story_visibility  text;
  v_story_mode        text;
  v_origin            text;
  v_unlock_ledger_ref text;
  c_ttl_seconds       constant integer := 1800; -- 30 minutes workflow budget safety reserve
begin
  if p_user_id is null or p_story_id is null or p_chapter_number is null or p_chapter_number < 1 then
    raise exception 'reserve_chapter_unlock_v1: invalid arguments';
  end if;

  -- Uniform Advisory User Lock FIRST (prevents deadlocks)
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Ownership, story_mode, and visibility verification
  select owner_user_id, visibility, story_mode, commercial_origin
  into v_story_owner, v_story_visibility, v_story_mode, v_origin
  from public.stories
  where id = p_story_id;

  if not found or v_story_owner is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STORY_OWNER');
  end if;

  if v_story_mode not in ('personalized_ai', 'premium_instance') or v_story_visibility not in ('private', 'unlisted') or p_story_id like 'demo:%' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE_STORY_MODE');
  end if;

  -- Requirement 4: Explicit commercial_origin state matrix check for chapter unlock
  if v_origin is null or v_origin = 'PENDING_PAID_START' then
    return jsonb_build_object('ok', false, 'reason', 'COMMERCIAL_STATE_INVALID', 'commercial_origin', v_origin);
  end if;

  if v_origin not in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED', 'ADMIN_GRANTED') then
    return jsonb_build_object('ok', false, 'reason', 'COMMERCIAL_STATE_INVALID', 'commercial_origin', v_origin);
  end if;

  -- Check if chapter is a free starter/included chapter (Chapters 1-3)
  if p_chapter_number <= 3 then
    return jsonb_build_object('ok', false, 'reason', 'CHAPTER_ALREADY_FREE');
  end if;

  -- Check if chapter is already unlocked in ledger
  v_unlock_ledger_ref := 'unlock:' || p_story_id || ':' || p_chapter_number::text;
  if exists (select 1 from public.credit_ledger where ref = v_unlock_ledger_ref) then
    return jsonb_build_object('ok', true, 'status', 'ALREADY_UNLOCKED', 'ref', v_unlock_ledger_ref);
  end if;

  -- Fail-closed DB price lookup from feature_credit_costs (NO SILENT DB FALLBACK)
  select credits_required into v_cost
  from public.feature_credit_costs
  where feature_key = 'chapter_unlock' and is_active = true;

  if not found or v_cost is null or v_cost <= 0 then
    raise exception 'CONFIG_ERROR: missing canonical active price for chapter_unlock';
  end if;

  -- Canonical operation key generated by DB
  v_canonical_ref := 'chapter-reservation:' || p_user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;

  perform public.expire_user_reservations_lazy_v1(p_user_id);

  select * into v_existing from public.credit_reservations where ref = v_canonical_ref for update;

  if found then
    if v_existing.status = 'ACTIVE' and v_existing.expires_at > clock_timestamp() then
      return jsonb_build_object('ok', true, 'status', 'RESERVED', 'ref', v_canonical_ref, 'replayed', true);
    end if;
    if v_existing.status = 'CAPTURED' then
      return jsonb_build_object('ok', true, 'status', 'ALREADY_CAPTURED', 'ref', v_canonical_ref);
    end if;
  end if;

  v_available := public.available_credit_balance_v1(p_user_id);
  if v_available < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS', 'available', v_available, 'required', v_cost);
  end if;

  insert into public.credit_reservations (
    user_id, story_id, chapter_number, reservation_kind, amount, status, ref, expires_at
  ) values (
    p_user_id, p_story_id, p_chapter_number, 'CHAPTER_UNLOCK', v_cost, 'ACTIVE', v_canonical_ref,
    clock_timestamp() + (c_ttl_seconds * interval '1 second')
  ) on conflict (ref) do update set
    status = 'ACTIVE',
    amount = v_cost,
    expires_at = clock_timestamp() + (c_ttl_seconds * interval '1 second'),
    updated_at = clock_timestamp();

  return jsonb_build_object('ok', true, 'status', 'RESERVED', 'ref', v_canonical_ref, 'cost', v_cost, 'reactivated', found);
end;
$$;

-- 4) RPC: reserve_story_start_v1
-- Reserve 24 credits for story start (#2+).
-- Checks DB ownership, canonical story_mode (personalized_ai, premium_instance), and visibility.
-- Requirement 3: Proves lifetime starter entitlement has ALREADY been claimed by account, and story is NOT starter story.
-- Checks current commercial_origin pre-state (allowed: NULL or exact same reservation replay).
create or replace function public.reserve_story_start_v1(
  p_user_id  uuid,
  p_story_id text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cost             integer;
  v_available        integer;
  v_canonical_ref    text;
  v_existing         public.credit_reservations%rowtype;
  v_story_owner      uuid;
  v_story_visibility text;
  v_story_mode       text;
  v_origin           text;
  v_state            public.account_commercial_states%rowtype;
  c_ttl_seconds      constant integer := 1800;
begin
  if p_user_id is null or p_story_id is null then
    raise exception 'reserve_story_start_v1: invalid arguments';
  end if;

  -- Uniform Advisory User Lock FIRST (prevents deadlocks)
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Ownership, story_mode, and visibility verification
  select owner_user_id, visibility, story_mode, commercial_origin
  into v_story_owner, v_story_visibility, v_story_mode, v_origin
  from public.stories
  where id = p_story_id;

  if not found or v_story_owner is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STORY_OWNER');
  end if;

  if v_story_mode not in ('personalized_ai', 'premium_instance') or v_story_visibility not in ('private', 'unlisted') or p_story_id like 'demo:%' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE_STORY_MODE');
  end if;

  -- Requirement 3: Account Must Have Claimed Starter Story First
  select * into v_state from public.account_commercial_states where user_id = p_user_id for update;
  if not found or v_state.starter_claimed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'STORY_START_NOT_REQUIRED', 'detail', 'FIRST_STORY_MUST_USE_STARTER_FLOW');
  end if;

  if v_state.starter_story_id = p_story_id then
    return jsonb_build_object('ok', false, 'reason', 'STARTER_STORY_CANNOT_RESERVE_STORY_START');
  end if;

  -- Requirement 3: Check commercial_origin pre-state
  if v_origin in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED', 'ADMIN_GRANTED') then
    return jsonb_build_object('ok', false, 'reason', 'COMMERCIAL_ORIGIN_ALREADY_COMMITTED', 'commercial_origin', v_origin);
  end if;

  -- Fail-closed DB price lookup from feature_credit_costs (NO SILENT DB FALLBACK)
  select credits_required into v_cost
  from public.feature_credit_costs
  where feature_key = 'story_start' and is_active = true;

  if not found or v_cost is null or v_cost <= 0 then
    raise exception 'CONFIG_ERROR: missing canonical active price for story_start';
  end if;

  -- Canonical operation key generated by DB
  v_canonical_ref := 'story-start:' || p_user_id::text || ':' || p_story_id;

  perform public.expire_user_reservations_lazy_v1(p_user_id);

  select * into v_existing from public.credit_reservations where ref = v_canonical_ref for update;

  if found then
    if v_existing.status = 'ACTIVE' and v_existing.expires_at > clock_timestamp() then
      return jsonb_build_object('ok', true, 'status', 'RESERVED', 'ref', v_canonical_ref, 'replayed', true);
    end if;
    if v_existing.status = 'CAPTURED' then
      return jsonb_build_object('ok', true, 'status', 'ALREADY_CAPTURED', 'ref', v_canonical_ref);
    end if;
  end if;

  v_available := public.available_credit_balance_v1(p_user_id);
  if v_available < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS', 'available', v_available, 'required', v_cost);
  end if;

  insert into public.credit_reservations (
    user_id, story_id, chapter_number, reservation_kind, amount, status, ref, expires_at
  ) values (
    p_user_id, p_story_id, 1, 'STORY_START', v_cost, 'ACTIVE', v_canonical_ref,
    clock_timestamp() + (c_ttl_seconds * interval '1 second')
  ) on conflict (ref) do update set
    status = 'ACTIVE',
    amount = v_cost,
    expires_at = clock_timestamp() + (c_ttl_seconds * interval '1 second'),
    updated_at = clock_timestamp();

  -- Set pre-capture pending state on story
  update public.stories
  set commercial_origin = 'PENDING_PAID_START'
  where id = p_story_id and (commercial_origin is null or commercial_origin = 'PENDING_PAID_START');

  return jsonb_build_object('ok', true, 'status', 'RESERVED', 'ref', v_canonical_ref, 'cost', v_cost, 'reactivated', found);
end;
$$;

-- 5) RPC: capture_credit_reservation_v1
-- Phase 1: FINANCIAL PRIMITIVE FOR CHAPTER_UNLOCK ONLY.
-- Generic capture MUST NOT capture STORY_START (returns 'requires_story_finalize').
-- Requirement 5 Hardening: Validates existing canonical ledger ref. If exact match -> idempotent success.
-- If mismatch -> raises IDEMPOTENCY_CONFLICT exception and DO NOT mark reservation CAPTURED.
create or replace function public.capture_credit_reservation_v1(
  p_ref text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_res           public.credit_reservations%rowtype;
  v_ledger_row    public.credit_ledger%rowtype;
  v_canonical_ref text;
  v_reason        text;
begin
  if p_ref is null or trim(p_ref) = '' then
    raise exception 'capture_credit_reservation_v1: invalid arguments';
  end if;

  -- 1. Resolve target user_id without mutable row lock
  select * into v_res from public.credit_reservations where ref = p_ref;

  if not found then
    return 'not_found';
  end if;

  -- Generic capture MUST NOT capture STORY_START
  if v_res.reservation_kind = 'STORY_START' then
    return 'requires_story_finalize';
  end if;

  -- 2. Acquire Advisory User Lock FIRST (prevents deadlocks)
  perform pg_advisory_xact_lock(hashtext(v_res.user_id::text));

  -- 3. Lock reservation row FOR UPDATE
  select * into v_res from public.credit_reservations where id = v_res.id for update;

  if v_res.status = 'CAPTURED' then
    return 'duplicate';
  end if;

  if v_res.status = 'EXPIRED' or v_res.expires_at <= clock_timestamp() then
    update public.credit_reservations set status = 'EXPIRED', updated_at = clock_timestamp() where id = v_res.id;
    return 'expired';
  end if;

  if v_res.status <> 'ACTIVE' then
    return 'not_active';
  end if;

  -- Canonical debit ref mapping
  v_canonical_ref := 'unlock:' || v_res.story_id || ':' || coalesce(v_res.chapter_number::text, '1');
  v_reason := 'unlock_chapter';

  -- Requirement 5: Fail-closed canonical ledger conflict validation
  select * into v_ledger_row from public.credit_ledger where ref = v_canonical_ref;
  if found then
    if v_ledger_row.user_id = v_res.user_id and v_ledger_row.delta = -v_res.amount and v_ledger_row.reason = v_reason then
      -- Idempotent valid replay
      update public.credit_reservations set status = 'CAPTURED', updated_at = clock_timestamp() where id = v_res.id;
      return 'duplicate';
    else
      raise exception 'IDEMPOTENCY_CONFLICT: canonical ledger ref % mismatched existing entry', v_canonical_ref;
    end if;
  end if;

  -- Direct write to credit_ledger
  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (v_res.user_id, -v_res.amount, v_reason, v_canonical_ref);

  update public.credit_reservations
  set status = 'CAPTURED',
      updated_at = clock_timestamp()
  where id = v_res.id;

  return 'ok';
end;
$$;

-- 6) RPC: release_credit_reservation_v1
create or replace function public.release_credit_reservation_v1(
  p_ref text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_res public.credit_reservations%rowtype;
begin
  if p_ref is null or trim(p_ref) = '' then
    raise exception 'release_credit_reservation_v1: invalid arguments';
  end if;

  -- 1. Resolve target user_id without mutable row lock
  select * into v_res from public.credit_reservations where ref = p_ref;

  if not found then
    return 'not_found';
  end if;

  -- 2. Acquire Advisory User Lock FIRST (prevents deadlocks)
  perform pg_advisory_xact_lock(hashtext(v_res.user_id::text));

  -- 3. Lock reservation row FOR UPDATE
  select * into v_res from public.credit_reservations where id = v_res.id for update;

  if v_res.status = 'RELEASED' then
    return 'duplicate';
  end if;

  if v_res.status <> 'ACTIVE' then
    return 'not_active';
  end if;

  update public.credit_reservations
  set status = 'RELEASED',
      updated_at = clock_timestamp()
  where id = v_res.id;

  return 'ok';
end;
$$;

-- 7) SECURITY & ACL HARDENING
REVOKE ALL ON FUNCTION public.available_credit_balance_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_user_reservations_lazy_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_chapter_unlock_v1(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_story_start_v1(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_credit_reservation_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_credit_reservation_v1(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.available_credit_balance_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_chapter_unlock_v1(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_story_start_v1(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_credit_reservation_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation_v1(text) TO service_role;
