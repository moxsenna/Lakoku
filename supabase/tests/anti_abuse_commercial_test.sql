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

select ok(not has_function_privilege('anon', 'public.grant_credits_v1(uuid,text,integer,text)', 'EXECUTE'), 'anon cannot execute grant_credits_v1');
select ok(not has_function_privilege('authenticated', 'public.grant_credits_v1(uuid,text,integer,text)', 'EXECUTE'), 'authenticated cannot execute grant_credits_v1');
select ok(has_function_privilege('service_role', 'public.grant_credits_v1(uuid,text,integer,text)', 'EXECUTE'), 'service_role can execute grant_credits_v1');

select ok(not has_function_privilege('anon', 'public.spend_credits_v1(uuid,text,integer,text)', 'EXECUTE'), 'anon cannot execute spend_credits_v1');
select ok(not has_function_privilege('authenticated', 'public.spend_credits_v1(uuid,text,integer,text)', 'EXECUTE'), 'authenticated cannot execute spend_credits_v1');

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
-- 2. Functional & Business Logic Tests
-- ============================================================================

do $$
declare
  v_user_1 uuid := gen_random_uuid();
  v_user_2 uuid := gen_random_uuid();
  v_res jsonb;
  v_res_text text;
  v_bal integer;
  v_origin text;
  v_ref text;
  v_active_count integer;
begin
  insert into auth.users (id, email) values (v_user_1, 'user1@test.local'), (v_user_2, 'user2@test.local');

  -- Test 1: Welcome grant (+20) exactly once
  v_res := public.grant_welcome_credit_v1(v_user_1);
  if (v_res->>'granted')::boolean is not true or (v_res->>'credits')::int <> 20 then
    raise exception 'Test 1 Failed: welcome grant should return granted=true, credits=20';
  end if;

  if public.credit_balance_v1(v_user_1) <> 20 then
    raise exception 'Test 1 Failed: credit balance should be 20';
  end if;

  v_res := public.grant_welcome_credit_v1(v_user_1);
  if (v_res->>'already_granted')::boolean is not true or public.credit_balance_v1(v_user_1) <> 20 then
    raise exception 'Test 1 Failed: duplicate welcome grant altered balance';
  end if;

  -- Test 2: Story Mode Boundaries & Ownership Checks
  insert into public.stories (id, title, owner_user_id, visibility, total_chapters)
  values
    ('story-A', 'Story A', v_user_1, 'private', 50),
    ('story-B', 'Story B', v_user_1, 'private', 50),
    ('demo:shared-1', 'Demo Shared Story', v_user_1, 'public', 50);

  -- Un-owned story claim -> NOT_STORY_OWNER
  v_res := public.claim_starter_story_v1(v_user_2, 'story-A');
  if (v_res->>'reason') <> 'NOT_STORY_OWNER' then
    raise exception 'Test 2 Ownership Check Failed: un-owned story claim must return NOT_STORY_OWNER';
  end if;

  -- Public / Demo story claim -> NOT_ELIGIBLE_STORY_MODE
  v_res := public.claim_starter_story_v1(v_user_1, 'demo:shared-1');
  if (v_res->>'reason') <> 'NOT_ELIGIBLE_STORY_MODE' then
    raise exception 'Test 2 Mode Check Failed: demo/public story claim must return NOT_ELIGIBLE_STORY_MODE';
  end if;

  -- Valid Starter Claim for User 1
  v_res := public.claim_starter_story_v1(v_user_1, 'story-A');
  if (v_res->>'ok')::boolean is not true then
    raise exception 'Test 2 Starter Claim Failed';
  end if;

  -- Test 3: Story #2+ Reserve 24 credits & Generic Capture MUST NOT grant PAID_START (Requirement 2)
  perform public.grant_credits_v1(v_user_1, 'topup:seed', 10, 'seed'); -- balance = 30

  v_res := public.reserve_story_start_v1(v_user_1, 'story-B');
  if (v_res->>'ok')::boolean is not true or (v_res->>'status') <> 'RESERVED' then
    raise exception 'Test 3 Reserve Story Start Failed, got %', v_res;
  end if;

  -- Pre-capture state check: PENDING_PAID_START
  select commercial_origin into v_origin from public.stories where id = 'story-B';
  if v_origin <> 'PENDING_PAID_START' then
    raise exception 'Test 3 Pre-capture state failed: expected PENDING_PAID_START, got %', v_origin;
  end if;

  -- Generic Financial Capture MUST NOT grant PAID_START
  v_ref := v_res->>'ref';
  v_res_text := public.capture_credit_reservation_v1(v_ref);
  if v_res_text <> 'ok' then
    raise exception 'Test 3 Capture Story Start Failed: %', v_res_text;
  end if;

  select commercial_origin into v_origin from public.stories where id = 'story-B';
  if v_origin = 'PAID_START' then
    raise exception 'Test 3 REQUIREMENT 2 FAILED: generic capture MUST NOT grant PAID_START entitlement without Bab 1 publish!';
  end if;
  if v_origin <> 'PENDING_PAID_START' then
    raise exception 'Test 3 commercial_origin drift: expected PENDING_PAID_START, got %', v_origin;
  end if;

  -- Test 4: Live DB Chapter Unlock Reservation, Canonical Debit Ref & Legacy Spend Duplicate Proof
  perform public.grant_credits_v1(v_user_1, 'topup:seed2', 10, 'seed'); -- balance = 16

  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-B', 4);
  if (v_res->>'ok')::boolean is not true or (v_res->>'cost')::int <> 8 then
    raise exception 'Test 4 Chapter Reserve Failed, got %', v_res;
  end if;

  v_ref := v_res->>'ref';
  v_res_text := public.capture_credit_reservation_v1(v_ref);
  if v_res_text <> 'ok' then
    raise exception 'Test 4 Chapter Capture Failed: %', v_res_text;
  end if;

  if not exists (select 1 from public.credit_ledger where user_id = v_user_1 and ref = 'unlock:story-B:4' and delta = -8) then
    raise exception 'Test 4 Canonical Ref Mapping Failed: unlock:story-B:4 missing from credit_ledger';
  end if;

  v_res_text := public.spend_credits_v1(v_user_1, 'unlock:story-B:4', 8, 'unlock_chapter');
  if v_res_text <> 'duplicate' then
    raise exception 'Test 4 Legacy Spend Duplicate Check Failed: expected duplicate, got %', v_res_text;
  end if;

  -- Test 5: Expired Reservation Re-Activation & Single Hold Invariant (Requirement 3)
  -- Create reservation for chapter 5, manually expire it
  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-B', 5);
  v_ref := v_res->>'ref';
  update public.credit_reservations set expires_at = clock_timestamp() - interval '10 minutes', status = 'EXPIRED' where ref = v_ref;

  -- Attempt capture on expired reservation -> MUST FAIL
  v_res_text := public.capture_credit_reservation_v1(v_ref);
  if v_res_text <> 'expired' then
    raise exception 'Test 5 Expired Capture Check Failed: expected expired, got %', v_res_text;
  end if;

  -- Re-authorize SAME chapter 5 when balance is sufficient -> Reactivates existing row, single ACTIVE hold
  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-B', 5);
  if (v_res->>'ok')::boolean is not true or (v_res->>'status') <> 'RESERVED' then
    raise exception 'Test 5 Re-authorization Failed, got %', v_res;
  end if;

  select count(*) into v_active_count from public.credit_reservations
  where user_id = v_user_1 and story_id = 'story-B' and chapter_number = 5 and status = 'ACTIVE';
  if v_active_count <> 1 then
    raise exception 'Test 5 Single Hold Invariant Failed: expected 1 active hold, got %', v_active_count;
  end if;

  -- Manually expire again, drain balance, attempt re-authorization -> MUST return INSUFFICIENT_CREDITS
  update public.credit_reservations set expires_at = clock_timestamp() - interval '10 minutes', status = 'EXPIRED' where ref = v_ref;
  perform public.spend_credits_v1(v_user_1, 'drain:balance', public.available_credit_balance_v1(v_user_1), 'drain');

  v_res := public.reserve_chapter_unlock_v1(v_user_1, 'story-B', 5);
  if (v_res->>'ok')::boolean is true or (v_res->>'reason') <> 'INSUFFICIENT_CREDITS' then
    raise exception 'Test 5 Insufficient Re-authorization Check Failed, got %', v_res;
  end if;

end
$$;

select ok(true, 'All anti-abuse DB tests completed successfully');

rollback;
