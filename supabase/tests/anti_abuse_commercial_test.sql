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

select ok(not has_function_privilege('anon', 'public.reserve_chapter_unlock_v1(uuid, text, integer)', 'EXECUTE'), 'anon cannot execute reserve_chapter_unlock_v1');
select ok(not has_function_privilege('authenticated', 'public.reserve_chapter_unlock_v1(uuid, text, integer)', 'EXECUTE'), 'authenticated cannot execute reserve_chapter_unlock_v1');
select ok(has_function_privilege('service_role', 'public.reserve_chapter_unlock_v1(uuid, text, integer)', 'EXECUTE'), 'service_role can execute reserve_chapter_unlock_v1');

select ok(not has_function_privilege('anon', 'public.reserve_story_start_v1(uuid, text)', 'EXECUTE'), 'anon cannot execute reserve_story_start_v1');
select ok(not has_function_privilege('authenticated', 'public.reserve_story_start_v1(uuid, text)', 'EXECUTE'), 'authenticated cannot execute reserve_story_start_v1');
select ok(has_function_privilege('service_role', 'public.reserve_story_start_v1(uuid, text)', 'EXECUTE'), 'service_role can execute reserve_story_start_v1');

-- ============================================================================
-- 2. Functional, Story Mode, Welcome Cutoff & Backfill Tests
-- ============================================================================

do $$
declare
  v_user_new uuid := gen_random_uuid();
  v_user_old uuid := gen_random_uuid();
  v_user_prem_old uuid := gen_random_uuid();
  v_user_std_old uuid := gen_random_uuid();
  v_res jsonb;
  v_res_text text;
  v_origin text;
  v_ref text;
  v_version text;
  v_starter_id text;
  v_claimed_at timestamptz;
  v_caught boolean := false;
begin
  -- Setup auth users (v_user_old created before welcome cutoff 2026-08-04, v_user_new created after)
  insert into auth.users (id, email, created_at) values
    (v_user_new, 'new_user@test.local', '2026-08-04 12:00:00+00'::timestamptz),
    (v_user_old, 'old_user@test.local', '2026-07-01 12:00:00+00'::timestamptz),
    (v_user_prem_old, 'old_prem_user@test.local', '2026-07-01 12:00:00+00'::timestamptz),
    (v_user_std_old, 'old_std_user@test.local', '2026-07-01 12:00:00+00'::timestamptz);

  -- Test 1: Requirement 2 - Welcome grant (+20) server-authoritative cutoff
  -- Old account created before cutoff -> NOT ELIGIBLE for +20 welcome credit
  v_res := public.grant_welcome_credit_v1(v_user_old);
  if (v_res->>'granted')::boolean is not false or (v_res->>'reason') <> 'NOT_ELIGIBLE_ACCOUNT_CREATED_BEFORE_WELCOME_CUTOFF' then
    raise exception 'Test 1 Old Account Welcome Check Failed: expected NOT_ELIGIBLE_ACCOUNT_CREATED_BEFORE_WELCOME_CUTOFF, got %', v_res;
  end if;

  if public.available_credit_balance_v1(v_user_old) <> 0 then
    raise exception 'Test 1 Old Account Balance Check Failed: expected 0 credits, got %', public.available_credit_balance_v1(v_user_old);
  end if;

  -- New account created after cutoff -> ELIGIBLE once (+20 credits)
  v_res := public.grant_welcome_credit_v1(v_user_new);
  if (v_res->>'granted')::boolean is not true or (v_res->>'credits')::int <> 20 then
    raise exception 'Test 1 New Account Welcome Check Failed: expected granted=true, credits=20, got %', v_res;
  end if;

  if public.available_credit_balance_v1(v_user_new) <> 20 then
    raise exception 'Test 1 New Account Balance Check Failed: expected 20 credits';
  end if;

  -- Replay on new account -> already_granted=true
  v_res := public.grant_welcome_credit_v1(v_user_new);
  if (v_res->>'already_granted')::boolean is not true or public.available_credit_balance_v1(v_user_new) <> 20 then
    raise exception 'Test 1 Duplicate Welcome Check Failed';
  end if;

  -- Test 2: Requirement 4 - Pricing Version Updates
  select pricing_version into v_version from public.feature_credit_costs where feature_key = 'chapter_unlock';
  if v_version <> 'v1.1-202608' then
    raise exception 'Test 2 Pricing Version Failed for chapter_unlock: expected v1.1-202608, got %', v_version;
  end if;

  select pricing_version into v_version from public.feature_credit_costs where feature_key = 'story_start';
  if v_version <> 'v1.1-202608' then
    raise exception 'Test 2 Pricing Version Failed for story_start: expected v1.1-202608, got %', v_version;
  end if;

  -- Test 3: Requirement 1 - Legacy Account Starter Backfill Test
  insert into public.stories (id, title, owner_user_id, visibility, story_mode, created_at)
  values
    ('old-pers-1', 'Old Pers 1', v_user_old, 'private', 'personalized_ai', '2026-07-02 10:00:00+00'::timestamptz),
    ('old-pers-2', 'Old Pers 2', v_user_old, 'private', 'personalized_ai', '2026-07-05 10:00:00+00'::timestamptz),
    ('old-prem-1', 'Old Prem 1', v_user_prem_old, 'private', 'premium_instance', '2026-07-03 10:00:00+00'::timestamptz),
    ('old-std-1',  'Old Std 1',  v_user_std_old,  'private', 'standard',           '2026-07-04 10:00:00+00'::timestamptz);

  -- Execute legacy backfill logic
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

  -- Verify old user with 2 personalized stories has earliest story set as starter_story_id
  select starter_story_id, starter_claimed_at into v_starter_id, v_claimed_at
  from public.account_commercial_states where user_id = v_user_old;
  if v_starter_id <> 'old-pers-1' or v_claimed_at is null then
    raise exception 'Test 3 Earliest Starter Backfill Failed: expected old-pers-1, got %', v_starter_id;
  end if;

  -- Attempting claim_starter_story_v1 on new story for old user MUST fail as STARTER_ALREADY_CLAIMED
  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values ('old-pers-new', 'Old Pers New', v_user_old, 'private', 'personalized_ai');

  v_res := public.claim_starter_story_v1(v_user_old, 'old-pers-new');
  if (v_res->>'reason') <> 'STARTER_ALREADY_CLAIMED' then
    raise exception 'Test 3 Claim Starter for Backfilled User Failed: expected STARTER_ALREADY_CLAIMED, got %', v_res;
  end if;

  -- Verify premium instance user starter entitlement consumed
  select starter_story_id, starter_claimed_at into v_starter_id, v_claimed_at
  from public.account_commercial_states where user_id = v_user_prem_old;
  if v_starter_id <> 'old-prem-1' or v_claimed_at is null then
    raise exception 'Test 3 Premium Instance Starter Backfill Failed';
  end if;

  -- Verify standard private story user remains unclaimed
  select starter_claimed_at into v_claimed_at
  from public.account_commercial_states where user_id = v_user_std_old;
  if v_claimed_at is not null then
    raise exception 'Test 3 Standard User Backfill Leak Failed: expected NULL claimed_at, got %', v_claimed_at;
  end if;

  -- Test 4: reserve_story_start_v1 for user with starter claimed vs unclaimed
  perform public.grant_credits_v1(v_user_new, 'topup:seed', 30, 'seed'); -- balance = 50

  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values
    ('new-pers-1', 'New Pers 1', v_user_new, 'private', 'personalized_ai'),
    ('new-pers-2', 'New Pers 2', v_user_new, 'private', 'personalized_ai');

  -- User new has NOT claimed starter story yet -> reserve_story_start_v1 MUST REJECT!
  v_res := public.reserve_story_start_v1(v_user_new, 'new-pers-2');
  if (v_res->>'reason') <> 'STORY_START_NOT_REQUIRED' then
    raise exception 'Test 4 Unclaimed Starter Check Failed: expected STORY_START_NOT_REQUIRED, got %', v_res;
  end if;

  -- Claim starter story for new-pers-1
  v_res := public.claim_starter_story_v1(v_user_new, 'new-pers-1');
  if (v_res->>'ok')::boolean is not true then
    raise exception 'Test 4 Starter Claim Failed';
  end if;

  -- Now reserve story start for new-pers-2 costs 24 and succeeds
  v_res := public.reserve_story_start_v1(v_user_new, 'new-pers-2');
  if (v_res->>'ok')::boolean is not true or (v_res->>'status') <> 'RESERVED' then
    raise exception 'Test 4 Story #2 Reserve Failed, got %', v_res;
  end if;

  -- Test 5: reserve_chapter_unlock_v1 fail-closed on PENDING_PAID_START
  v_res := public.reserve_chapter_unlock_v1(v_user_new, 'new-pers-2', 4);
  if (v_res->>'reason') <> 'COMMERCIAL_STATE_INVALID' then
    raise exception 'Test 5 PENDING_PAID_START Ch4 Check Failed: expected COMMERCIAL_STATE_INVALID, got %', v_res;
  end if;

  -- Test 6: Ledger conflict validation during capture
  v_res := public.reserve_chapter_unlock_v1(v_user_new, 'new-pers-1', 4);
  v_ref := v_res->>'ref';

  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (v_user_new, -5, 'unlock_chapter', 'unlock:new-pers-1:4');

  v_caught := false;
  begin
    perform public.capture_credit_reservation_v1(v_ref);
  exception when others then
    if sqlerrm like '%IDEMPOTENCY_CONFLICT%' then
      v_caught := true;
    end if;
  end;

  if not v_caught then
    raise exception 'Test 6 Mismatched Ledger Ref Capture Check Failed: expected IDEMPOTENCY_CONFLICT exception';
  end if;

end
$$;

select ok(true, 'All anti-abuse DB tests completed successfully');

rollback;
