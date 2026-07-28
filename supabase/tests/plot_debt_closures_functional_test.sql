-- Functional tests for publish_generation_job_chapter_v4.
-- Error paths: tested here (errors raise before publish_chapter_v2).
-- Happy path: tested here with valid choice fixtures.
-- Omission/deadline: tested here via closure validation path.
-- Atomic rollback: proved with real closure ledger entries (atomic_debt).
-- Same-job replay: proved cached success (Phase A fast path).
-- IDEMPOTENCY_CONFLICT: race-only path, tested in plot-debt-v4-race.ts P1.5.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);

-- generation_jobs_enforce_state_v1 requires new jobs to be inserted as QUEUED
-- (attempt_count 0, no ownership) and only reach RUNNING via update carrying full
-- ownership (worker_id, claim_token, claimed_at, heartbeat_at). This helper mirrors
-- a real worker claim so fixtures can seed a RUNNING job without tripping the trigger.
create or replace function pg_temp.seed_running_job(
  p_job_id uuid, p_worker text
) returns uuid language plpgsql as $$
declare v_token uuid := pg_catalog.gen_random_uuid();
begin
  update public.generation_jobs
  set status = 'RUNNING', attempt_count = attempt_count + 1,
      worker_id = p_worker, claim_token = v_token,
      claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
  where id = p_job_id;

  -- Keep active lease in sync with the job's new claim_token
  update public.generation_leases
  set claim_token = v_token
  where job_id = p_job_id and status = 'ACTIVE';

  return v_token;
end;
$$;

-- generation_leases_one_active is UNIQUE(story_id) WHERE status='ACTIVE': a story
-- may hold at most one ACTIVE lease. Each independent job fixture therefore lives
-- on its OWN story. This helper seeds the story + reader_state + contract a
-- personalized publication needs (all at contract version 1).
create or replace function pg_temp.seed_story(
  p_story_id text, p_chapter integer, p_debts jsonb
) returns void language plpgsql as $$
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
  values (p_story_id, 'V4 Fixture', '00000000-0000-0000-0000-000000000001', 'private', 'personalized_ai', 1);
  insert into public.reader_states (user_id, story_id, status, current_chapter)
  values ('00000000-0000-0000-0000-000000000001', p_story_id, 'BERJALAN', p_chapter);
  insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
  values (p_story_id, 'personalized_ai', 50, p_debts, 1);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Setup: story + reader + contract + job + lease + checkpoint fixtures
-- ═══════════════════════════════════════════════════════════════════════════════

-- Seed the owning auth user (stories.owner_user_id FK → auth.users).
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'v4-fn-owner@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
values ('test:v4-fn', 'V4 Functional', '00000000-0000-0000-0000-000000000001', 'private', 'personalized_ai', 1);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('00000000-0000-0000-0000-000000000001', 'test:v4-fn', 'BERJALAN', 10);

insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
values ('test:v4-fn', 'personalized_ai', 50,
  '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb,
  1);

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test:v4-fn', 10,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:publish:10',
  1
);
select pg_temp.seed_running_job('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'v4-test-worker');

insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'test:v4-fn', 10, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
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
  'test:v4-fn', 10, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select correlation_id from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'PROSE_READY', 'Test Chapter', '["Paragraph one."]'::jsonb,
  'fp123456789012345678901234567890',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  2, 5, 2, 'dir1234567890123456789012345678', 'personalized', 2, 2,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);

-- Standard-mode job on its OWN story (one ACTIVE lease per story).
insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
values ('test:v4-std', 'V4 Standard', '00000000-0000-0000-0000-000000000001', 'private', 'standard', 1);

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'test:v4-std', 5,
  '00000000-0000-0000-0000-000000000001', 'standard',
  'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:cccccccc-cccc-cccc-cccc-cccccccccccc:publish:5'
);
select pg_temp.seed_running_job('cccccccc-cccc-cccc-cccc-cccccccccccc', 'v4-test-worker');

insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'test:v4-std', 5, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (select claim_token from public.generation_jobs where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- V4 function exists with correct signature
-- ═══════════════════════════════════════════════════════════════════════════════

select has_function('public', 'publish_generation_job_chapter_v4',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb','text','text','jsonb'],
  'V4 function exists with 14-param signature');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: job-level
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    '00000000-0000-0000-0000-999999999999'::uuid, 'worker', gen_random_uuid(), gen_random_uuid(),
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'GENERATION_JOB_NOT_FOUND');

-- Use RETRY_WAIT (a legal non-running, non-terminal state) to exercise the NOT_RUNNING
-- guard, then restore RUNNING via the same claim helper.
update public.generation_jobs
set status = 'RETRY_WAIT'
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'GENERATION_JOB_NOT_RUNNING');

select pg_temp.seed_running_job('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'v4-test-worker');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: contract provenance
-- ═══════════════════════════════════════════════════════════════════════════════

-- Own story (one ACTIVE lease per story). Job intentionally lacks
-- story_contract_version to trip CONTRACT_PROVENANCE_MISSING.
select pg_temp.seed_story('test:v4-e', 11,
  '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb);
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'test:v4-e', 11,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee:publish:11'
);
select pg_temp.seed_running_job('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'v4-test-worker');
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff', 'test:v4-e', 11, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (select claim_token from public.generation_jobs where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
);
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
    'test:v4-e', 11, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CONTRACT_PROVENANCE_MISSING');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: checkpoint binding
-- ═══════════════════════════════════════════════════════════════════════════════

-- Own story (one ACTIVE lease per story). No checkpoint for ch12 → NOT_FOUND.
select pg_temp.seed_story('test:v4-c', 12,
  '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb);
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  '11111111-1111-1111-1111-111111111111', 'test:v4-c', 12,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:11111111-1111-1111-1111-111111111111:publish:12', 1
);
select pg_temp.seed_running_job('11111111-1111-1111-1111-111111111111', 'v4-test-worker');
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  '22222222-2222-2222-2222-222222222222', 'test:v4-c', 12, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  '11111111-1111-1111-1111-111111111111',
  (select claim_token from public.generation_jobs where id = '11111111-1111-1111-1111-111111111111')
);
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    '11111111-1111-1111-1111-111111111111'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = '11111111-1111-1111-1111-111111111111'),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'test:v4-c', 12, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CHECKPOINT_NOT_FOUND');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Error paths: standard mode + closures + payload
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'test:v4-std', 5, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[{"debtId":"x","closureForm":"RESOLVED"}]'::jsonb
  )
$$, '22023', null, 'standard mode rejects closures');

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'test:v4-std', 5, '', '[]'::jsonb, '', '[]'::jsonb, '[]'::jsonb,
    null, null, null::jsonb
  )
$$, '22023', null, 'standard reaches publication (empty title rejected)');

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[{"debtId":"main_mystery"}]'::jsonb
  )
$$, '22023', null, 'INVALID_CLOSURE_PAYLOAD: missing closureForm');

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[{"debtId":"d","closureForm":"RESOLVED"},{"debtId":"d","closureForm":"RESOLVED"}]'::jsonb
  )
$$, '22023', null, 'INVALID_CLOSURE_PAYLOAD: duplicate debtId');

-- CHECKPOINT_INVALID_STATE: EXPIRED
update public.chapter_generation_checkpoints set status = 'EXPIRED'
where story_id = 'test:v4-fn' and chapter_number = 10;
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'CHECKPOINT_INVALID_STATE: EXPIRED');
update public.chapter_generation_checkpoints set status = 'PROSE_READY'
where story_id = 'test:v4-fn' and chapter_number = 10;

-- CHECKPOINT_ATTEMPT_AHEAD
update public.chapter_generation_checkpoints set job_attempt_number = 99
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
update public.chapter_generation_checkpoints set job_attempt_number = 1
where story_id = 'test:v4-fn' and chapter_number = 10;

-- CONTRACT_VERSION_MISMATCH
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
update public.stories set story_contract_version = 1 where id = 'test:v4-fn';

-- OWNERSHIP_LOST
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'wrong-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'GENERATION_JOB_OWNERSHIP_LOST');

-- DEBT_CLOSURE_DEADLINE_VIOLATION: omission at mustCloseBy (own story).
-- main_mystery.mustCloseBy=48 and ch48 closes nothing → deadline omission.
select pg_temp.seed_story('test:v4-d', 48,
  '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb);
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  '33333333-3333-3333-3333-333333333333', 'test:v4-d', 48,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:33333333-3333-3333-3333-333333333333:publish:48', 1
);
select pg_temp.seed_running_job('33333333-3333-3333-3333-333333333333', 'v4-test-worker');
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  '44444444-4444-4444-4444-444444444444', 'test:v4-d', 48, 'ACTIVE',
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
  prose_attempt_count, choice_attempt_count, expires_at, story_contract_version
) values (
  'test:v4-d', 48, '33333333-3333-3333-3333-333333333333',
  (select correlation_id from public.generation_jobs where id = '33333333-3333-3333-3333-333333333333'),
  'PROSE_READY', 'Ch 48', '["P"]'::jsonb, 'fp48',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  2, 5, 2, 'dir48', 'personalized', 2, 2,
  '33333333-3333-3333-3333-333333333333', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    '33333333-3333-3333-3333-333333333333'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = '33333333-3333-3333-3333-333333333333'),
    '44444444-4444-4444-4444-444444444444'::uuid,
    'test:v4-d', 48, 'Title', '["P"]'::jsonb, 'Prompt?', '[]'::jsonb, '[]'::jsonb,
    null, null, '[]'::jsonb
  )
$$, 'P0001', null, 'DEBT_CLOSURE_DEADLINE_VIOLATION: omission at mustCloseBy');

-- CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH
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
update public.chapter_generation_checkpoints
set audit_signals_json = '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb
where story_id = 'test:v4-fn' and chapter_number = 10;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Happy path: personalized publication + closure ledger atomicity
-- ═══════════════════════════════════════════════════════════════════════════════

update public.chapter_generation_checkpoints
set audit_signals_json = '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"main_mystery","closureForm":"RESOLVED"}]}'::jsonb
where story_id = 'test:v4-fn' and chapter_number = 10;

select lives_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Bab Sepuluh',
    '["Raka membuka pintu gudang dengan hati-hati."]'::jsonb,
    'Apa yang Raka lakukan sekarang?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
    '[{"choiceId":"open-door","consequence":["Pintu arsip terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null,
    '[{"debtId":"main_mystery","closureForm":"RESOLVED"}]'::jsonb
  )
$$, 'V4 happy path: personalized publication with closure succeeds');

select is((select count(*)::integer from public.chapters where story_id = 'test:v4-fn' and number = 10), 1, 'happy path: chapter published exactly once');
select is((select count(*)::integer from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'), 1, 'happy path: closure ledger 1 row');
select is((select debt_id from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'), 'main_mystery', 'happy path: debt_id correct');
select is((select closure_form from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'), 'RESOLVED', 'happy path: closure_form correct');
select is((select closed_at_chapter from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'), 10, 'happy path: closed_at_chapter correct');
select is((select closed_by_job_id from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'happy path: closed_by_job_id correct');
select is((select status from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'SUCCEEDED', 'happy path: job SUCCEEDED');
select is((select status from public.generation_leases where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'RELEASED', 'happy path: lease RELEASED');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:v4-fn' and chapter_number = 10), 'PUBLISHED', 'happy path: checkpoint PUBLISHED');
select matches((select publication_payload_hash from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '^[0-9a-f]{64}$', 'happy path: publication_payload_hash valid');
select matches((select closure_payload_hash from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '^[0-9a-f]{64}$', 'happy path: closure_payload_hash valid');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Same-job idempotent replay (Phase A fast path)
-- ═══════════════════════════════════════════════════════════════════════════════

select lives_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Bab Sepuluh',
    '["Raka membuka pintu gudang dengan hati-hati."]'::jsonb,
    'Apa yang Raka lakukan sekarang?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
    '[{"choiceId":"open-door","consequence":["Pintu arsip terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null,
    '[{"debtId":"main_mystery","closureForm":"RESOLVED"}]'::jsonb
  )
$$, 'same-job replay: cached success');

select is((select count(*)::integer from public.chapters where story_id = 'test:v4-fn' and number = 10), 1, 'same-job replay: chapter still 1');
select is((select count(*)::integer from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-fn'), 1, 'same-job replay: ledger still 1 row');

-- ═══════════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCY_CONFLICT: same job + changed payload → IDEMPOTENCY_CONFLICT.
-- Job is already SUCCEEDED with hashes. Phase A computes new hash, finds mismatch.
-- Uses null closures (different from stored) to simplify: the publication hash
-- difference is sufficient to trigger IDEMPOTENCY_CONFLICT.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Same job + different prose → IDEMPOTENCY_CONFLICT
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Bab Sepuluh Berbeda',
    '["Paragraf yang sama sekali berbeda."]'::jsonb,
    'Apa yang Raka lakukan sekarang?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
    '[{"choiceId":"open-door","consequence":["Pintu arsip terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'IDEMPOTENCY_CONFLICT: different prose');

-- 2. Same job + different choicePrompt → IDEMPOTENCY_CONFLICT
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Bab Sepuluh',
    '["Raka membuka pintu gudang dengan hati-hati."]'::jsonb,
    'Apa yang harus dilakukan?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
    '[{"choiceId":"open-door","consequence":["Pintu arsip terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, null::jsonb
  )
$$, 'P0001', null, 'IDEMPOTENCY_CONFLICT: different choicePrompt');

-- 3. Same job + different endingName (with endingKey) → IDEMPOTENCY_CONFLICT
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'test:v4-fn', 10, 'Bab Sepuluh',
    '["Raka membuka pintu gudang dengan hati-hati."]'::jsonb,
    'Apa yang Raka lakukan sekarang?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
    '[{"choiceId":"open-door","consequence":["Pintu arsip terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    'ending:alt', 'Alternative Ending', null::jsonb
  )
$$, 'P0001', null, 'IDEMPOTENCY_CONFLICT: different endingName');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Atomic rollback: proves closure ledger rolls back with the transaction.
-- test:v4-atomic has one debt (atomic_debt, mustCloseBy=50).
-- ═══════════════════════════════════════════════════════════════════════════════

insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
values ('test:v4-atomic', 'V4 Atomic', '00000000-0000-0000-0000-000000000001', 'private', 'personalized_ai', 1);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('00000000-0000-0000-0000-000000000001', 'test:v4-atomic', 'BERJALAN', 20);

insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
values ('test:v4-atomic', 'personalized_ai', 50,
  '[{"id":"atomic_debt","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":50,"status":"open"}]'::jsonb, 1);

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key, story_contract_version
) values (
  'aa000000-0000-0000-0000-0000000000aa', 'test:v4-atomic', 20,
  '00000000-0000-0000-0000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '20 minutes',
  gen_random_uuid(),
  'generation-job:aa000000-0000-0000-0000-0000000000aa:publish:20', 1
);
select pg_temp.seed_running_job('aa000000-0000-0000-0000-0000000000aa', 'v4-test-worker');

insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
) values (
  'bb000000-0000-0000-0000-0000000000bb', 'test:v4-atomic', 20, 'ACTIVE',
  'v4-test-worker', clock_timestamp() + interval '5 minutes',
  'aa000000-0000-0000-0000-0000000000aa',
  (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa')
);

insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint,
  audit_signals_json, audit_signals_version,
  canon_version, blueprint_version, direction_fingerprint,
  generation_mode, generation_policy_version, prompt_contract_version,
  job_id, job_attempt_number, checkpoint_schema_version,
  prose_attempt_count, choice_attempt_count, expires_at, story_contract_version
) values (
  'test:v4-atomic', 20, 'aa000000-0000-0000-0000-0000000000aa',
  (select correlation_id from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
  'PROSE_READY', 'Ch20', '["Para 20."]'::jsonb, 'fp20',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"atomic_debt","closureForm":"RESOLVED"}]}'::jsonb,
  2, 5, 2, 'dir20', 'personalized', 2, 2,
  'aa000000-0000-0000-0000-0000000000aa', 1, 2,
  1, 0, clock_timestamp() + interval '24 hours', 1
);

-- ─── Scenario A: job SUCCEEDED trigger → ALL rolled back including closure ledger ───
-- Phase G order: closure ledger insert → checkpoint PUBLISHED → job SUCCEEDED.
-- Trigger at job SUCCEEDED. Rolls back ALL: chapter + ledger + checkpoint + lease.

create or replace function test_block_job_succeeded() returns trigger as $$
begin
  if new.status = 'SUCCEEDED' and old.status is distinct from 'SUCCEEDED' then
    raise exception 'TEST_BLOCKED_JOB_SUCCEEDED' using errcode = 'P0001';
  end if;
  return new;
end; $$ language plpgsql;

create trigger test_block_job_succeeded_trg
  before update on public.generation_jobs
  for each row execute function test_block_job_succeeded();

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aa000000-0000-0000-0000-0000000000aa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
    'bb000000-0000-0000-0000-0000000000bb'::uuid,
    'test:v4-atomic', 20, 'Bab Dua Puluh', '["Para rollback."]'::jsonb,
    'Apa yang dilakukan?',
    '[{"id":"go","label":"Ikuti jalan keluar"},{"id":"stay","label":"Hindari area bahaya"}]'::jsonb,
    '[{"choiceId":"go","consequence":["Jalan terbuka."],"nextChapterNumber":21,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stay","consequence":["Tetap diam."],"nextChapterNumber":21,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null,
    '[{"debtId":"atomic_debt","closureForm":"RESOLVED"}]'::jsonb
  )
$$, 'P0001', null, 'atomic rollback A: job SUCCEEDED trigger blocks V4');

select is((select count(*)::integer from public.chapters where story_id = 'test:v4-atomic' and number = 20), 0, 'rollback A: chapter NOT published');
select is((select count(*)::integer from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-atomic' and debt_id = 'atomic_debt'), 0, 'rollback A: closure ledger EMPTY for atomic_debt');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:v4-atomic' and chapter_number = 20), 'PROSE_READY', 'rollback A: checkpoint still PROSE_READY');
select is((select status from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'), 'RUNNING', 'rollback A: job still RUNNING');
select is((select status from public.generation_leases where id = 'bb000000-0000-0000-0000-0000000000bb'), 'ACTIVE', 'rollback A: lease still ACTIVE');

drop trigger test_block_job_succeeded_trg on public.generation_jobs;
drop function test_block_job_succeeded();

-- ─── Scenario B: checkpoint PUBLISHED trigger → ALL rolled back including closure ledger ───
-- Trigger at checkpoint PUBLISHED. Rolls back ALL: chapter + ledger + checkpoint + lease.

create or replace function test_block_checkpoint_transition() returns trigger as $$
begin
  if new.status = 'PUBLISHED' and old.status is distinct from 'PUBLISHED' then
    raise exception 'TEST_BLOCKED_CHECKPOINT_TRANSITION' using errcode = 'P0001';
  end if;
  return new;
end; $$ language plpgsql;

create trigger test_block_checkpoint_transition_trg
  before update on public.chapter_generation_checkpoints
  for each row execute function test_block_checkpoint_transition();

select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'aa000000-0000-0000-0000-0000000000aa'::uuid, 'v4-test-worker',
    (select claim_token from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'),
    'bb000000-0000-0000-0000-0000000000bb'::uuid,
    'test:v4-atomic', 20, 'Bab Dua Puluh', '["Para rollback."]'::jsonb,
    'Apa yang dilakukan?',
    '[{"id":"go","label":"Ikuti jalan keluar"},{"id":"stay","label":"Hindari area bahaya"}]'::jsonb,
    '[{"choiceId":"go","consequence":["Jalan terbuka."],"nextChapterNumber":21,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stay","consequence":["Tetap diam."],"nextChapterNumber":21,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null,
    '[{"debtId":"atomic_debt","closureForm":"RESOLVED"}]'::jsonb
  )
$$, 'P0001', null, 'atomic rollback B: checkpoint transition trigger blocks V4');

select is((select count(*)::integer from public.chapters where story_id = 'test:v4-atomic' and number = 20), 0, 'rollback B: chapter NOT published');
select is((select count(*)::integer from public.reader_plot_debt_closures where user_id = '00000000-0000-0000-0000-000000000001' and story_id = 'test:v4-atomic' and debt_id = 'atomic_debt'), 0, 'rollback B: closure ledger EMPTY for atomic_debt');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:v4-atomic' and chapter_number = 20), 'PROSE_READY', 'rollback B: checkpoint still PROSE_READY');
select is((select status from public.generation_jobs where id = 'aa000000-0000-0000-0000-0000000000aa'), 'RUNNING', 'rollback B: job still RUNNING');
select is((select status from public.generation_leases where id = 'bb000000-0000-0000-0000-0000000000bb'), 'ACTIVE', 'rollback B: lease still ACTIVE');

drop trigger test_block_checkpoint_transition_trg on public.chapter_generation_checkpoints;
drop function test_block_checkpoint_transition();

-- ═══════════════════════════════════════════════════════════════════════════════
-- Cleanup
-- ═══════════════════════════════════════════════════════════════════════════════

-- The whole test runs inside one transaction ending in ROLLBACK, so these deletes
-- are cosmetic; kept in sync for clarity across every fixture story.
delete from public.chapter_generation_checkpoints where story_id like 'test:v4-%';
delete from public.reader_plot_debt_closures where story_id like 'test:v4-%';
delete from public.chapters where story_id like 'test:v4-%';
delete from public.choice_outcomes where story_id like 'test:v4-%';
delete from public.generation_leases where story_id like 'test:v4-%';
delete from public.generation_jobs where story_id like 'test:v4-%';
delete from public.story_generation_contracts where story_id like 'test:v4-%';
delete from public.reader_states where story_id like 'test:v4-%';
delete from public.stories where id like 'test:v4-%';

select * from finish();
rollback;
