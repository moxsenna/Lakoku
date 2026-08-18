-- Terminal Commercial Finalization Tests (pgTAP)
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger;

-- Test 1: STORY_START FAILED + ACTIVE -> RELEASED
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-1-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  -- Create user through proper auth mechanism for local test environment
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  -- Create job FIRST (required by FK constraint on SCR) - use terminal state directly with disabled trigger
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'test-idem-' || v_job_id::TEXT, md5('test'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 1, 24, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text::text, 'true'::text, 'finalizer releases active reservation');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text::text, 'RELEASED'::text::text, 'outcome is RELEASED');
END $$;

-- Test 2: CHAPTER_UNLOCK CANCELLED + ACTIVE -> RELEASED
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-2-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 5;
  v_quoted_credits INT := 8;
  v_reservation_ref TEXT := 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Create user in auth.users (required for all user operations)
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 2', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  -- Create job FIRST (required by FK on commercial_generation_intents and SCR)
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'QUEUED', 0, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT);
  
  -- Transition to CANCELLED via UPDATE (requires disabling trigger for terminal states)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  UPDATE generation_jobs 
  SET status = 'CANCELLED',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_job_id AND status = 'QUEUED';
  EXECUTE 'ALTER TABLE generation_jobs ENABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-abc', v_quoted_credits, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'CHAPTER_UNLOCK', v_chapter, v_quoted_credits, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'test-chapter', md5('chapter'), 'RESERVED', now());
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'ok')::text::text, 'true', 'finalizer releases CHAPTER_UNLOCK reservation');
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text::text, 'RELEASED'::text, 'outcome is RELEASED');
END $$;

-- Test 3: Idempotent - Already RELEASED
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-3-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for terminal state INSERT)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 3', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-already', md5('idem'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 24, 'RELEASED'::text, now() + interval '30 minutes');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'already_released')::text::text, 'true', 'already_released flag set');
END $$;

-- Test 4: EXPIRED -> ALREADY_NON_ACTIVE
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-4-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for terminal state INSERT)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 4', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-expired', md5('idem'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 24, 'EXPIRED', now() - interval '1 hour');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text::text, 'ALREADY_NON_ACTIVE'::text, 'outcome is ALREADY_NON_ACTIVE for EXPIRED');
END $$;

-- Test 5: CAPTURED state -> invariant violation
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-5-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for terminal state INSERT)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now()) ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 5', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-captured', md5('idem'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 24, 'CAPTURED', now() + interval '30 minutes');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text::text, 'CAPTURED_INVARIANT_VIOLATION'::text, 'CAPTURED triggers invariant failure');
END $$;

-- Test 6: Wrong amount mismatch
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-6-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_reservation_ref TEXT := 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for terminal state INSERT)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now()) ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 6', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-wrong', md5('idem'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, v_reservation_ref, 'STORY_START', 10, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text::text, 'RESERVATION_AMOUNT_MISMATCH'::text, 'amount validation fails');
END $$;

-- Test 7: PROVENANCE_CONFLICT - both bindings exist
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-7-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for terminal state INSERT)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now()) ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 7', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'idem-both', md5('idem'), 'RESERVED', now());
  
  INSERT INTO commercial_generation_intents (generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_job_id, v_user_id, v_story_id, 5, 'choice-x', 10, 'v1', 'QUEUED');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text::text, 'PROVENANCE_CONFLICT'::text, 'both bindings triggers conflict error');
END $$;

-- Test 8: NO_COMMERCIAL_BINDING - plain job (personalized job without commercial intent)
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-8-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for terminal state INSERT)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now()) ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 8', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'outcome')::text::text, 'NO_COMMERCIAL_BINDING'::text, 'no binding success path');
END $$;

-- Test 9: JOB_NOT_FOUND
DO $$
DECLARE
  fake_job_id UUID := '00000000-0000-4000-8000-000000000000';
  v_result JSONB;
BEGIN
  v_result := public.finalize_terminal_commercial_generation_v1(fake_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text::text, 'JOB_NOT_FOUND'::text, 'non-existent job returns error');
END $$;

-- Test 10: NON_TERMINAL_STATE (RUNNING)
DO $$
DECLARE
  v_story_id TEXT := 'tst-story-10-' || gen_random_uuid()::TEXT;
  v_user_id UUID := gen_random_uuid();
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Disable trigger for this test (needed for RUNNING state)
  EXECUTE 'ALTER TABLE generation_jobs DISABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) VALUES (v_user_id, 'test' || '-' || v_story_id::TEXT || '@example.com', 'authenticated', now(), now()) ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story 10', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, claim_token, claimed_at, heartbeat_at, worker_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'RUNNING', 1, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1', gen_random_uuid(), now(), now(), 'worker-test');
  
  v_result := public.finalize_terminal_commercial_generation_v1(v_job_id);
  
  PERFORM is(jsonb_extract_path(v_result, 'reason')::text::text, 'NON_TERMINAL_STATE'::text, 'running job rejected');
END $$;

-- Re-enable triggers after test setup
DO $$
BEGIN
  EXECUTE 'ALTER TABLE generation_jobs ENABLE TRIGGER generation_jobs_enforce_state_v1_trigger';
END $$;

SELECT * FROM finish();
rollback;
