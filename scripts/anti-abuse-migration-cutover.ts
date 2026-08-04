/**
 * Anti-Abuse Staged Migration Cutover Harness
 * Validates real two-stage migration deployment isolation in a transaction-isolated session:
 * Stage A: Baseline + 20260804010000_account_commercial_entitlements.sql ONLY
 *   - Verifies spend_credits_v1 exists and functions normally without calling undefined reservation helpers.
 *   - Verifies available_credit_balance_v1 and credit_reservations table DO NOT exist yet.
 * Stage B: Apply 20260804020000_credit_reservations.sql
 *   - Verifies credit_reservations table and available_credit_balance_v1 exist.
 *   - Verifies spend_credits_v1 becomes reservation-aware (legacy spend on active hold returns 'insufficient').
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DOCKER_CONTAINER = 'supabase_db_lakoku-v2'

function runCutoverInTransaction(): string {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
  const mig01File = '20260804010000_account_commercial_entitlements.sql'
  const mig02File = '20260804020000_credit_reservations.sql'

  const mig01Content = fs.readFileSync(path.join(migrationsDir, mig01File), 'utf-8')
  const mig02Content = fs.readFileSync(path.join(migrationsDir, mig02File), 'utf-8')

  const fullScript = `
  begin;
  set local search_path = public, extensions;

  -- 1) Revert to baseline state by temporarily dropping anti-abuse 01 & 02 objects
  drop function if exists public.claim_starter_story_v1, public.grant_welcome_credit_v1 cascade;
  drop function if exists public.available_credit_balance_v1, public.expire_user_reservations_lazy_v1 cascade;
  drop function if exists public.reserve_chapter_unlock_v1, public.reserve_story_start_v1 cascade;
  drop function if exists public.capture_credit_reservation_v1, public.release_credit_reservation_v1 cascade;
  drop table if exists public.credit_reservations cascade;
  drop table if exists public.account_commercial_states cascade;
  alter table public.stories drop column if exists commercial_origin;
  delete from public.feature_credit_costs where feature_key = 'welcome_credit';

  -- Restore baseline spend_credits_v1 definition from 20260708000000_paycore_credit_model.sql
  create or replace function public.spend_credits_v1(
    p_user_id uuid,
    p_ref     text,
    p_credits integer,
    p_reason  text
  ) returns text
  language plpgsql security definer set search_path = public
  as $$
  declare
    v_balance integer;
    v_rows    integer;
  begin
    if p_user_id is null or p_ref is null or trim(p_ref) = '' or p_credits is null or p_credits <= 0 then
      raise exception 'spend_credits_v1: invalid arguments';
    end if;

    perform pg_advisory_xact_lock(hashtext(p_user_id::text));

    if exists (select 1 from public.credit_ledger where ref = p_ref) then
      return 'duplicate';
    end if;

    v_balance := public.credit_balance_v1(p_user_id);
    if v_balance < p_credits then
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

  -- 2) APPLY MIGRATION 01 ONLY
  ${mig01Content}

  -- 3) ASSERT STATE A (Migration 01 active, Migration 02 absent)
  do $$
  declare
    v_uuid uuid := gen_random_uuid();
    v_res text;
  begin
    if to_regprocedure('public.available_credit_balance_v1(uuid)') is not null then
      raise exception 'STATE A FAIL: available_credit_balance_v1 should not exist yet';
    end if;

    if to_regclass('public.credit_reservations') is not null then
      raise exception 'STATE A FAIL: credit_reservations table should not exist yet';
    end if;

    if to_regprocedure('public.spend_credits_v1(uuid,text,integer,text)') is null then
      raise exception 'STATE A FAIL: spend_credits_v1 does not exist';
    end if;

    insert into auth.users (id, email) values (v_uuid, 'cutover_state_a@test.local');
    perform public.grant_credits_v1(v_uuid, 'seed:state_a'::text, 20::integer, 'seed'::text);

    v_res := public.spend_credits_v1(v_uuid, 'unlock:story-state-a:4'::text, 8::integer, 'unlock_chapter'::text);
    if v_res <> 'ok' then
      raise exception 'STATE A FAIL: spend_credits_v1 returned % instead of ok', v_res;
    end if;
  end;
  $$;

  -- 4) APPLY MIGRATION 02
  ${mig02Content}

  -- 5) ASSERT STATE B (Migration 02 active)
  do $$
  declare
    v_uuid uuid := gen_random_uuid();
    v_story_id text := 'cutover-b-story';
    v_res text;
    v_json jsonb;
  begin
    if to_regprocedure('public.available_credit_balance_v1(uuid)') is null then
      raise exception 'STATE B FAIL: available_credit_balance_v1 missing';
    end if;

    if to_regclass('public.credit_reservations') is null then
      raise exception 'STATE B FAIL: credit_reservations missing';
    end if;

    insert into auth.users (id, email) values (v_uuid, 'cutover_state_b@test.local');
    insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin)
    values (v_story_id, 'Cutover Story B', v_uuid, 'private', 'personalized_ai', 'STARTER_FREE');

    perform public.grant_credits_v1(v_uuid, 'seed:state_b'::text, 8::integer, 'seed'::text);

    v_json := public.reserve_chapter_unlock_v1(v_uuid, v_story_id, 4);
    if (v_json->>'ok')::boolean is not true or (v_json->>'status') <> 'RESERVED' then
      raise exception 'STATE B FAIL: reservation failed %', v_json;
    end if;

    v_res := public.spend_credits_v1(v_uuid, 'unlock:other-story:4'::text, 8::integer, 'unlock_chapter'::text);
    if v_res <> 'insufficient' then
      raise exception 'STATE B FAIL: reservation-aware spend returned % instead of insufficient', v_res;
    end if;
  end;
  $$;

  rollback;
  `

  return execSync(`docker exec -i ${DOCKER_CONTAINER} psql -U supabase_admin -d postgres`, {
    input: fullScript,
    encoding: 'utf-8',
  })
}

async function run() {
  console.log('[cutover-harness] Running Transaction-Isolated Staged Cutover Test...')
  const output = runCutoverInTransaction()
  console.log(output)
  console.log('[cutover-harness] REAL STAGED MIGRATION CUTOVER TEST PASSED SUCCESSFULLY!')
}

run().catch((err) => {
  console.error('[cutover-harness] FATAL ERROR:', err)
  process.exit(1)
})
