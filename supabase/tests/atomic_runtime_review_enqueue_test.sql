-- pgTAP tests for enqueue_runtime_review_v1
-- Tests exact atomic emission of GENERATION_ATTEMPT and blueprint_queue binding, replay, mismatch, rearm, and lock isolation.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'atomic runtime review enqueue tests require local-cli';
  end if;
end
$$;

-- 1. Privilege assertions
-- PUBLIC, anon, and authenticated roles must lack execute; service_role must have execute.
select ok(
  not has_function_privilege('public', 'public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid)', 'EXECUTE'),
  'public lacks execute on enqueue_runtime_review_v1'
);

select ok(
  not has_function_privilege('anon', 'public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid)', 'EXECUTE'),
  'anon lacks execute on enqueue_runtime_review_v1'
);

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid)', 'EXECUTE'),
  'authenticated lacks execute on enqueue_runtime_review_v1'
);

select ok(
  has_function_privilege('service_role', 'public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid)', 'EXECUTE'),
  'service_role has execute on enqueue_runtime_review_v1'
);

-- Setup test owner and stories
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e5000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
  'enqueue-test-owner@example.invalid', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

insert into public.stories (id, title, owner_user_id) values
  ('test:enqueue-story-1', 'Enqueue Story 1', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-ch15', 'Enqueue Story Ch15', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-ch16', 'Enqueue Story Ch16', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-ch35', 'Enqueue Story Ch35', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-ch36', 'Enqueue Story Ch36', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-ch50', 'Enqueue Story Ch50', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-bigint', 'Enqueue Story Bigint', 'e5000000-0000-4000-8000-000000000010'),
  ('test:enqueue-story-rearm', 'Enqueue Story Rearm', 'e5000000-0000-4000-8000-000000000010');

-- 2. Service-role enqueue success test
set local role service_role;

select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-1',
      3,
      2,
      '[{"code":"PROSE_LEAK","severity":"CRITICAL"}]'::jsonb,
      'test:key:1',
      'corr-123',
      'call-456',
      'hash-789',
      null
    )->>'ok'
  ),
  'true',
  'enqueue_runtime_review_v1 succeeds on first attempt'
);

-- Check story_events has GENERATION_ATTEMPT event
select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'creates exactly one GENERATION_ATTEMPT story event'
);

-- Check blueprint_queue row is created with matching source_event_id
select is(
  (select status from public.blueprint_queue where story_id = 'test:enqueue-story-1'),
  'PENDING',
  'creates PENDING blueprint_queue row'
);

select is(
  (select generation_status from public.stories where id = 'test:enqueue-story-1'),
  'needs_review',
  'atomically latches story generation admission'
);

select is(
  (select source_event_id from public.blueprint_queue where story_id = 'test:enqueue-story-1'),
  (select id from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT' limit 1),
  'blueprint_queue source_event_id exactly matches generated story_event id'
);

-- 3. Exact replay test & lease insensitivity
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-1',
      3,
      2,
      '[{"code":"PROSE_LEAK","severity":"CRITICAL"}]'::jsonb,
      'test:key:1',
      'corr-123',
      'call-456',
      'hash-789',
      null
    )->>'ok'
  ),
  'true',
  'exact idempotency replay succeeds'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'exact replay does not duplicate story event'
);

select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-1',
      3,
      2,
      '[{"code":"PROSE_LEAK","severity":"CRITICAL"}]'::jsonb,
      'test:key:1',
      'corr-123',
      'call-456',
      'hash-789',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    )->>'ok'
  ),
  'true',
  'same logical incident replays across an ephemeral lease change'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'lease-insensitive replay does not duplicate story event'
);

-- 4. Idempotency payload mismatch test
prepare throws_mismatch as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1',
  4, -- mismatched chapter
  2,
  '[{"code":"PROSE_LEAK","severity":"CRITICAL"}]'::jsonb,
  'test:key:1',
  'corr-123',
  'call-456',
  'hash-789',
  null
);

select throws_ok(
  'throws_mismatch',
  '23505',
  'IDEMPOTENCY_CONFLICT',
  'mismatched payload for same idempotency key raises IDEMPOTENCY_CONFLICT'
);

-- 5. Active queue conflict tests (PENDING, CLAIMED, BLOCKED) with side-effect verification
-- 5a. PENDING queue conflict
prepare throws_pending_conflict as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1',
  3,
  1,
  '[]'::jsonb,
  'test:key:distinct-pending',
  'corr-pending',
  null,
  null,
  null
);

select throws_ok(
  'throws_pending_conflict',
  'P0001',
  'BLUEPRINT_QUEUE_ACTIVE_CONFLICT',
  'distinct review enqueue while queue is PENDING raises BLUEPRINT_QUEUE_ACTIVE_CONFLICT'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'pending queue conflict produces no story event side effect'
);

select is(
  (select count(*) from public.idempotency_keys where key = 'test:key:distinct-pending'),
  0::bigint,
  'pending queue conflict produces no idempotency key entry'
);

-- 5b. CLAIMED queue conflict
update public.blueprint_queue
set status = 'CLAIMED',
    claimed_by = 'e5000000-0000-4000-8000-000000000010',
    claimed_at = pg_catalog.clock_timestamp()
where story_id = 'test:enqueue-story-1';

prepare throws_claimed_conflict as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1',
  3,
  1,
  '[]'::jsonb,
  'test:key:distinct-claimed',
  'corr-claimed',
  null,
  null,
  null
);

select throws_ok(
  'throws_claimed_conflict',
  'P0001',
  'BLUEPRINT_QUEUE_ACTIVE_CONFLICT',
  'distinct review enqueue while queue is CLAIMED raises BLUEPRINT_QUEUE_ACTIVE_CONFLICT'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'claimed queue conflict produces no story event side effect'
);

select is(
  (select count(*) from public.idempotency_keys where key = 'test:key:distinct-claimed'),
  0::bigint,
  'claimed queue conflict produces no idempotency key entry'
);

select is(
  (select status from public.blueprint_queue where story_id = 'test:enqueue-story-1'),
  'CLAIMED',
  'claimed queue status remains unchanged after conflict'
);

-- 5c. BLOCKED queue conflict
update public.blueprint_queue
set status = 'BLOCKED',
    claimed_by = null,
    claimed_at = null
where story_id = 'test:enqueue-story-1';

prepare throws_blocked_conflict as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1',
  3,
  1,
  '[]'::jsonb,
  'test:key:distinct-blocked',
  'corr-blocked',
  null,
  null,
  null
);

select throws_ok(
  'throws_blocked_conflict',
  'P0001',
  'BLUEPRINT_QUEUE_ACTIVE_CONFLICT',
  'distinct review enqueue while queue is BLOCKED raises BLUEPRINT_QUEUE_ACTIVE_CONFLICT'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'blocked queue conflict produces no story event side effect'
);

select is(
  (select count(*) from public.idempotency_keys where key = 'test:key:distinct-blocked'),
  0::bigint,
  'blocked queue conflict produces no idempotency key entry'
);

select is(
  (select status from public.blueprint_queue where story_id = 'test:enqueue-story-1'),
  'BLOCKED',
  'blocked queue status remains unchanged after conflict'
);

-- 6. Act boundary mapping tests (chapters 15, 16, 35, 36, 50)
-- Chapter 15 -> ACT_1
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-ch15',
      15,
      0,
      '[]'::jsonb,
      'test:key:act-ch15',
      null, null, null, null
    )->>'ok'
  ),
  'true',
  'chapter 15 enqueue succeeds'
);

select is(
  (select act_boundary from public.blueprint_queue where story_id = 'test:enqueue-story-ch15'),
  'ACT_1',
  'chapter 15 maps exactly to ACT_1 boundary'
);

-- Chapter 16 -> ACT_2
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-ch16',
      16,
      0,
      '[]'::jsonb,
      'test:key:act-ch16',
      null, null, null, null
    )->>'ok'
  ),
  'true',
  'chapter 16 enqueue succeeds'
);

select is(
  (select act_boundary from public.blueprint_queue where story_id = 'test:enqueue-story-ch16'),
  'ACT_2',
  'chapter 16 maps exactly to ACT_2 boundary'
);

-- Chapter 35 -> ACT_2
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-ch35',
      35,
      0,
      '[]'::jsonb,
      'test:key:act-ch35',
      null, null, null, null
    )->>'ok'
  ),
  'true',
  'chapter 35 enqueue succeeds'
);

select is(
  (select act_boundary from public.blueprint_queue where story_id = 'test:enqueue-story-ch35'),
  'ACT_2',
  'chapter 35 maps exactly to ACT_2 boundary'
);

-- Chapter 36 -> ACT_3
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-ch36',
      36,
      0,
      '[]'::jsonb,
      'test:key:act-ch36',
      null, null, null, null
    )->>'ok'
  ),
  'true',
  'chapter 36 enqueue succeeds'
);

select is(
  (select act_boundary from public.blueprint_queue where story_id = 'test:enqueue-story-ch36'),
  'ACT_3',
  'chapter 36 maps exactly to ACT_3 boundary'
);

-- Chapter 50 -> ACT_3
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-ch50',
      50,
      0,
      '[]'::jsonb,
      'test:key:act-ch50',
      null, null, null, null
    )->>'ok'
  ),
  'true',
  'chapter 50 enqueue succeeds'
);

select is(
  (select act_boundary from public.blueprint_queue where story_id = 'test:enqueue-story-ch50'),
  'ACT_3',
  'chapter 50 maps exactly to ACT_3 boundary'
);

-- 7. BIGINT event id above JavaScript MAX_SAFE_INTEGER (9007199254740991)
-- Asserts decimal text JSON return, queue source_event_id binding, and idempotency ledger fidelity.
select pg_catalog.setval('public.story_events_id_seq', 9007199254740995, false);

select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-bigint',
      10,
      1,
      '[{"code":"PROSE_LEAK","severity":"CRITICAL"}]'::jsonb,
      'test:key:bigint-1',
      'corr-bigint',
      null,
      null,
      null
    )->>'source_event_id'
  ),
  '9007199254740995',
  'BIGINT event id above safe integer limit returned as exact decimal text'
);

select is(
  (select id::text from public.story_events where story_id = 'test:enqueue-story-bigint'),
  '9007199254740995',
  'story_events persists exact BIGINT id exceeding safe integer limit'
);

select is(
  (select source_event_id::text from public.blueprint_queue where story_id = 'test:enqueue-story-bigint'),
  '9007199254740995',
  'blueprint_queue persists exact BIGINT source_event_id binding'
);

select is(
  (select result->'safeResult'->>'source_event_id' from public.idempotency_keys where key = 'test:key:bigint-1'),
  '9007199254740995',
  'idempotency ledger records exact BIGINT decimal text'
);

select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-bigint',
      10,
      1,
      '[{"code":"PROSE_LEAK","severity":"CRITICAL"}]'::jsonb,
      'test:key:bigint-1',
      'corr-bigint',
      null,
      null,
      null
    )->>'source_event_id'
  ),
  '9007199254740995',
  'exact replay of BIGINT event returns matching decimal text'
);

-- 8. RESOLVED rearm preserves prior story_events and resolution rows
-- First enqueue
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-rearm',
      5,
      1,
      '[{"code":"ENDING_NOT_LOCKED","severity":"CRITICAL"}]'::jsonb,
      'test:key:rearm-first',
      'corr-rearm-1',
      null,
      null,
      null
    )->>'ok'
  ),
  'true',
  'initial enqueue for rearm test succeeds'
);

-- Fixture setup uses transaction owner; service_role intentionally cannot insert resolutions directly.
reset role;
insert into public.blueprint_resolutions (
  story_id,
  source_event_id,
  disposition,
  reviewer_uid,
  reason_text,
  chapter_numbers,
  request_fingerprint,
  result_chapter_version_pairs,
  created_at
) values (
  'test:enqueue-story-rearm',
  (select source_event_id from public.blueprint_queue where story_id = 'test:enqueue-story-rearm'),
  'RETRY_ALLOW',
  'e5000000-0000-4000-8000-000000000010',
  'Authorized retry resolution for rearm test',
  array[5],
  'fp:rearm:resolution:1',
  '[]'::jsonb,
  pg_catalog.clock_timestamp()
);

-- Update queue to RESOLVED (trigger normalizes admission to ready)
update public.blueprint_queue
set status = 'RESOLVED'
where story_id = 'test:enqueue-story-rearm';

select is(
  (select generation_status from public.stories where id = 'test:enqueue-story-rearm'),
  'ready',
  'resolution trigger updates story generation admission to ready'
);

-- Rearm review enqueue for chapter 7
select is(
  (
    select public.enqueue_runtime_review_v1(
      'test:enqueue-story-rearm',
      7,
      2,
      '[{"code":"BRANCH_TARGET_INVALID","severity":"CRITICAL"}]'::jsonb,
      'test:key:rearm-second',
      'corr-rearm-2',
      null,
      null,
      null
    )->>'ok'
  ),
  'true',
  'rearms resolved queue to PENDING'
);

select is(
  (select status from public.blueprint_queue where story_id = 'test:enqueue-story-rearm'),
  'PENDING',
  'queue status is PENDING after rearm'
);

select is(
  (select chapter_numbers from public.blueprint_queue where story_id = 'test:enqueue-story-rearm'),
  array[7],
  'queue chapter numbers updated to [7] after rearm'
);

select is(
  (select act_boundary from public.blueprint_queue where story_id = 'test:enqueue-story-rearm'),
  'ACT_1',
  'chapter 7 uses ACT_1 boundary'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-rearm' and type = 'GENERATION_ATTEMPT'),
  2::bigint,
  'rearm preserves prior GENERATION_ATTEMPT and appends second event'
);

select is(
  (select count(*) from public.blueprint_resolutions where story_id = 'test:enqueue-story-rearm'),
  1::bigint,
  'rearm preserves prior blueprint_resolutions row exactly'
);

select is(
  (select source_event_id from public.blueprint_resolutions where story_id = 'test:enqueue-story-rearm'),
  (select id from public.story_events where story_id = 'test:enqueue-story-rearm' and seq = 1),
  'prior resolution maintains binding to original first event id'
);

select is(
  (select source_event_id from public.blueprint_queue where story_id = 'test:enqueue-story-rearm'),
  (select id from public.story_events where story_id = 'test:enqueue-story-rearm' and seq = 2),
  'rearmed queue source_event_id exactly matches new second event id'
);

select is(
  (select generation_status from public.stories where id = 'test:enqueue-story-rearm'),
  'needs_review',
  'rearm latches story generation admission back to needs_review'
);

-- 9. Payload validation & malformed finding rejection
prepare rejects_message_field as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1',
  16,
  1,
  '[{"code":"UNSAFE","severity":"CRITICAL","message":"raw detail"}]'::jsonb,
  'test:key:unsafe-message',
  null,
  null,
  null,
  null
);

select throws_ok(
  'rejects_message_field',
  '22023',
  'INVALID_FINDING',
  'finding payload rejects message or detail fields'
);

prepare rejects_null_code as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1', 16, 1,
  '[{"code":null,"severity":"CRITICAL"}]'::jsonb,
  'test:key:null-code', null, null, null, null
);
select throws_ok(
  'rejects_null_code', '22023', 'INVALID_FINDING',
  'finding payload rejects null code'
);

prepare rejects_null_severity as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1', 16, 1,
  '[{"code":"UNSAFE","severity":null}]'::jsonb,
  'test:key:null-severity', null, null, null, null
);
select throws_ok(
  'rejects_null_severity', '22023', 'INVALID_FINDING',
  'finding payload rejects null severity'
);

prepare rejects_non_string_code as
select public.enqueue_runtime_review_v1(
  'test:enqueue-story-1', 16, 1,
  '[{"code":42,"severity":"CRITICAL"}]'::jsonb,
  'test:key:numeric-code', null, null, null, null
);
select throws_ok(
  'rejects_non_string_code', '22023', 'INVALID_FINDING',
  'finding payload rejects non-string code'
);

select is(
  (select count(*) from public.story_events where story_id = 'test:enqueue-story-1' and type = 'GENERATION_ATTEMPT'),
  1::bigint,
  'all malformed finding payloads leave event count unchanged'
);

select is(
  (select generation_status from public.stories where id = 'test:enqueue-story-1'),
  'needs_review',
  'failed enqueue attempts preserve existing review latch'
);

-- 10. Concurrency Isolation Note:
-- Real-time concurrent transaction isolation and advisory lock contention cannot be tested
-- in a single pgTAP transaction. A separate multi-connection harness is required to simulate
-- concurrent rival worker enqueues and verify deterministic serial execution under lock seed 120712.

select * from finish();
rollback;
