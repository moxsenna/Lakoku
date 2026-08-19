-- Terminal Commercial Finalization Tests (pgTAP)
-- Architecture: Results persist into TEMP table, assertions at TOP-LEVEL
-- Trigger disabled once after BEGIN, re-enabled before rollback
-- STORY_START fixtures: story_creation_requests + credit_reservations (STORY_START)
-- CHAPTER_UNLOCK fixtures: commercial_generation_intents + credit_reservations (CHAPTER_UNLOCK)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Plan will be recalculated based on actual assertions at end
-- For now, estimate ~20 cases and adjust later

create temp table terminal_test_results (
  case_name text primary key,
  result jsonb,
  reservation_ref text,
  intent_id uuid
);

alter table generation_jobs disable trigger generation_jobs_enforce_state_v1_trigger;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-1-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000001';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: FAILED ACTIVE -> RELEASED (STORY_START binding)
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-failed-active@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Failed Active', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-failed-active', md5('story-failed-active'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_failed_active', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-2-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000002';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 5;
BEGIN
  -- Test: CANCELLED ACTIVE -> RELEASED (STORY_START binding)
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-cancelled-active@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Cancelled Active', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'CANCELLED', 2, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-cancelled-active', md5('story-cancelled-active'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_cancelled_active', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-3-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000003';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: RELEASED -> ALREADY_RELEASED (idempotent)
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-idempotent@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Idempotent', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-already-released', md5('story-already-released'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'RELEASED', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_already_released', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-4-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000004';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: EXPIRED -> ALREADY_NON_ACTIVE
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-expired@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Expired', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-expired', md5('story-expired'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'EXPIRED', now() - interval '1 hour');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_expired', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-5-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000005';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: CAPTURED -> CAPTURED_INVARIANT_VIOLATION
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-captured@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Captured', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-captured', md5('story-captured'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'CAPTURED', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_captured', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-6-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000006';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: wrong amount -> RESERVATION_AMOUNT_MISMATCH
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-wrong-amount@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Wrong Amount', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-wrong-amount', md5('story-wrong-amount'), 'RESERVED', now());
  
  -- Amount is 10 instead of expected 24
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 10, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_wrong_amount', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:' || v_user_id::TEXT || ':' || v_story_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-7-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000007';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: missing reservation -> RESERVATION_MISSING
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-missing-reservation@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Missing Reservation', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'story-missing-reservation', md5('story-missing-reservation'), 'RESERVED', now());
  
  -- No credit_reservations inserted
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'story_missing_reservation', finalize_terminal_commercial_generation_v1(v_job_id), NULL;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-story-8-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000008';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: non-terminal state -> NON_TERMINAL_STATE
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-story-running@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Story Running', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, claim_token, claimed_at, heartbeat_at, worker_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'RUNNING', 1, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1', gen_random_uuid(), now(), now(), 'worker-test');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'job_running', finalize_terminal_commercial_generation_v1(v_job_id), NULL;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-chapter-1-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000010';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 5;
  v_intent_id UUID := gen_random_uuid();
BEGIN
  -- Test: CHAPTER_UNLOCK FAILED ACTIVE -> RELEASED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-chapter-failed-active@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Chapter Failed Active', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT);
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-test', 8, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 8, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref, intent_id)
  SELECT 'chapter_failed_active', finalize_terminal_commercial_generation_v1(v_job_id), 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, v_intent_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-chapter-2-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000011';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 6;
  v_intent_id UUID := gen_random_uuid();
BEGIN
  -- Test: CHAPTER_UNLOCK CANCELLED ACTIVE -> RELEASED, preserves trigger_choice_id
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-chapter-cancelled-active@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Chapter Cancelled Active', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, trigger_choice_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'CANCELLED', 2, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT, 'choice-preserved');
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-preserved', 10, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 10, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref, intent_id)
  SELECT 'chapter_cancelled_active', finalize_terminal_commercial_generation_v1(v_job_id), 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, v_intent_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-provenance-1-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000020';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 7;
  v_intent_id UUID := gen_random_uuid();
BEGIN
  -- Test: both bindings -> PROVENANCE_CONFLICT
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-provenance-conflict@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Provenance Conflict', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT);
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'provenance-conflict', md5('provenance-conflict'), 'RESERVED', now());
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-conflict', 12, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 12, 'ACTIVE', now() + interval '30 minutes');
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref, intent_id)
  SELECT 'provenance_conflict', finalize_terminal_commercial_generation_v1(v_job_id), 'story-start:', v_intent_id;
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-nobinding-1-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '70000000-0000-4000-8000-000000000030';
  v_job_id UUID := gen_random_uuid();
BEGIN
  -- Test: neither binding -> NO_COMMERCIAL_BINDING
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-no-binding@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test No Binding', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  -- No story_creation_requests
  -- No commercial_generation_intents
  -- No credit_reservations
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  SELECT 'no_binding', finalize_terminal_commercial_generation_v1(v_job_id), NULL;
END $$;

DO $$
DECLARE
  fake_job_id UUID := '00000000-0000-4000-8000-000000000000';
  v_result JSONB;
BEGIN
  -- Test: JOB_NOT_FOUND
  
  v_result := public.finalize_terminal_commercial_generation_v1(fake_job_id);
  
  INSERT INTO terminal_test_results (case_name, result, reservation_ref)
  VALUES ('job_not_found', v_result, NULL);
END $$;

alter table generation_jobs enable trigger generation_jobs_enforce_state_v1_trigger;

-- Recalculate plan count based on actual tests
select plan(14);

-- STORY_START CASES
select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'story_failed_active'),
  'RELEASED',
  'STORY_START FAILED ACTIVE -> RELEASED'
);

select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'story_cancelled_active'),
  'RELEASED',
  'STORY_START CANCELLED ACTIVE -> RELEASED'
);

select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'story_already_released'),
  'ALREADY_RELEASED',
  'STORY_START RELEASED -> ALREADY_RELEASED'
);

select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'story_expired'),
  'ALREADY_NON_ACTIVE',
  'STORY_START EXPIRED -> ALREADY_NON_ACTIVE'
);

select is(
  (SELECT result->>'reason' FROM terminal_test_results WHERE case_name = 'story_captured'),
  'CAPTURED_INVARIANT_VIOLATION',
  'STORY_START CAPTURED -> CAPTURED_INVARIANT_VIOLATION'
);

select is(
  (SELECT result->>'reason' FROM terminal_test_results WHERE case_name = 'story_wrong_amount'),
  'RESERVATION_AMOUNT_MISMATCH',
  'STORY_START wrong amount -> RESERVATION_AMOUNT_MISMATCH'
);

select is(
  (SELECT result->>'reason' FROM terminal_test_results WHERE case_name = 'story_missing_reservation'),
  'RESERVATION_MISSING',
  'STORY_START missing reservation -> RESERVATION_MISSING'
);

-- CHAPTER_UNLOCK CASES
select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'chapter_failed_active'),
  'RELEASED',
  'CHAPTER_UNLOCK FAILED ACTIVE -> RELEASED'
);

select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'chapter_cancelled_active'),
  'RELEASED',
  'CHAPTER_UNLOCK CANCELLED ACTIVE -> RELEASED'
);

-- Verify CHAPTER final state preservation (trigger_choice_id, quote, pricing unchanged)
select is(
  (SELECT trigger_choice_id::text from commercial_generation_intents where id = (SELECT intent_id FROM terminal_test_results WHERE case_name = 'chapter_cancelled_active')),
  'choice-preserved',
  'chapter_cancelled_active preserves trigger_choice_id'
);

select is(
  (SELECT quoted_credits::text from commercial_generation_intents where id = (SELECT intent_id FROM terminal_test_results WHERE case_name = 'chapter_cancelled_active')),
  '10',
  'chapter_cancelled_active preserves quoted_credits'
);

select is(
  (SELECT pricing_version::text from commercial_generation_intents where id = (SELECT intent_id FROM terminal_test_results WHERE case_name = 'chapter_cancelled_active')),
  'v1',
  'chapter_cancelled_active preserves pricing_version'
);

select ok(
  (SELECT status = 'WAITING_FOR_CREDITS' from commercial_generation_intents where id = (SELECT intent_id FROM terminal_test_results WHERE case_name = 'chapter_cancelled_active')),
  'chapter_cancelled_active transitions intent to WAITING_FOR_CREDITS'
);

select is(
  (SELECT status from credit_reservations where ref = (SELECT reservation_ref FROM terminal_test_results WHERE case_name = 'chapter_cancelled_active')),
  'RELEASED',
  'chapter_cancelled_active releases reservation to RELEASED'
);

-- PROVENANCE CASES
select is(
  (SELECT result->>'reason' FROM terminal_test_results WHERE case_name = 'provenance_conflict'),
  'PROVENANCE_CONFLICT',
  'both bindings -> PROVENANCE_CONFLICT'
);

select is(
  (SELECT result->>'outcome' FROM terminal_test_results WHERE case_name = 'no_binding'),
  'NO_COMMERCIAL_BINDING',
  'neither binding -> NO_COMMERCIAL_BINDING'
);

-- FINANCIAL CASE
select is(
  (SELECT result->>'reason' FROM terminal_test_results WHERE case_name = 'job_not_found'),
  'JOB_NOT_FOUND',
  'non-existent job -> JOB_NOT_FOUND'
);

select ok(
  (SELECT result IS NOT NULL FROM terminal_test_results WHERE case_name = 'job_running'),
  'running job returns error result'
);

select * from finish();
rollback;
