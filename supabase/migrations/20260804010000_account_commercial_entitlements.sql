-- Migration 20260804010000_account_commercial_entitlements.sql
-- Account commercial states, legacy starter account backfill, server-authoritative configurable welcome cutoff,
-- explicit commercial_origin column without unsafe permanent default, pricing_version updates, and strict ACL hardening.

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

-- Explicit deterministic backfill ONLY for pre-existing owned private/unlisted commercial stories (personalized_ai, premium_instance)
update public.stories
set commercial_origin = 'LEGACY_GRANDFATHERED'
where owner_user_id is not null
  and story_mode in ('personalized_ai', 'premium_instance')
  and visibility in ('private', 'unlisted')
  and id not like 'demo:%'
  and commercial_origin is null;

-- Deterministic legacy account backfill for existing users who already own >=1 eligible commercial story
insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at, updated_at)
select distinct on (s.owner_user_id)
  s.owner_user_id,
  s.id as starter_story_id,
  s.created_at as starter_claimed_at,
  clock_timestamp() as updated_at
from public.stories s
where s.owner_user_id is not null
  and s.story_mode in ('personalized_ai', 'premium_instance')
  and s.visibility in ('private', 'unlisted')
  and s.id not like 'demo:%'
order by s.owner_user_id, s.created_at asc, s.id asc
on conflict (user_id) do update set
  starter_story_id = coalesce(account_commercial_states.starter_story_id, excluded.starter_story_id),
  starter_claimed_at = coalesce(account_commercial_states.starter_claimed_at, excluded.starter_claimed_at),
  updated_at = clock_timestamp();

-- 3) Seed/update canonical DB pricing in feature_credit_costs (chapter_unlock = 8, story_start = 24, welcome_credit = 20 with updated pricing_version)
insert into public.feature_credit_costs (feature_key, credits_required, is_active, pricing_version, metadata)
values
  ('chapter_unlock', 8, true, 'v1.1-202608', '{}'::jsonb),
  ('story_start', 24, true, 'v1.1-202608', '{}'::jsonb),
  ('welcome_credit', 20, true, 'v1.1-202608', jsonb_build_object('welcome_eligible_from', '2026-08-04T00:00:00+00'))
on conflict (feature_key) do update
set credits_required = excluded.credits_required,
    pricing_version = excluded.pricing_version,
    is_active = true,
    metadata = case when excluded.metadata <> '{}'::jsonb then excluded.metadata else feature_credit_costs.metadata end,
    updated_at = clock_timestamp();

-- 4) RPC: claim_starter_story_v1
-- Concurrency-safe via pg_advisory_xact_lock. Authority is starter_claimed_at IS NOT NULL.
-- Checks DB story ownership, story_mode (personalized_ai, premium_instance), and visibility.
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
  v_story_mode       text;
begin
  if p_user_id is null or p_story_id is null or trim(p_story_id) = '' then
    raise exception 'claim_starter_story_v1: invalid arguments';
  end if;

  -- Shared lock for all user credit & commercial entitlement mutations
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Ownership and canonical story_mode verification
  select owner_user_id, visibility, story_mode into v_story_owner, v_story_visibility, v_story_mode
  from public.stories
  where id = p_story_id;

  if not found or v_story_owner is distinct from p_user_id then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NOT_STORY_OWNER'
    );
  end if;

  if v_story_mode not in ('personalized_ai', 'premium_instance') or v_story_visibility not in ('private', 'unlisted') or p_story_id like 'demo:%' then
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

-- 5) RPC: grant_welcome_credit_v1
-- Server-authoritative welcome bonus (+20 credits).
-- Reads configurable welcome cutoff from feature_credit_costs (welcome_credit -> metadata -> welcome_eligible_from).
-- Fail-closed: returns WELCOME_POLICY_NOT_ACTIVE / WELCOME_POLICY_NOT_CONFIGURED if unconfigured.
create or replace function public.grant_welcome_credit_v1(
  p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cost_row        public.feature_credit_costs%rowtype;
  v_cutoff_str      text;
  v_welcome_cutoff  timestamptz;
  v_user_created_at timestamptz;
  v_state           public.account_commercial_states%rowtype;
  v_ref             text;
  v_granted         boolean;
  v_ledger_row      public.credit_ledger%rowtype;
  c_welcome_amount  constant integer := 20;
begin
  if p_user_id is null then
    raise exception 'grant_welcome_credit_v1: invalid arguments';
  end if;

  -- Uniform lock for user credit & commercial entitlement mutations
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Query configurable welcome credit setting from feature_credit_costs
  select * into v_cost_row
  from public.feature_credit_costs
  where feature_key = 'welcome_credit' and is_active = true;

  if not found or v_cost_row.credits_required <= 0 then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'WELCOME_POLICY_NOT_ACTIVE'
    );
  end if;

  v_cutoff_str := v_cost_row.metadata->>'welcome_eligible_from';
  if v_cutoff_str is null or trim(v_cutoff_str) = '' then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'WELCOME_POLICY_NOT_CONFIGURED'
    );
  end if;

  v_welcome_cutoff := v_cutoff_str::timestamptz;

  select created_at into v_user_created_at from auth.users where id = p_user_id;
  if not found then
    raise exception 'grant_welcome_credit_v1: user % not found', p_user_id;
  end if;

  if v_user_created_at < v_welcome_cutoff then
    return jsonb_build_object(
      'ok', false,
      'granted', false,
      'reason', 'NOT_ELIGIBLE_ACCOUNT_CREATED_BEFORE_WELCOME_CUTOFF'
    );
  end if;

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

-- 6) SECURITY & ACL HARDENING
REVOKE ALL ON FUNCTION public.claim_starter_story_v1(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_welcome_credit_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_starter_story_v1(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_welcome_credit_v1(uuid) TO service_role;
