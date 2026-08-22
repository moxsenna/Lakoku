-- Terminal Commercial Discovery RPC Tests (pgTAP)
-- Tests list_terminal_commercial_finalization_candidates_v1() discovery logic
-- Architecture: Each fixture creates a unique job.id stored in TEMP table
-- Assertions verify candidate membership by target_job_id lookup, not global count

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Disable state enforcement trigger for synthetic commercial fixtures
alter table generation_jobs disable trigger generation_jobs_enforce_state_v1_trigger;

create temp table discovery_test_results (
  case_name text primary key,
  target_job_id uuid not null,
  result jsonb not null
);

DO $$
DECLARE
  v_user_id UUID := '80000000-0000-4000-8000-000000000100';
  v_result JSONB;
  v_empty_job UUID := gen_random_uuid();
BEGIN
  -- Test 1: Initial empty state - NO commercial jobs exist at all
  
  DELETE FROM commercial_generation_intents;
  DELETE FROM story_creation_requests;
  DELETE FROM credit_reservations;
  
  -- Create one plain FAILED job (no binding, should be excluded)
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-empty-state@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES ('empty-test-story', v_user_id, 'Empty Test', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_empty_job, v_user_id, 'empty-test-story', 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_empty_job::TEXT || ':publish:1');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('empty_initial_state', v_empty_job, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-story-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000200';
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 2: FAILED STORY_START with exact SCR binding + ACTIVE reservation -> INCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-failed-story-binding@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Failed Story Binding', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'failed-story-bind', md5('failed-story-bind'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('failed_story_with_binding_active_reservation', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-chapter-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000300';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 7;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 3: CANCELLED CHAPTER with exact CGI binding + ACTIVE reservation -> INCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-cancelled-chapter-binding@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Cancelled Chapter Binding', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, trigger_choice_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'CANCELLED', 2, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT, 'choice-discovery-match');
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-discovery-match', 10, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 10, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('cancelled_chapter_with_binding_active_reservation', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-undermax-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000400';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 8;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 4: FAILED job with attempt_count < max_attempts -> STILL INCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-under-max-attempts@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Under Max Attempts', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, trigger_choice_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'FAILED', 1, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT, 'choice-under-max');
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-under-max', 8, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 8, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('failed_under_max_attempts_included', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-nobinding-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000500';
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 5: FAILED job WITHOUT SCR/CGI binding -> EXCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-no-binding-example@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test No Binding', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  -- No story_creation_requests, no credit_reservations
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('failed_job_without_binding_excluded', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-released-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000600';
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 6: FAILED job with RELEASED reservation -> EXCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-released-reservation@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Released Reservation', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'released-reserve', md5('released-reserve'), 'RESERVED', now());
  
  -- Reservation is RELEASED, not ACTIVE
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'RELEASED', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('failed_job_with_released_reservation_excluded', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-running-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000700';
  v_job_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 7: RUNNING job -> EXCLUDED (not terminal state)
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-running-job@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Running Job', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, claim_token, claimed_at, heartbeat_at, worker_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 1, 'RUNNING', 1, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:1', gen_random_uuid(), now(), now(), 'worker-test');
  
  INSERT INTO story_creation_requests (generation_job_id, owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, created_at)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', 'running-job', md5('running-job'), 'RESERVED', now());
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'story-start:' || v_user_id::TEXT || ':' || v_story_id, 'STORY_START', 1, 24, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('running_job_excluded', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-trigger-mismatch-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000800';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 9;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 8: Trigger-choice mismatch (job NULL, intent non-NULL) -> EXCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-trigger-mismatch@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Trigger Mismatch', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  -- Job has NULL trigger_choice_id
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, trigger_choice_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT, NULL);
  
  -- Intent has non-NULL trigger_choice_id
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-mismatch', 12, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 12, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('trigger_choice_mismatch_null_vs_value_excluded', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-both-same-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000000900';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 10;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 9: Both identical non-NULL trigger_choice_id values -> INCLUDED (exact match)
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-both-match-example@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Both Match', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  -- Both job and intent have SAME trigger_choice_id value
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, trigger_choice_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT, 'choice-identical');
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-identical', 15, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 15, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('both_same_non_null_trigger_included', v_job_id, v_result);
END $$;

DO $$
DECLARE
  v_story_id TEXT := 'tst-discovery-different-trigger-' || gen_random_uuid()::TEXT;
  v_user_id UUID := '80000000-0000-4000-8000-000000001000';
  v_job_id UUID := gen_random_uuid();
  v_chapter INT := 11;
  v_intent_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Test 10: Different non-NULL trigger_choice_id values -> EXCLUDED
  
  INSERT INTO auth.users (id, email, aud, created_at, updated_at) 
  VALUES (v_user_id, 'test-different-trigger@example.com', 'authenticated', now(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = now();
  
  INSERT INTO stories (id, owner_user_id, title, visibility, story_mode, generation_status, total_chapters, status, current_chapter)
  VALUES (v_story_id, v_user_id, 'Test Different Trigger', 'private', 'personalized_ai', 'creating_contract', 50, 'BARU', 0);
  
  -- Job has different trigger_choice than intent
  INSERT INTO generation_jobs (id, user_id, story_id, generation_kind, chapter_number, status, attempt_count, max_attempts, deadline_at, publication_idempotency_key, trigger_choice_id)
  VALUES (v_job_id, v_user_id, v_story_id, 'personalized', v_chapter, 'FAILED', 3, 3, now() + interval '1 hour', 'generation-job:' || v_job_id::TEXT || ':publish:' || v_chapter::TEXT, 'choice-job-value');
  
  INSERT INTO commercial_generation_intents (id, generation_job_id, user_id, story_id, chapter_number, trigger_choice_id, quoted_credits, pricing_version, status)
  VALUES (v_intent_id, v_job_id, v_user_id, v_story_id, v_chapter, 'choice-intent-value', 20, 'v1', 'QUEUED');
  
  INSERT INTO credit_reservations (user_id, story_id, ref, reservation_kind, chapter_number, amount, status, expires_at)
  VALUES (v_user_id, v_story_id, 'chapter-reservation:' || v_user_id::TEXT || ':' || v_story_id || ':' || v_chapter::TEXT, 'CHAPTER_UNLOCK', v_chapter, 20, 'ACTIVE', now() + interval '30 minutes');
  
  v_result := public.list_terminal_commercial_finalization_candidates_v1(50);
  
  INSERT INTO discovery_test_results (case_name, target_job_id, result)
  VALUES ('different_non_null_trigger_excluded', v_job_id, v_result);
END $$;

-- Re-enable trigger before rollback
alter table generation_jobs enable trigger generation_jobs_enforce_state_v1_trigger;

-- Recalculate plan count based on actual assertions (16 total after Test 9 replacement)
select plan(16);

-- ===========================================================================
-- ASSERTION GROUP 1: EMPTY INITIAL STATE
-- ===========================================================================

select is(
  (SELECT (result->>'count')::int FROM discovery_test_results WHERE case_name = 'empty_initial_state'),
  0,
  'empty_initial_state returns count 0'
);

-- Verify no candidates when only plain FAILED job exists (no binding)
select ok(
  NOT EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'empty_initial_state'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'empty_initial_state does not include plain failed job without binding'
);

-- ===========================================================================
-- ASSERTION GROUP 2: INCLUDE TESTS (target_job_id must exist in candidates)
-- ===========================================================================

-- Test 2: FAILED STORY with exact binding + ACTIVE -> included
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'failed_story_with_binding_active_reservation'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'failed_story_with_binding_active_reservation includes target job in candidates'
);

-- Test 3: CANCELLED CHAPTER with exact binding + ACTIVE -> included
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'cancelled_chapter_with_binding_active_reservation'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'cancelled_chapter_with_binding_active_reservation includes target job in candidates'
);

-- Test 4: FAILED under max attempts -> STILL included
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'failed_under_max_attempts_included'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'failed_under_max_attempts_included discovers job even though attempt_count < max_attempts'
);

-- Test 9: Both SAME non-NULL trigger_choice_id values -> included (exact match)
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'both_same_non_null_trigger_included'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'both_same_non_null_trigger_included requires exact trigger_choice_id equality for inclusion'
);

-- ===========================================================================
-- ASSERTION GROUP 3: EXCLUSION TESTS (target_job_id must NOT exist in candidates)
-- ===========================================================================

-- Test 5: FAILED job WITHOUT binding -> excluded
select ok(
  NOT EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'failed_job_without_binding_excluded'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'failed_job_without_binding_excluded removes jobs lacking commercial binding'
);

-- Test 6: FAILED job with RELEASED reservation -> excluded
select ok(
  NOT EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'failed_job_with_released_reservation_excluded'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'failed_job_with_released_reservation_excluded filters out non-ACTIVE reservations'
);

-- Test 7: RUNNING job -> excluded
select ok(
  NOT EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'running_job_excluded'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'running_job_excluded only discovers FAILED/CANCELLED states'
);

-- Test 8: Trigger-choice mismatch (NULL vs value) -> excluded
select ok(
  NOT EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'trigger_choice_mismatch_null_vs_value_excluded'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'trigger_choice_mismatch_null_vs_value_excluded excludes mismatched triggers'
);

-- Test 10: Different non-NULL trigger_choice_id values -> excluded
select ok(
  NOT EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'different_non_null_trigger_excluded'
      AND c->>'job_id' = d.target_job_id::text
  ),
  'different_non_null_trigger_excluded requires exact trigger_choice_id equality'
);

-- ===========================================================================
-- ASSERTION GROUP 4: CANDIDATE STRUCTURE VALIDATION
-- ===========================================================================

-- Validate required fields present in included test cases
select is(
  (SELECT c->>'status' FROM discovery_test_results d, jsonb_array_elements(d.result->'candidates') c
   WHERE d.case_name = 'failed_story_with_binding_active_reservation'
     AND c->>'job_id' = d.target_job_id::text),
  'FAILED',
  'included candidate has correct status field'
);

select is(
  (SELECT c->>'generation_kind' FROM discovery_test_results d, jsonb_array_elements(d.result->'candidates') c
   WHERE d.case_name = 'cancelled_chapter_with_binding_active_reservation'
     AND c->>'job_id' = d.target_job_id::text),
  'personalized',
  'included candidate has correct generation_kind field'
);

-- Verify all 5 required fields from TypeScript wrapper exist in candidates
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'failed_story_with_binding_active_reservation'
      AND c ? 'job_id'
      AND c ? 'user_id'
      AND c ? 'story_id'
      AND c ? 'chapter_number'
      AND c ? 'status'
  ),
  'candidate contains all 5 required fields from TypeScript interface'
);

-- Validate optional fields may exist even if values are null
-- generation_kind should be present with actual value
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'cancelled_chapter_with_binding_active_reservation'
      AND c ? 'generation_kind'
      AND c->>'generation_kind' IS NOT NULL
  ),
  'candidate has exposed generation_kind field with actual value'
);

-- trigger_choice_id key exists but VALUE may be NULL (e.g., STORY_START paths)
select ok(
  EXISTS (
    SELECT 1 FROM discovery_test_results d
    CROSS JOIN LATERAL jsonb_array_elements(d.result->'candidates') c
    WHERE d.case_name = 'failed_story_with_binding_active_reservation'
      AND c ? 'trigger_choice_id'
  ),
  'candidate has exposed trigger_choice_id key (value may be NULL)'
);

select * from finish();
rollback;
