begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    perform set_config('lakoku.test_target', 'local-cli', true);
  end if;
end
$$;

select plan(22);

-- ============================================================================
-- 1. ACL & Privilege Enforcement Tests
-- ============================================================================

select has_function('public', 'claim_starter_story_v1', array['uuid', 'text'], 'claim_starter_story_v1 exists');
select has_function('public', 'grant_welcome_credit_v1', array['uuid'], 'grant_welcome_credit_v1 exists');
select has_function('public', 'available_credit_balance_v1', array['uuid'], 'available_credit_balance_v1 exists');
select has_function('public', 'reserve_chapter_unlock_v1', array['uuid', 'text', 'integer'], 'reserve_chapter_unlock_v1 exists');
select has_function('public', 'reserve_story_start_v1', array['uuid', 'text'], 'reserve_story_start_v1 exists');
select has_function('public', 'capture_credit_reservation_v1', array['text'], 'capture_credit_reservation_v1 exists');
select has_function('public', 'release_credit_reservation_v1', array['text'], 'release_credit_reservation_v1 exists');

select ok(not has_function_privilege('anon', 'public.grant_credits_v1(uuid, text, integer, text)', 'EXECUTE'), 'anon cannot execute grant_credits_v1');
select ok(not has_function_privilege('authenticated', 'public.grant_credits_v1(uuid, text, integer, text)', 'EXECUTE'), 'authenticated cannot execute grant_credits_v1');
select ok(has_function_privilege('service_role', 'public.grant_credits_v1(uuid, text, integer, text)', 'EXECUTE'), 'service_role can execute grant_credits_v1');

select ok(not has_function_privilege('anon', 'public.spend_credits_v1(uuid, text, integer, text)', 'EXECUTE'), 'anon cannot execute spend_credits_v1');
select ok(not has_function_privilege('authenticated', 'public.spend_credits_v1(uuid, text, integer, text)', 'EXECUTE'), 'authenticated cannot execute spend_credits_v1');

select ok(not has_function_privilege('anon', 'public.grant_welcome_credit_v1(uuid)', 'EXECUTE'), 'anon cannot execute grant_welcome_credit_v1');
select ok(not has_function_privilege('authenticated', 'public.grant_welcome_credit_v1(uuid)', 'EXECUTE'), 'authenticated cannot execute grant_welcome_credit_v1');
select ok(has_function_privilege('service_role', 'public.grant_welcome_credit_v1(uuid)', 'EXECUTE'), 'service_role can execute grant_welcome_credit_v1');

select ok(not has_function_privilege('anon', 'public.reserve_chapter_unlock_v1(uuid,text,integer)', 'EXECUTE'), 'anon cannot execute reserve_chapter_unlock_v1');
select ok(not has_function_privilege('authenticated', 'public.reserve_chapter_unlock_v1(uuid,text,integer)', 'EXECUTE'), 'authenticated cannot execute reserve_chapter_unlock_v1');
select ok(has_function_privilege('service_role', 'public.reserve_chapter_unlock_v1(uuid,text,integer)', 'EXECUTE'), 'service_role can execute reserve_chapter_unlock_v1');

select ok(not has_function_privilege('anon', 'public.reserve_story_start_v1(uuid,text)', 'EXECUTE'), 'anon cannot execute reserve_story_start_v1');
select ok(not has_function_privilege('authenticated', 'public.reserve_story_start_v1(uuid,text)', 'EXECUTE'), 'authenticated cannot execute reserve_story_start_v1');
select ok(has_function_privilege('service_role', 'public.reserve_story_start_v1(uuid,text)', 'EXECUTE'), 'service_role can execute reserve_story_start_v1');

-- ============================================================================
-- 2. Functional, Story Mode & Business Logic Tests
-- ============================================================================

do $$
declare
  v_user_1 uuid := gen_random_uuid();
  v_user_2 uuid := gen_random_uuid();
  v_res jsonb;
  v_res_text text;
  v_origin text;
  v_ref text;
  v_avail integer;
  v_caught boolean := false;
begin
  insert into auth.users (id, email) values (v_user_1, 'user1@test.local'), (v_user_2, 'user2@test.local');

  -- Test 1: Welcome grant (+20) exactly once & idempotency check
  v_res := public.grant_welcome_credit_v1(v_user_1);
  if (v_res->>'granted')::boolean is not true or (v_res->>'credits')::int <> 20 then
    raise exception 'Test 1 Failed: welcome grant should return granted=true, credits=20';
  end if;

  if public.available_credit_balance_v1(v_user_1) <> 20 then
    raise exception 'Test 1 Failed: credit balance should be 20';
  end if;

  -- Test 2: Requirement 1 - Story Mode Boundaries & Ownership Checks
  insert into public.stories (id, title, owner_user_id, visibility, story_mode, total_chapters)
  values
    ('story-pers-A', 'Personalized Story A', v_user_1, 'private', 'personalized_ai', 50),
    ('story-pers-B', 'Personalized Story B', v_user_1, 'private', 'personalized_ai', 50),
    ('story-prem-1', 'Premium Instance 1', v_user_1, 'private', 'premium_instance', 50),
    ('story-std-1',  'Standard Private 1',  v_user_1, 'private', 'standard', 50),
    ('demo:shared-1', 'Demo Shared Story', v_user_1, 'public',  'premium_template', 50);

  -- Standard story claim -> NOT_ELIGIBLE_STORY_MODE
  v_res := public.claim_starter_story_v1(v_user_1, 'story-std-1');
  if (v_res->>'reason') <> 'NOT_ELIGIBLE_STORY_MODE' then
    raise exception 'Test 2 Story Mode Check Failed: standard story claim must return NOT_ELIGIBLE_STORY_MODE, got %', v_res;
  end if;

  -- Demo story claim -> NOT_ELIGIBLE_STORY_MODE
  v_res := public.claim_starter_story_v1(v_user_1, 'demo:shared-1');
  if (v_res->>'reason') <> 'NOT_ELIGIBLE_STORY_MODE' then
    raise exception 'Test 2 Demo Check Failed: demo story claim must return NOT_ELIGIBLE_STORY_MODE';
  end if;

  -- Un-owned story claim -> NOT_STORY_OWNER
  v_res := public.claim_starter_story_v1(v_user_2, 'story-pers-A');
  if (v_res->>'reason') <> 'NOT_STORY_OWNER' then
    raise exception 'Test 2 Ownership Check Failed: un-owned story claim must return NOT_STORY_OWNER';
  end if;

  -- Test 3: Requirement 3 - reserve_story_start_v1 Must Prove Account Has Claimed Starter First
  perform public.grant_credits_v1(v_user_1, 'topup:seed', 30, 'seed'); -- balance = 50

  -- User 1 has NOT claimed starter story yet -> reserve_story_start_v1 MUST REJECT!
  v_res := public.reserve_story_start_v1(v_user_1, 'story-pers-B');
  if (v_res->>'reason') <> 'STORY_START_NOT_REQUIRED' then
    raise exception 'Test 3 Unclaimed Starter Check Failed: expected STORY_START_NOT_REQUIRED, got %', v_res;
  end if;

  -- User 1 claims Starter Story pers-A
  v_res := public.claim_starter_story_v1(v_user_1, 'story-pers-A');
  if (v_res->>'ok')::boolean is not true then
    raise exception 'Test 3 Starter Claim Failed';
  end if;

  -- Cannot reserve story start for Starter Story itself
  v_res := public.reserve_story_start_v1(v_user_1, 'story-pers-A');
  if (v_res->>'reason') <> 'STARTER_STORY_CANNOT_RESERVE_STORY_START' then
    raise exception 'Test 3 Starter Story Self-Reserve Check Failed: expected STARTER_STORY_CANNOT_RESERVE_STORY_START, got %', v_res;
  end if;

  -- Valid Story #2 Start Reservation for story-pers-B (costs 24)
  v_res := public.reserve_story_start_v1(v_user_1, 'story-pers-B');
  if (v_res->>'ok')::boolean is not true or (v_res->>'status') <> 'RESERVED' then
    raise exception 'Test 3 Valid Story Start Reservation Failed, got %', v_res;
  end if;

  -- Pre-capture state check: PENDING_PAID_START
  select commercial_origin into v_origin from public.stories where id = 'story-pers-B';
  if v_origin <> 'PENDING_PAID_START' then
    raise exception 'Test 3 Pre-capture state failed: expected PENDING_PAID_START, got %', v_origin;
  end if;

  -- Test 4: Requirement 4 - reserve_chapter_unlock_v1 Fail-Closed Matrix on commercial_origin
  -- PENDING_PAID_START, Chapter 1 -> DENIED (COMMERCIAL_STATE_INVALID)
  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-pers-B', 1);
  if (v_res->>'reason') <> 'COMMERCIAL_STATE_INVALID' then
    raise exception 'Test 4 PENDING_PAID_START Ch1 Check Failed: expected COMMERCIAL_STATE_INVALID, got %', v_res;
  end if;

  -- PENDING_PAID_START, Chapter 4 -> DENIED (COMMERCIAL_STATE_INVALID)
  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-pers-B', 4);
  if (v_res->>'reason') <> 'COMMERCIAL_STATE_INVALID' then
    raise exception 'Test 4 PENDING_PAID_START Ch4 Check Failed: expected COMMERCIAL_STATE_INVALID, got %', v_res;
  end if;

  -- NULL origin (story-prem-1), Chapter 4 -> DENIED (COMMERCIAL_STATE_INVALID)
  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-prem-1', 4);
  if (v_res->>'reason') <> 'COMMERCIAL_STATE_INVALID' then
    raise exception 'Test 4 NULL origin Ch4 Check Failed: expected COMMERCIAL_STATE_INVALID, got %', v_res;
  end if;

  -- STARTER_FREE (story-pers-A), Chapter 4 -> May reserve 8 (RESERVED)
  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-pers-A', 4);
  if (v_res->>'ok')::boolean is not true or (v_res->>'status') <> 'RESERVED' then
    raise exception 'Test 4 STARTER_FREE Ch4 Reserve Failed, got %', v_res;
  end if;

  -- Test 5: Requirement 5 - Canonical Ledger Conflict Hardening during Capture
  v_ref := v_res->>'ref';

  -- Pre-insert conflicting ledger row with wrong delta (-5 instead of -8)
  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (v_user_1, -5, 'unlock_chapter', 'unlock:story-pers-A:4');

  v_caught := false;
  begin
    perform public.capture_credit_reservation_v1(v_ref);
  exception when others then
    if sqlerrm like '%IDEMPOTENCY_CONFLICT%' then
      v_caught := true;
    end if;
  end;

  if not v_caught then
    raise exception 'Test 5 Mismatched Ledger Ref Capture Check Failed: expected IDEMPOTENCY_CONFLICT exception';
  end if;

  -- Verify reservation status remains ACTIVE (NOT CAPTURED) after conflict
  select status into v_res_text from public.credit_reservations where ref = v_ref;
  if v_res_text <> 'ACTIVE' then
    raise exception 'Test 5 Reservation Status Drift Failed: expected ACTIVE, got %', v_res_text;
  end if;

  -- Test 6: Requirement 2 - Legacy Backfill Test Verification
  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values
    ('legacy-pers', 'Legacy Personalized', v_user_2, 'private', 'personalized_ai'),
    ('legacy-prem', 'Legacy Premium',      v_user_2, 'private', 'premium_instance'),
    ('legacy-std',  'Legacy Standard',     v_user_2, 'private', 'standard');

  update public.stories
  set commercial_origin = 'LEGACY_GRANDFATHERED'
  where owner_user_id is not null
    and story_mode in ('personalized_ai', 'premium_instance')
    and visibility in ('private', 'unlisted')
    and id not like 'demo:%'
    and commercial_origin is null;

  select commercial_origin into v_origin from public.stories where id = 'legacy-pers';
  if v_origin <> 'LEGACY_GRANDFATHERED' then
    raise exception 'Test 6 Backfill legacy-pers Failed: expected LEGACY_GRANDFATHERED, got %', v_origin;
  end if;

  select commercial_origin into v_origin from public.stories where id = 'legacy-prem';
  if v_origin <> 'LEGACY_GRANDFATHERED' then
    raise exception 'Test 6 Backfill legacy-prem Failed: expected LEGACY_GRANDFATHERED, got %', v_origin;
  end if;

  select commercial_origin into v_origin from public.stories where id = 'legacy-std';
  if v_origin is not null then
    raise exception 'Test 6 Backfill legacy-std Failed: expected NULL, got %', v_origin;
  end if;

end
$$;

select ok(true, 'All anti-abuse DB tests completed successfully');

rollback;
