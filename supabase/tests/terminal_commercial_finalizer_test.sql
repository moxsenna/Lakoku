-- Terminal Commercial Finalization Tests (pgTAP)
-- 
-- Tests for PRODUCT P0 fix: RELEASE ACTIVE reservations on terminal FAILED/CANCELLED jobs

SELECT plan(18)

-- Setup: Create test job and reservation for STORY_START
select set_config('search_path', 'test,' || current_setting('search_path'), false);

-- Test 1: STORY_START ACTIVE + FAILED -> RELEASED
do $$
declare
  v_job_id uuid;
  v_reservation_id uuid;
  v_result jsonb;
begin
  -- Create reservation
  insert into credit_reservations (id, user_id, story_id, ref, reservation_kind, amount, status)
  values ('a0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-1',
    'story-start:auth.users.id:test-story-1', 'STORY_START', 24, 'ACTIVE')
  returning id into v_reservation_id;
  
  -- Create job
  insert into generation_jobs (id, owner_user_id, story_id, request_kind, chapter_number, status, attempt_count, max_attempts, last_error_code)
  values ('b0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-1',
    'personalized', null, 'RUNNING', 0, 3, null)
  returning id into v_job_id;
  
  -- Run finalizer with FAILED state
  v_result := public.finalize_terminal_commercial_generation_v1('b0000000-0000-4000-8000-000000000001'::uuid);
  
  perform is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'finalization returns ok=true');
  perform is(jsonb_extract_path(v_result, 'operation')::text, 'STORY_START', 'operation is STORY_START');
  perform is(jsonb_extract_path(v_result, 'ref')::text, 'story-start:auth.users.id:test-story-1', 'correct canonical ref');
  
  -- Verify reservation released
  perform is(
    (select status from credit_reservations where id = v_reservation_id)::text,
    'RELEASED',
    'reservation status changed to RELEASED'
  );
end $$;

-- Test 2: CHAPTER_UNLOCK ACTIVE + CANCELLED -> RELEASED
do $$
declare
  v_job_id uuid;
  v_reservation_id uuid;
  v_result jsonb;
begin
  insert into credit_reservations (id, user_id, story_id, ref, reservation_kind, amount, status, chapter_number)
  values ('c0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-2',
    'chapter-reservation:auth.users.id:test-story-2:3', 'CHAPTER_UNLOCK', 8, 'ACTIVE', 3)
  returning id into v_reservation_id;
  
  insert into generation_jobs (id, owner_user_id, story_id, request_kind, chapter_number, status, last_error_code)
  values ('d0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-2',
    'choice', 3, 'CANCELLED', 'GENERATION_CANCELLED')
  returning id into v_job_id;
  
  v_result := public.finalize_terminal_commercial_generation_v1('d0000000-0000-4000-8000-000000000001'::uuid);
  
  perform is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'finalization returns ok=true');
  perform is(jsonb_extract_path(v_result, 'operation')::text, 'CHAPTER_UNLOCK', 'operation is CHAPTER_UNLOCK');
  perform is((jsonb_extract_path(v_result, 'chapter_number')::integer)::text, '3', 'correct chapter number');
  
  perform is(
    (select status from credit_reservations where id = v_reservation_id)::text,
    'RELEASED',
    'CHAPTER_UNLOCK reservation released on CANCELLED'
  );
end $$;

-- Test 3: Idempotent - RELEASED + FAILED -> already_released
do $$
declare
  v_job_id uuid;
  v_result jsonb;
begin
  insert into generation_jobs (id, owner_user_id, story_id, request_kind, chapter_number, status, last_error_code)
  values ('e0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-3',
    'personalized', null, 'FAILED', 'MAX_ATTEMPTS_EXCEEDED')
  returning id into v_job_id;
  
  -- Already has RELEASED reservation
  insert into credit_reservations (id, user_id, story_id, ref, reservation_kind, amount, status, released_at)
  values ('f0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-3',
    'story-start:auth.users.id:test-story-3', 'STORY_START', 24, 'RELEASED', now());
  
  v_result := public.finalize_terminal_commercial_generation_v1('e0000000-0000-4000-8000-000000000001'::uuid);
  
  perform is(jsonb_extract_path(v_result, 'ok')::text, 'true', 'second call also returns ok=true');
  perform is(jsonb_extract_path(v_result, 'already_released')::text, 'true', 'already_released flag set');
end $$;

-- Test 4: CAPTURED state should NOT release (invariant violation)
do $$
declare
  v_job_id uuid;
  v_reservation_id uuid;
  v_result jsonb;
begin
  insert into credit_reservations (id, user_id, story_id, ref, reservation_kind, amount, status)
  values ('g0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-4',
    'story-start:auth.users.id:test-story-4', 'STORY_START', 24, 'CAPTURED')
  returning id into v_reservation_id;
  
  insert into generation_jobs (id, owner_user_id, story_id, request_kind, chapter_number, status, last_error_code)
  values ('h0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-4',
    'personalized', null, 'FAILED', 'CHOICE_GENERATION_FAILED')
  returning id into v_job_id;
  
  v_result := public.finalize_terminal_commercial_generation_v1('h0000000-0000-4000-8000-000000000001'::uuid);
  
  perform is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'returns ok=false for CAPTURED invariant');
  perform is(jsonb_extract_path(v_result, 'reason')::text, 'CAPTURED_INARIANT_VIOLATION', 'correct reason');
  
  -- Reservation stays CAPTURED
  perform is(
    (select status from credit_reservations where id = v_reservation_id)::text,
    'CAPTURED',
    'CAPTURED reservation not modified'
  );
end $$;

-- Test 5: Non-terminal state RUNNING -> no release
do $$
declare
  v_job_id uuid;
  v_reservation_id uuid;
  v_result jsonb;
begin
  insert into credit_reservations (id, user_id, story_id, ref, reservation_kind, amount, status)
  values ('i0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-5',
    'story-start:auth.users.id:test-story-5', 'STORY_START', 24, 'ACTIVE')
  returning id into v_reservation_id;
  
  insert into generation_jobs (id, owner_user_id, story_id, request_kind, chapter_number, status)
  values ('j0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-5',
    'personalized', null, 'RUNNING');
  
  v_result := public.finalize_terminal_commercial_generation_v1('j0000000-0000-4000-8000-000000000001'::uuid);
  
  perform is(jsonb_extract_path(v_result, 'ok')::text, 'false', 'returns ok=false for RUNNING');
  perform is(jsonb_extract_path(v_result, 'reason')::text, 'NON_TERMINAL_STATE', 'correct reason');
  
  -- Reservation stays ACTIVE
  perform is(
    (select status from credit_reservations where id = v_reservation_id)::text,
    'ACTIVE',
    'ACTIVE reservation not modified for RUNNING job'
  );
end $$;

-- Test 6: Reconciliation RPC catches orphaned ACTIVE reservations
do $$
declare
  v_job_id uuid;
  v_reservation_id uuid;
  v_result jsonb;
  v_count integer;
begin
  -- Create terminal job with orphaned ACTIVE reservation
  insert into generation_jobs (id, owner_user_id, story_id, request_kind, chapter_number, status, last_error_code)
  values ('k0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-6',
    'personalized', null, 'FAILED', 'MAX_ATTEMPTS_EXCEEDED');
  
  insert into credit_reservations (id, user_id, story_id, ref, reservation_kind, amount, status)
  values ('l0000000-0000-4000-8000-000000000001'::uuid, auth.users.id, 'test-story-6',
    'story-start:auth.users.id:test-story-6', 'STORY_START', 24, 'ACTIVE');
  
  v_result := public.reconcile_terminal_commercial_reservations_v1(10);
  
  perform is(jsonb_extract_path(v_result, 'reconciled_count')::integer, 1, 'reconciliation finds orphan');
  
  select count(*) into v_count
  from credit_reservations
  where status = 'RELEASED' and release_reason = 'RECONCILIATION';
  
  perform is(v_count::text, '1', 'orphaned reservation reconciled to RELEASED');
end $$;

select * from finish();
