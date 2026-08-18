-- Terminal Commercial Finalization Tests (pgTAP)
-- 
-- Tests for PRODUCT P0 fix: RELEASE ACTIVE credit_reservations when generation jobs
-- reach terminal FAILED/CANCELLED state.
--
-- Test coverage for:
--   1. STORY_START binding via generation_job_id foreign key
--   2. CHAPTER_UNLOCK binding via generation_job_id foreign key
--   3. Amount validation for both STORY_START (canonical price = 24) and CHAPTER_UNLOCK (intent.quoted_credits)
--   4. State outcomes: ACTIVE→RELEASED, RELEASED→ALREADY_RELEASED, EXPIRED→ALREADY_NON_ACTIVE, CAPTURED→FAIL
--   5. Provenance conflict detection (both bindings present OR no binding present)
--   6. Job revalidation under lock (generation_job_id must match)

SELECT plan(18);

-- ===========================================================================
-- Test 1: STORY_START - ACTIVE reservation + FAILED job → RELEASED
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-1-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  -- Create user
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  -- Create story with minimal required fields (matching actual schema)
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0)
  RETURNING id INTO v_story_id;
  
  -- Create exact binding via generation_job_id foreign key
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-test-idem-' || v_job_id::TEXT);
  
  -- Create ACTIVE reservation with canonical amount 24
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 1, 24, 'ACTIVE');
  
  -- Create FAILED job with matching metadata
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3);
  
  -- Execute finalizer
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  -- Verify result structure
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'result ok=true for successful release');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text, 'RELEASED', 'outcome is RELEASED');
  PERFORM is(jsonb_extract_path(v_result, 'operation')::text, 'STORY_START', 'operation is STORY_START');
  PERFORM is(jsonb_extract_path(v_result, 'ref')::text, v_reservation_ref, 'correct canonical ref');
  
  -- Verify mutation
  PERFORM is(
    (SELECT status FROM credit_reservations WHERE ref = v_reservation_ref)::TEXT,
    'RELEASED',
    'reservation changed from ACTIVE to RELEASED'
  );
END $$;

-- ===========================================================================
-- Test 2: CHAPTER_UNLOCK - ACTIVE reservation + CANCELLED job → RELEASED
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-2-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 3;
  v_quoted_credits INT := 8;
  v_reservation_ref TEXT := 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Create user and story
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 2', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0)
  RETURNING id INTO v_story_id;
  
  -- Create exact binding via generation_job_id
  INSERT INTO commercial_generation_intents (generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, status)
  VALUES (v_job_id, v_user_id, v_story_id, v_chapter, 'choice-abc', v_quoted_credits, 'QUEUED');
  
  -- Create ACTIVE reservation with intent's quoted_credits amount
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'CHAPTER_UNLOCK', v_chapter, v_quoted_credits, 'ACTIVE');
  
  -- Create CANCELLED job
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, trigger_choice_id)
  VALUES (v_user_id, v_story_id, 'choice', v_chapter, 'CANCELLED', 'choice-abc');
  
  -- Execute finalizer
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  -- Verify result
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'finalization returns ok=true');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text, 'RELEASED', 'outcome is RELEASED');
  PERFORM is(jsonb_extract_path(v_result, 'operation')::text, 'CHAPTER_UNLOCK', 'operation is CHAPTER_UNLOCK');
  PERFORM is((jsonb_extract_path(v_result, 'chapter_number')::INTEGER)::TEXT, v_chapter::TEXT, 'correct chapter_number');
  
  -- Verify reservation released
  PERFORM is(
    (SELECT status FROM credit_reservations WHERE ref = v_reservation_ref)::TEXT,
    'RELEASED',
    'CHAPTER_UNLOCK reservation released'
  );
  
  -- Verify intent reset to WAITING_FOR_CREDITS
  PERFORM is(
    (SELECT status FROM commercial_generation_intents WHERE id = v_intent_id)::TEXT,
    'WAITING_FOR_CREDITS',
    'intent transitioned to WAITING_FOR_CREDITS'
  );
END $$;

-- ===========================================================================
-- Test 3: Idempotent - RELEASED + FAILED job → ALREADY_RELEASED
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-3';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 3', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0)
  RETURNING id INTO v_story_id;
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-already-released');
  
  -- Already RELEASED
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status, released_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 24, 'RELEASED', NOW());
  
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'already_released is idempotent success');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text, 'ALREADY_RELEASED', 'outcome is ALREADY_RELEASED');
  PERFORM is(jsonb_extract_path(v_result, 'status')::text, 'RELEASED', 'status shows RELEASED');
END $$;

-- ===========================================================================
-- Test 4: EXPIRED reservation → ALREADY_NON_ACTIVE (no mutation)
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-4';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 4', 'public', 'ACTIVE', 'template')
  RETURNING id INTO v_story_id;
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-expired');
  
  -- EXPIRED reservation
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 24, 'EXPIRED');
  
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'ALREADY_NON_ACTIVE is success');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text, 'ALREADY_NON_ACTIVE', 'outcome is ALREADY_NON_ACTIVE');
  PERFORM is(jsonb_extract_path(v_result, 'status')::text, 'EXPIRED', 'status shows EXPIRED');
  
  -- Verify no mutation occurred
  PERFORM is(
    (SELECT status FROM credit_reservations WHERE ref = v_reservation_ref)::TEXT,
    'EXPIRED',
    'EXPIRED reservation unchanged'
  );
END $$;

-- ===========================================================================
-- Test 5: CAPTURED state → fail closed with CAPTURED_INVARIANT_VIOLATION
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-5';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 5', 'public', 'ACTIVE', 'template')
  RETURNING id INTO v_story_id;
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-captured');
  
  -- CAPTURED invariant violation
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 24, 'CAPTURED');
  
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'CAPTURED is failure');
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text, 'CAPTURED_INVARIANT_VIOLATION', 'reason is CAPTURED_INVARIANT_VIOLATION');
END $$;

-- ===========================================================================
-- Test 6: Wrong amount (STORY_START expects 24) → RESERVATION_AMOUNT_MISMATCH
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-6';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 6', 'public', 'ACTIVE', 'template')
  RETURNING id INTO v_story_id;
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-wrong-amount');
  
  -- WRONG amount (should be 24)
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 10, 'ACTIVE');
  
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'wrong amount is failure');
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text, 'RESERVATION_AMOUNT_MISMATCH', 'reason is RESERVATION_AMOUNT_MISMATCH');
  PERFORM is((jsonb_extract_path(v_result, 'expected_amount')::INTEGER)::TEXT, '24', 'expected_amount is 24');
  PERFORM is((jsonb_extract_path(v_result, 'actual_amount')::INTEGER)::TEXT, '10', 'actual_amount reflects reservation');
END $$;

-- ===========================================================================
-- Test 7: PROVENANCE_CONFLICT - both STORY_START and CHAPTER_UNLOCK bindings exist
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-7';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 7', 'public', 'ACTIVE', 'template')
  RETURNING id INTO v_story_id;
  
  -- Create BOTH bindings for same job (invalid state)
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-both-1');
  
  INSERT INTO commercial_generation_intents (generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, status)
  VALUES (gen_random_uuid(), v_job_id, v_user_id, v_story_id, 2, 'choice-x', 10, 'QUEUED');
  
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'PROVENANCE_CONFLICT is failure');
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text, 'PROVENANCE_CONFLICT', 'reason is PROVENANCE_CONFLICT');
END $$;

-- ===========================================================================
-- Test 8: NO_COMMERCIAL_BINDING - plain job without bindings
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-8';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 8', 'public', 'ACTIVE', 'template')
  RETURNING id INTO v_story_id;
  
  -- No bindings at all - plain generation job
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'template', 1, 'FAILED', 3, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'NO_COMMERCIAL_BINDING is success (nothing to release)');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text, 'NO_COMMERCIAL_BINDING', 'outcome is NO_COMMERCIAL_BINDING');
END $$;

-- ===========================================================================
-- Test 9: JOB_NOT_FOUND - non-existent job ID
-- ===========================================================================
DO $$
DECLARE
  fake_job_id UUID := '00000000-0000-4000-8000-000000000000';
  v_result JSONB;
BEGIN
  v_result := public.finalize_terminal_commercial_generation_v1(fake_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'JOB_NOT_FOUND is failure');
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text, 'JOB_NOT_FOUND', 'reason is JOB_NOT_FOUND');
END $$;

-- ===========================================================================
-- Test 10: NON_TERMINAL_STATE - RUNNING job should not be finalized
-- ===========================================================================
DO $$
DECLARE
  v_story_id TEXT := 'test-story-10';
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, email, aud) VALUES (v_user_id, 'test@example.com', 'authenticated')
    ON CONFLICT DO NOTHING;
  
  INSERT INTO stories (owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_user_id, 'Test Story 10', 'public', 'ACTIVE', 'template')
  RETURNING id INTO v_story_id;
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-running');
  
  -- RUNNING is NOT terminal
  INSERT INTO generation_jobs (user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts)
  VALUES (v_user_id, v_story_id, 'personalized', 1, 'RUNNING', 0, 3);
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'NON_TERMINAL_STATE is failure');
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text, 'NON_TERMINAL_STATE', 'reason is NON_TERMINAL_STATE');
  PERFORM is(jsonb_extract_path(v_result, 'status')::text, 'RUNNING', 'status reported as RUNNING');
END $$;

-- Cleanup
SELECT * FROM finish_tests();
