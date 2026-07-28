-- Functional tests for publish_generation_job_chapter_v4.
-- Error paths: tested here (errors raise before publish_chapter_v2).
-- Happy path: tested here with valid choice fixtures.
-- Omission/deadline: tested here via closure validation path.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(40);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Setup: story + reader + contract + job + lease + checkpoint fixtures
-- ═══════════════════════════════════════════════════════════════════════════════

-- Minimal story + reader
insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
values ('test:v4-fn', 'V4 Functional', '00000000-0000-0000-0000-000000000001', 'private', 'personalized_ai', 1);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('00000000-0000-0000-0000-000000000001', 'test:v4-fn', 'BERJALAN', 10);

-- Contract with one debt
insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
values ('test:v4-fn', 'personalized_ai', 50,
  '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb,
  1);

-- Running job (personalized, ch 10)
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test:v4-fn', 10,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:publish:10',
  1
);

-- Lease
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'test:v4-fn', 10, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
);

-- Checkpoint (V2, personalized, PROSE_READY)
insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint,
  audit_signals_json, audit_signals_version,
  canon_version, blueprint_version, direction_fingerprint,
  generation_mode, generation_policy_version, prompt_contract_version,
  job_id, job_attempt_number, checkpoint_schema_version,
  prose_attempt_count, choice_attempt_count, expires_at,
  story_contract_version
) values (
  'test:v4-fn', 10, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select correlation_id from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'PROSE_READY', 'Test Chapter', '["Paragraph one."]'::jsonb,
  'fp123456789012345678901234567890',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  2, 5, 2, 'dir1234567890123456789012345678', 'personalized', 2, 2,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);

-- Standard job (for standard mode tests)
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'test:v4-fn', 5,
  '00000000-0000-0000-0000-000000000001', 'standard',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:cccccccc-cccc-cccc-cccc-cccccccccccc:publish:5'
);

insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'test:v4-fn', 5, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (select claim_token from public.generation_jobs where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- V4 function exists with correct signature
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(has_function('public', 'publish_generation_job_chapter_v4',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb','text','text','jsonb']),
  'V4 function exists with 14-param signature');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: job-level errors
-- ═══════════════════════════════════════════════════════════════════════════════

-- GENERATION_JOB_NOT_FOUND
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    '00000000-0000-0000-0000-999999999999'::uuid, 'worker', gen_random_uuid(), gen_random_uuid(),
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'GENERATION_JOB_NOT_FOUND');

-- GENERATION_JOB_NOT_RUNNING (job is SUCCEEDED)
update public.generation_jobs set status = 'SUCCEEDED' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'GENERATION_JOB_NOT_RUNNING');
-- Restore to RUNNING
update public.generation_jobs set status = 'RUNNING' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: personalized contract provenance
-- ═══════════════════════════════════════════════════════════════════════════════

-- CONTRACT_PROVENANCE_MISSING (legacy job with NULL version)
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'test:v4-fn', 11,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee:publish:11'
);
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff', 'test:v4-fn', 11, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (select claim_token from public.generation_jobs where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
);

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
    'test:v4-fn', 11, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CONTRACT_PROVENANCE_MISSING');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: checkpoint binding
-- ═══════════════════════════════════════════════════════════════════════════════

-- CHECKPOINT_NOT_FOUND (no checkpoint for this job)
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  '11111111-1111-1111-1111-111111111111', 'test:v4-fn', 12,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:11111111-1111-1111-1111-111111111111:publish:12',
  1
);
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  '22222222-2222-2222-2222-222222222222', 'test:v4-fn', 12, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  '11111111-1111-1111-1111-111111111111',
  (select claim_token from public.generation_jobs where id = '11111111-1111-1111-1111-111111111111')
);

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    '11111111-1111-1111-1111-111111111111'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = '11111111-1111-1111-1111-111111111111'),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'test:v4-fn', 12, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CHECKPOINT_NOT_FOUND');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: standard mode + closures
-- ═══════════════════════════════════════════════════════════════════════════════

-- Standard job with closures → INVALID_CLOSURE_PAYLOAD
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'test:v4-fn', 5, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[{"debtId":"x","closureForm":"RESOLVED"}]'::jsonb
  )
$$, '22023', null, 'standard mode rejects closures');

-- Standard job with null closures → passes standard branch (will fail at publication, not closure check)
-- This tests that standard mode skips closure validation entirely.
-- The error should be from publish_chapter_v2 (e.g. INVALID_TITLE), NOT from closure logic.
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'test:v4-fn', 5, '', '[]'::jsonb, '', '[]'::jsonb, '[]'::jsonb,
    null, null, null::jsonb
  )
$$, '22023', null, 'standard mode reaches publication (empty title rejected by publish_chapter_v2)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: INVALID_CLOSURE_PAYLOAD
-- ═══════════════════════════════════════════════════════════════════════════════

-- Malformed closure: missing closureForm
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[{"debtId":"main_mystery"}]'::jsonb
  )
$$, '22023', null, 'INVALID_CLOSURE_PAYLOAD: missing closureForm');

-- Duplicate debtId
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[{"debtId":"d","closureForm":"RESOLVED"},{"debtId":"d","closureForm":"RESOLVED"}]'::jsonb
  )
$$, '22023', null, 'INVALID_CLOSURE_PAYLOAD: duplicate debtId');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: checkpoint binding
-- ═══════════════════════════════════════════════════════════════════════════════

-- CHECKPOINT_INVALID_STATE: wrong status (EXPIRED instead of PROSE_READY)
update public.chapter_generation_checkpoints
set status = 'EXPIRED'
where story_id = 'test:v4-fn' and chapter_number = 10;
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CHECKPOINT_INVALID_STATE: EXPIRED status');
-- Restore
update public.chapter_generation_checkpoints
set status = 'PROSE_READY'
where story_id = 'test:v4-fn' and chapter_number = 10;

-- CHECKPOINT_ATTEMPT_AHEAD: checkpoint attempt > job attempt
update public.chapter_generation_checkpoints
set job_attempt_number = 99
where story_id = 'test:v4-fn' and chapter_number = 10;
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CHECKPOINT_ATTEMPT_AHEAD');
-- Restore
update public.chapter_generation_checkpoints
set job_attempt_number = 1
where story_id = 'test:v4-fn' and chapter_number = 10;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: contract version mismatch
-- ═══════════════════════════════════════════════════════════════════════════════

-- CONTRACT_VERSION_MISMATCH: story contract version changed since job enqueued
update public.stories set story_contract_version = 99 where id = 'test:v4-fn';
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CONTRACT_VERSION_MISMATCH');
-- Restore
update public.stories set story_contract_version = 1 where id = 'test:v4-fn';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: ownership lost
-- ═══════════════════════════════════════════════════════════════════════════════

-- GENERATION_JOB_OWNERSHIP_LOST: wrong worker
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'wrong-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'GENERATION_JOB_OWNERSHIP_LOST');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: closure omission deadline
-- ═══════════════════════════════════════════════════════════════════════════════

-- DEBT_CLOSURE_DEADLINE_VIOLATION (omission): debt mustCloseBy=48, current ch=48, not closed
-- Need a job at ch 48 with contract having debt mustCloseBy=48.
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  '33333333-3333-3333-3333-333333333333', 'test:v4-fn', 48,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:33333333-3333-3333-3333-333333333333:publish:48',
  1
);
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  '44444444-4444-4444-4444-444444444444', 'test:v4-fn', 48, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  '33333333-3333-3333-3333-333333333333',
  (select claim_token from public.generation_jobs where id = '33333333-3333-3333-3333-333333333333')
);
insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint,
  audit_signals_json, audit_signals_version,
  canon_version, blueprint_version, direction_fingerprint,
  generation_mode, generation_policy_version, prompt_contract_version,
  job_id, job_attempt_number, checkpoint_schema_version,
  prose_attempt_count, choice_attempt_count, expires_at,
  story_contract_version
) values (
  'test:v4-fn', 48, '33333333-3333-3333-3333-333333333333',
  (select correlation_id from public.generation_jobs where id = '33333333-3333-3333-3333-333333333333'),
  'PROSE_READY', 'Ch 48', '["P"]'::jsonb, 'fp48',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  2, 5, 2, 'dir48', 'personalized', 2, 2,
  '33333333-3333-3333-3333-333333333333', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);

-- Debt "main_mystery" has mustCloseBy=48. At ch 48 with empty closures → omission deadline.
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    '33333333-3333-3333-3333-333333333333'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = '33333333-3333-3333-3333-333333333333'),
    '44444444-4444-4444-4444-444444444444'::uuid,
    'test:v4-fn', 48, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'DEBT_CLOSURE_DEADLINE_VIOLATION: omission at mustCloseBy');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH
-- ═══════════════════════════════════════════════════════════════════════════════

-- Checkpoint has closesPlotDebts with a closure, but p_closures is empty → mismatch
update public.chapter_generation_checkpoints
set audit_signals_json = '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"main_mystery","closureForm":"RESOLVED"}]}'::jsonb
where story_id = 'test:v4-fn' and chapter_number = 10;
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH');
-- Restore
update public.chapter_generation_checkpoints
set audit_signals_json = '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb
where story_id = 'test:v4-fn' and chapter_number = 10;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Happy path: personalized publication + closure ledger atomicity
-- ═══════════════════════════════════════════════════════════════════════════════

-- V4 happy path with ACTUAL closures: chapter published, closure ledger written,
-- checkpoint PUBLISHED, job SUCCEEDED, lease RELEASED, both hashes stored.

-- Set checkpoint audit signals to match the closure we will pass.
update public.chapter_generation_checkpoints
set audit_signals_json = '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"main_mystery","closureForm":"RESOLVED"}]}'::jsonb
where story_id = 'test:v4-fn' and chapter_number = 10;

select lives_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10,
    'Bab Sepuluh',
    '["Raka membuka pintu gudang dengan hati-hati."]'::jsonb,
    'Apa yang Raka lakukan sekarang?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
    '[{"choiceId":"open-door","consequence":["Pintu arsip terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
    null, null,
    '[{"debtId":"main_mystery","closureForm":"RESOLVED"}]'::jsonb
  )
$$, 'V4 happy path: personalized publication with closure succeeds');

-- 1. Chapter published exactly once
select is(
  (select count(*)::integer from public.chapters where story_id = 'test:v4-fn' and number = 10),
  1, 'happy path: chapter 10 published exactly once');

-- 2. Closure ledger: exactly one row (matches proposal count)
select is(
  (select count(*)::integer from public.reader_plot_debt_closures
   where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'),
  1, 'happy path: closure ledger has exactly 1 row');

-- 3. Closure ledger: debt_id correct
select is(
  (select debt_id from public.reader_plot_debt_closures
   where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'),
  'main_mystery', 'happy path: closure debt_id correct');

-- 4. Closure ledger: closure_form correct
select is(
  (select closure_form from public.reader_plot_debt_closures
   where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'),
  'RESOLVED', 'happy path: closure_form correct');

-- 5. Closure ledger: closed_at_chapter correct
select is(
  (select closed_at_chapter from public.reader_plot_debt_closures
   where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'),
  10, 'happy path: closed_at_chapter correct');

-- 6. Closure ledger: closed_by_job_id matches V4 job
select is(
  (select closed_by_job_id from public.reader_plot_debt_closures
   where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'happy path: closed_by_job_id correct');

-- 7. Job SUCCEEDED
select is(
  (select status from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'SUCCEEDED', 'happy path: job status SUCCEEDED');

-- 8. Lease RELEASED
select is(
  (select status from public.generation_leases where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'RELEASED', 'happy path: lease RELEASED');

-- 9. Checkpoint PUBLISHED
select is(
  (select status from public.chapter_generation_checkpoints where story_id = 'test:v4-fn' and chapter_number = 10),
  'PUBLISHED', 'happy path: checkpoint PUBLISHED');

-- 10. publication_payload_hash stored (64-char hex)
select matches(
  (select publication_payload_hash from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '^[0-9a-f]{64}$', 'happy path: publication_payload_hash stored');

-- 11. closure_payload_hash stored (64-char hex)
select matches(
  (select closure_payload_hash from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '^[0-9a-f]{64}$', 'happy path: closure_payload_hash stored');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Atomic rollback + dual-hash regression
-- Uses a SEPARATE story (test:v4-atomic) to avoid closure ledger conflicts
-- with the happy path above.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Separate story + reader + contract (no debt → empty closures only, avoids ledger conflicts).
insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
values ('test:v4-atomic', 'V4 Atomic', '00000000-0000-0000-0000-000000000001', 'private', 'personalized_ai', 1);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('00000000-0000-0000-0000-000000000001', 'test:v4-atomic', 'BERJALAN', 20);

insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
values ('test:v4-atomic', 'personalized_ai', 50, '[]'::jsonb, 1);

-- ─── Atomic rollback: ledger insert failure → entire V4 rolls back ───

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  'aa000000-0000-0000-0000-0000000000aa', 'test:v4-atomic', 20,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:aa000000-0000-0000-0000-0000000000aa:publish:20',
  1
);

insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'bb000000-0000-0000-0000-0000000000bb', 'test:v4-atomic', 20, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'aa000000-0000-0000-0000-0000000000aa',
  (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa')
);

-- Checkpoint with empty closures (no debt to close → closure validation passes).
insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint,
  audit_signals_json, audit_signals_version,
  canon_version, blueprint_version, direction_fingerprint,
  generation_mode, generation_policy_version, prompt_contract_version,
  job_id, job_attempt_number, checkpoint_schema_version,
  prose_attempt_count, choice_attempt_count, expires_at,
  story_contract_version
) values (
  'test:v4-atomic', 20, 'aa000000-0000-0000-0000-0000000000aa',
  (select correlation_id from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
  'PROSE_READY', 'Ch20', '["Para 20."]'::jsonb, 'fp20',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  2, 5, 2, 'dir20', 'personalized', 2, 2,
  'aa000000-0000-0000-0000-0000000000aa', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);

-- Trigger: blocks reader_plot_debt_closures inserts (simulates insert failure).
create or replace function test_block_ledger_insert() returns trigger as $$
begin
  raise exception 'TEST_BLOCKED_LEDGER_INSERT' using errcode = 'P0001';
end;
$$ language plpgsql;

create trigger test_block_ledger_insert_trg
  before insert on public.reader_plot_debt_closures
  for each row execute function test_block_ledger_insert();

-- Execute: V4 reaches publication but ledger insert triggers abort → entire tx rolls back.
-- NOTE: empty closures means closure validation passes, but the trigger fires
-- when V4 tries to INSERT even an empty closure set? No — V4 only inserts if
-- closures > 0. So we need at least one closure to reach the insert.
-- The trigger won't fire with empty closures because the loop body is skipped.
-- Solution: add a non-existent debt to the closure set? No — validation checks
-- the contract. With empty contract, any closure fails DEBT_CLOSURE_UNKNOWN_DEBT.
-- REVISED APPROACH: Use a trigger on publish_chapter_v2's idempotency insert
-- or on the chapters table instead — failure at chapters insert → rollback.
-- But the cleanest is to use a trigger on generation_jobs UPDATE to SUCCEEDED.

drop trigger test_block_ledger_insert_trg on public.reader_plot_debt_closures;
drop function test_block_ledger_insert();

-- REVISED: Trigger on generation_jobs that blocks SUCCEEDED transition.
-- V4 writes: job → SUCCEEDED after publication. If this UPDATE fails → rollback.
-- This tests that publication + chapter are NOT committed when the job UPDATE fails.

create or replace function test_block_job_succeeded() returns trigger as $$
begin
  if new.status = 'SUCCEEDED' and old.status is distinct from 'SUCCEEDED' then
    raise exception 'TEST_BLOCKED_JOB_SUCCEEDED' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger test_block_job_succeeded_trg
  before update on public.generation_jobs
  for each row execute function test_block_job_succeeded();

-- Execute: V4 reaches publication, then job UPDATE to SUCCEEDED triggers abort.
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aa000000-0000-0000-0000-0000000000aa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
    'bb000000-0000-0000-0000-0000000000bb'::uuid,
    'test:v4-atomic', 20, 'Bab Dua Puluh', '["Para rollback."]'::jsonb,
    'Apa yang dilakukan?',
    '[{"id":"go","label":"Ikuti jalan keluar"},{"id":"stay","label":"Tetap di tempat"}]'::jsonb,
    '[{"choiceId":"go","consequence":["Jalan terbuka."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stay","consequence":["Tetap diam."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'job SUCCEEDED trigger blocks V4');

-- Verify: chapter NOT published (rolled back — publish_chapter_v2 ran but tx aborted).
select is(
  (select count(*)::integer from public.chapters where story_id = 'test:v4-atomic' and number = 20),
  0, 'atomic rollback: chapter NOT published after job failure');

-- Verify: checkpoint NOT PUBLISHED (rolled back).
select is(
  (select status from public.chapter_generation_checkpoints
   where story_id = 'test:v4-atomic' and chapter_number = 20),
  'PROSE_READY', 'atomic rollback: checkpoint still PROSE_READY');

-- Verify: job NOT SUCCEEDED (rolled back).
select is(
  (select status from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
  'RUNNING', 'atomic rollback: job still RUNNING after job failure');

-- Cleanup: drop trigger.
drop trigger test_block_job_succeeded_trg on public.generation_jobs;
drop function test_block_job_succeeded();

-- ─── Atomic rollback: checkpoint transition failure → entire V4 rolls back ───

-- Checkpoint is still PROSE_READY (previous V4 rolled back).
-- Trigger on chapter_generation_checkpoints blocks UPDATE to PUBLISHED.

create or replace function test_block_checkpoint_transition() returns trigger as $$
begin
  if new.status = 'PUBLISHED' and old.status is distinct from 'PUBLISHED' then
    raise exception 'TEST_BLOCKED_CHECKPOINT_TRANSITION' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger test_block_checkpoint_transition_trg
  before update on public.chapter_generation_checkpoints
  for each row execute function test_block_checkpoint_transition();

-- Execute: V4 reaches checkpoint transition, trigger aborts → entire tx rolls back.
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aa000000-0000-0000-0000-0000000000aa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
    'bb000000-0000-0000-0000-0000000000bb'::uuid,
    'test:v4-atomic', 20, 'Bab Dua Puluh', '["Para rollback."]'::jsonb,
    'Apa yang dilakukan?',
    '[{"id":"go","label":"Ikuti jalan keluar"},{"id":"stay","label":"Tetap di tempat"}]'::jsonb,
    '[{"choiceId":"go","consequence":["Jalan terbuka."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stay","consequence":["Tetap diam."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'checkpoint transition trigger blocks V4');

-- Verify: chapter NOT published (rolled back).
select is(
  (select count(*)::integer from public.chapters where story_id = 'test:v4-atomic' and number = 20),
  0, 'atomic rollback: chapter NOT published after checkpoint failure');

-- Verify: checkpoint NOT PUBLISHED (rolled back).
select is(
  (select status from public.chapter_generation_checkpoints
   where story_id = 'test:v4-atomic' and chapter_number = 20),
  'PROSE_READY', 'atomic rollback: checkpoint still PROSE_READY after checkpoint failure');

-- Verify: job NOT SUCCEEDED (rolled back).
select is(
  (select status from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
  'RUNNING', 'atomic rollback: job still RUNNING after checkpoint failure');

-- Cleanup: drop trigger.
drop trigger test_block_checkpoint_transition_trg on public.chapter_generation_checkpoints;
drop function test_block_checkpoint_transition();

-- ═══════════════════════════════════════════════════════════════════════════════
-- Dual-hash regression: same closures + changed prose → different publication_hash
-- ═══════════════════════════════════════════════════════════════════════════════
-- Uses test:v4-atomic (empty contract → empty closures).
-- Job A: V4 with original prose → SUCCEEDED.
-- Job B: V4 with different prose (same empty closures) → SUCCEEDED (fresh job).
-- Assert: different publication_payload_hash, same closure_payload_hash.

-- Job A: succeeds with original prose.
select lives_ok($$
  select public.publish_generation_job_chapter_v4(
    'aa000000-0000-0000-0000-0000000000aa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
    'bb000000-0000-0000-0000-0000000000bb'::uuid,
    'test:v4-atomic', 20, 'Bab Dua Puluh', '["Original paragraph one."]'::jsonb,
    'Apa yang dilakukan?',
    '[{"id":"go","label":"Ikuti jalan keluar"},{"id":"stay","label":"Tetap di tempat"}]'::jsonb,
    '[{"choiceId":"go","consequence":["Jalan terbuka."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stay","consequence":["Tetap diam."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
    null, null, null::jsonb
  )
$$, 'dual-hash regression: job A succeeds');

-- Job B: fresh job, different prose, same empty closures.
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  'ee000000-0000-0000-0000-0000000000ee', 'test:v4-atomic', 20,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:ee000000-0000-0000-0000-0000000000ee:publish:20',
  1
);

insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'ff000000-0000-0000-0000-0000000000ff', 'test:v4-atomic', 20, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'ee000000-0000-0000-0000-0000000000ee',
  (select claim_token from public.generation_jobs where id = 'ee000000-0000-0000-0000-0000000000ee')
);

insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint,
  audit_signals_json, audit_signals_version,
  canon_version, blueprint_version, direction_fingerprint,
  generation_mode, generation_policy_version, prompt_contract_version,
  job_id, job_attempt_number, checkpoint_schema_version,
  prose_attempt_count, choice_attempt_count, expires_at,
  story_contract_version
) values (
  'test:v4-atomic', 20, 'ee000000-0000-0000-0000-0000000000ee',
  (select correlation_id from public.generation_jobs where id = 'ee000000-0000-0000-0000-0000000000ee'),
  'PROSE_READY', 'Ch20 B', '["Completely different paragraph."]'::jsonb, 'fp20b',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  2, 5, 2, 'dir20b', 'personalized', 2, 2,
  'ee000000-0000-0000-0000-0000000000ee', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);

-- Job B: different prose, same empty closures → succeeds (fresh job, not replay).
select lives_ok($$
  select public.publish_generation_job_chapter_v4(
    'ee000000-0000-0000-0000-0000000000ee'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'ee000000-0000-0000-0000-0000000000ee'),
    'ff000000-0000-0000-0000-0000000000ff'::uuid,
    'test:v4-atomic', 20, 'Bab Dua Puluh B', '["Completely different paragraph."]'::jsonb,
    'Apa yang dilakukan sekarang?',
    '[{"id":"go","label":"Ikuti jalan keluar"},{"id":"stay","label":"Tetap di tempat"}]'::jsonb,
    '[{"choiceId":"go","consequence":["Jalan terbuka."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stay","consequence":["Tetap diam."],"nextChapterNumber":21,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
    null, null, null::jsonb
  )
$$, 'dual-hash regression: job B with different prose succeeds (fresh job)');

-- Verify: different prose → DIFFERENT publication_payload_hash.
select isnt(
  (select publication_payload_hash from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
  (select publication_payload_hash from public.generation_jobs where id = 'ee000000-0000-0000-0000-0000000000ee'),
  'dual-hash regression: different prose → different publication_payload_hash');

-- Verify: same empty closures → SAME closure_payload_hash.
select is(
  (select closure_payload_hash from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
  (select closure_payload_hash from public.generation_jobs where id = 'ee000000-0000-0000-0000-0000000000ee'),
  'dual-hash regression: same closures → same closure_payload_hash');

-- Verify: both hashes are valid 64-char hex.
select matches(
  (select publication_payload_hash from public.generation_jobs where id = 'ee000000-0000-0000-0000-0000000000ee'),
  '^[0-9a-f]{64}$', 'dual-hash regression: job B publication_payload_hash valid');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Cleanup
-- ═══════════════════════════════════════════════════════════════════════════════

delete from public.chapter_generation_checkpoints where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.reader_plot_debt_closures where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.chapters where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.choice_outcomes where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.generation_leases where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.generation_jobs where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.story_generation_contracts where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.reader_states where story_id in ('test:v4-fn', 'test:v4-atomic');
delete from public.stories where id in ('test:v4-fn', 'test:v4-atomic');

select * from finish();
rollback;
