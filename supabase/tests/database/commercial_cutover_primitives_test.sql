-- supabase/tests/database/commercial_cutover_primitives_test.sql
-- pgTAP tests for 20260806010000_commercial_cutover_primitives.sql

begin;
select plan(24);

-- Setup test users and stories
select set_config('role', 'postgres', true);
insert into auth.users (id, email)
values
  ('11111111-1111-4111-a111-111111111111'::uuid, 'user1@example.com'),
  ('22222222-2222-4222-a222-222222222222'::uuid, 'user2@example.com')
on conflict do nothing;

insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, visibility, story_mode, commercial_origin, story_contract_version)
values
  ('story-paid-1', '11111111-1111-4111-a111-111111111111'::uuid, 'Paid Story 1', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BARU', 0, 'private', 'personalized_ai', 'PENDING_PAID_START', 1),
  ('story-choice-1', '11111111-1111-4111-a111-111111111111'::uuid, 'Choice Story 1', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BERJALAN', 3, 'private', 'personalized_ai', 'PAID_START', 1),
  ('story-starter-1', '11111111-1111-4111-a111-111111111111'::uuid, 'Starter Story 1', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BERJALAN', 1, 'private', 'personalized_ai', 'STARTER_FREE', 1)
on conflict do nothing;

insert into public.story_generation_contracts (story_id, mode, story_contract_version, story_contract_json)
values
  ('story-paid-1', 'personalized_ai', 1, '{"title":"Paid Story 1"}'::jsonb),
  ('story-choice-1', 'personalized_ai', 1, '{"title":"Choice Story 1"}'::jsonb),
  ('story-starter-1', 'personalized_ai', 1, '{"title":"Starter Story 1"}'::jsonb)
on conflict do nothing;

insert into public.reader_states (user_id, story_id, status, current_chapter)
values
  ('11111111-1111-4111-a111-111111111111'::uuid, 'story-paid-1', 'BARU', 1),
  ('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 'BERJALAN', 3),
  ('11111111-1111-4111-a111-111111111111'::uuid, 'story-starter-1', 'BERJALAN', 1)
on conflict do nothing;

insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'story-starter-1', clock_timestamp())
on conflict do nothing;

-- Give user1 100 credits
insert into public.credit_ledger (user_id, delta, reason, ref)
values ('11111111-1111-4111-a111-111111111111'::uuid, 100, 'grant', 'grant-test-1');

-- Test 1: ACL check for authorize_commercial_generation_intent_v1 (service_role only)
select set_config('role', 'authenticated', true);
select throws_like(
  $$ select public.authorize_commercial_generation_intent_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4) $$,
  '%permission denied%',
  'authorize_commercial_generation_intent_v1 is denied to authenticated'
);

select set_config('role', 'service_role', true);

-- Test 2: authorize_commercial_generation_intent_v1 rejects story_mode != personalized_ai
update public.stories set story_mode = 'premium_instance' where id = 'story-choice-1';
insert into public.commercial_generation_intents (user_id, story_id, chapter_number, trigger_choice_id, status, quoted_credits, pricing_version)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4, 'choice-1', 'WAITING_FOR_CREDITS', 8, 'v1');

select throws_like(
  $$ select public.authorize_commercial_generation_intent_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4) $$,
  '%INVALID_STORY_MODE%',
  'authorize_commercial_generation_intent_v1 rejects premium_instance'
);

update public.stories set story_mode = 'personalized_ai' where id = 'story-choice-1';

-- Test 3: authorize_commercial_generation_intent_v1 quote-preserving authorization
select is(
  (public.authorize_commercial_generation_intent_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4)->>'status')::text,
  'AUTHORIZED'::text,
  'authorize_commercial_generation_intent_v1 authorizes intent with 8 credits'
);

-- Test 4: ACTIVE unexpired reservation amount match returns AUTHORIZED replay without balance check
select is(
  (public.authorize_commercial_generation_intent_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4)->>'replayed')::boolean,
  true,
  'authorize_commercial_generation_intent_v1 replays AUTHORIZED status for ACTIVE unexpired reservation'
);

-- Test 5: queue_authorized_commercial_generation_v1 creates exact canonical job
select is(
  (public.queue_authorized_commercial_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4)->>'status')::text,
  'QUEUED'::text,
  'queue_authorized_commercial_generation_v1 enqueues Bab 4 job'
);

-- Test 6: publication_idempotency_key CHECK constraint compliance
select is(
  (select publication_idempotency_key from public.generation_jobs where story_id = 'story-choice-1' and chapter_number = 4),
  'generation-job:' || (select generation_job_id from public.commercial_generation_intents where story_id = 'story-choice-1' and chapter_number = 4)::text || ':publish:4',
  'publication_idempotency_key complies with CHECK constraint'
);

-- Test 7: queue_authorized_commercial_generation_v1 replay
select is(
  (public.queue_authorized_commercial_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4)->>'replayed')::boolean,
  true,
  'queue_authorized_commercial_generation_v1 replays existing QUEUED job'
);

-- Test 8: queue_authorized_commercial_generation_v1 rejects contract version mismatch
update public.stories set story_contract_version = 2 where id = 'story-choice-1';
select throws_like(
  $$ select public.queue_authorized_commercial_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-choice-1', 4) $$,
  '%STORY_CONTRACT_VERSION_MISMATCH%',
  'queue_authorized_commercial_generation_v1 rejects contract version mismatch'
);
update public.stories set story_contract_version = 1 where id = 'story-choice-1';

-- Setup story-paid-1 for queue_paid_story_start_generation_v1 test
insert into public.story_creation_requests (owner_user_id, request_kind, idempotency_key, request_hash, story_id, status)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'personalized', 'key-paid-1', 'hash-paid-1', 'story-paid-1', 'RESERVED');

-- Create active STORY_START reservation
select public.reserve_story_start_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-paid-1');

-- Test 9: queue_paid_story_start_generation_v1 creates exact Bab 1 job and binds request
select is(
  (public.queue_paid_story_start_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-paid-1')->>'status')::text,
  'QUEUED'::text,
  'queue_paid_story_start_generation_v1 enqueues Bab 1 job'
);

-- Test 10: story_creation_requests.generation_job_id is bound
select is(
  (select generation_job_id is not null from public.story_creation_requests where story_id = 'story-paid-1'),
  true,
  'story_creation_requests.generation_job_id is populated'
);

-- Test 11: queue_paid_story_start_generation_v1 publication_idempotency_key check
select is(
  (select publication_idempotency_key from public.generation_jobs where story_id = 'story-paid-1' and chapter_number = 1),
  'generation-job:' || (select generation_job_id from public.story_creation_requests where story_id = 'story-paid-1')::text || ':publish:1',
  'Bab 1 publication_idempotency_key complies with CHECK constraint'
);

-- Test 12: queue_paid_story_start_generation_v1 replay
select is(
  (public.queue_paid_story_start_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-paid-1')->>'replayed')::boolean,
  true,
  'queue_paid_story_start_generation_v1 replays existing bound job'
);

-- Test 13: queue_paid_story_start_generation_v1 rejects when no creation request exists for story
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-noreq-1', '11111111-1111-4111-a111-111111111111'::uuid, 'NoReq Story 1', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BARU', 1, 'private', 'personalized_ai', 'PENDING_PAID_START', 1);

insert into public.story_generation_contracts (story_id, mode, story_contract_version, story_contract_json)
values ('story-noreq-1', 'personalized_ai', 1, '{"title":"NoReq Story 1"}'::jsonb);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'story-noreq-1', 'BARU', 1);

select public.reserve_story_start_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-noreq-1');

select throws_like(
  $$ select public.queue_paid_story_start_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-noreq-1') $$,
  '%CREATION_REQUEST_COUNT_INVALID%',
  'queue_paid_story_start_generation_v1 rejects when creation request count != 1'
);

-- Test 14: Ready metadata trigger updates story.generation_status to ready on READY transition
update public.stories set commercial_origin = 'PAID_START' where id = 'story-paid-1';
update public.story_creation_requests set status = 'READY' where story_id = 'story-paid-1';
select is(
  (select generation_status from public.stories where id = 'story-paid-1'),
  'ready'::text,
  'trg_personalized_creation_request_ready updates stories.generation_status to ready'
);

-- Test 15: Ready trigger does not fire if request_kind != personalized
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-premium-1', '11111111-1111-4111-a111-111111111111'::uuid, 'Premium Story 1', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BARU', 1, 'private', 'premium_instance', 'PAID_START', 1);

insert into public.generation_jobs (id, correlation_id, user_id, story_id, chapter_number, generation_kind, status, deadline_at, publication_idempotency_key)
values ('33333333-3333-4333-a333-333333333333'::uuid, gen_random_uuid(), '11111111-1111-4111-a111-111111111111'::uuid, 'story-premium-1', 1, 'personalized', 'QUEUED', clock_timestamp() + interval '20 minutes', 'generation-job:33333333-3333-4333-a333-333333333333:publish:1');

insert into public.story_creation_requests (owner_user_id, request_kind, idempotency_key, request_hash, story_id, status, generation_job_id)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'premium_clone', 'key-prem-1', 'hash-prem-1', 'story-premium-1', 'RESERVED', '33333333-3333-4333-a333-333333333333'::uuid);

update public.story_creation_requests set status = 'READY' where story_id = 'story-premium-1';
select is(
  (select generation_status from public.stories where id = 'story-premium-1'),
  'idle'::text,
  'Ready trigger does not touch premium_clone stories'
);

-- Test 16: Prequeue top-up resume state acceptance (WAITING_FOR_CREDITS + job NULL)
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-topup-1', '11111111-1111-4111-a111-111111111111'::uuid, 'TopUp Story 1', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BARU', 1, 'private', 'personalized_ai', 'PENDING_PAID_START', 1);

insert into public.story_generation_contracts (story_id, mode, story_contract_version, story_contract_json)
values ('story-topup-1', 'personalized_ai', 1, '{"title":"TopUp Story 1"}'::jsonb);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'story-topup-1', 'BARU', 1);

insert into public.story_creation_requests (owner_user_id, request_kind, idempotency_key, request_hash, story_id, status)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'personalized', 'key-topup-1', 'hash-topup-1', 'story-topup-1', 'WAITING_FOR_CREDITS');

select public.reserve_story_start_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-topup-1');

select is(
  (public.queue_paid_story_start_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-topup-1')->>'status')::text,
  'QUEUED'::text,
  'queue_paid_story_start_generation_v1 accepts prequeue WAITING_FOR_CREDITS state'
);

-- Test 17: request status updated to RESERVED upon binding
select is(
  (select status from public.story_creation_requests where story_id = 'story-topup-1'),
  'RESERVED'::text,
  'queue_paid_story_start_generation_v1 updates WAITING_FOR_CREDITS to RESERVED on job binding'
);

-- Test 18: Controlled replacement of CANCELLED bound job
update public.generation_jobs set status = 'CANCELLED' where story_id = 'story-topup-1' and chapter_number = 1;
select is(
  (public.queue_paid_story_start_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-topup-1')->>'replayed')::boolean,
  false,
  'queue_paid_story_start_generation_v1 replaces FAILED bound job with a new QUEUED job'
);

-- Test 19: Replacement rejected if old bound job is SUCCEEDED
update public.generation_jobs set status = 'RUNNING', attempt_count = 1, claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp(), worker_id = 'w1', claim_token = gen_random_uuid() where id = (select generation_job_id from public.story_creation_requests where story_id = 'story-topup-1');
update public.generation_jobs set status = 'SUCCEEDED', publication_result = '{"status":"published"}'::jsonb, completed_at = clock_timestamp() where id = (select generation_job_id from public.story_creation_requests where story_id = 'story-topup-1');
select throws_like(
  $$ select public.queue_paid_story_start_generation_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-topup-1') $$,
  '%OLD_JOB_NOT_TERMINAL%',
  'queue_paid_story_start_generation_v1 rejects replacement when old job is SUCCEEDED'
);

-- Test 20: authorize_commercial_generation_intent_v1 insufficient credits
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-user2-choice-1', '22222222-2222-4222-a222-222222222222'::uuid, 'User2 Story', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BERJALAN', 4, 'private', 'personalized_ai', 'PAID_START', 1);

insert into public.story_generation_contracts (story_id, mode, story_contract_version, story_contract_json)
values ('story-user2-choice-1', 'personalized_ai', 1, '{"title":"User2 Story"}'::jsonb);

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('22222222-2222-4222-a222-222222222222'::uuid, 'story-user2-choice-1', 'BERJALAN', 4);

insert into public.commercial_generation_intents (user_id, story_id, chapter_number, trigger_choice_id, status, quoted_credits, pricing_version)
values ('22222222-2222-4222-a222-222222222222'::uuid, 'story-user2-choice-1', 5, 'choice-5', 'WAITING_FOR_CREDITS', 8, 'v1');

-- Give user2 only 4 credits
insert into public.credit_ledger (user_id, delta, reason, ref)
values ('22222222-2222-4222-a222-222222222222'::uuid, 4, 'grant', 'grant-test-2');

select is(
  (public.authorize_commercial_generation_intent_v1('22222222-2222-4222-a222-222222222222'::uuid, 'story-user2-choice-1', 5)->>'reason')::text,
  'INSUFFICIENT_CREDITS'::text,
  'authorize_commercial_generation_intent_v1 returns INSUFFICIENT_CREDITS when user balance < quote'
);

-- Test 21: intent remains WAITING_FOR_CREDITS on insufficient
select is(
  (select status from public.commercial_generation_intents where user_id = '22222222-2222-4222-a222-222222222222'::uuid and story_id = 'story-user2-choice-1' and chapter_number = 5),
  'WAITING_FOR_CREDITS'::text,
  'intent status remains WAITING_FOR_CREDITS on insufficient credits'
);

-- Test 22: no ACTIVE reservation created on insufficient
select is(
  (select count(*) from public.credit_reservations where user_id = '22222222-2222-4222-a222-222222222222'::uuid and story_id = 'story-user2-choice-1' and chapter_number = 5 and status = 'ACTIVE'),
  0::bigint,
  'No ACTIVE reservation is created on insufficient credits'
);

-- Test 23: STARTER_FREE story authorizes Bab 4+ if starter identity matches
insert into public.commercial_generation_intents (user_id, story_id, chapter_number, trigger_choice_id, status, quoted_credits, pricing_version)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'story-starter-1', 4, 'choice-s1', 'WAITING_FOR_CREDITS', 8, 'v1');

select is(
  (public.authorize_commercial_generation_intent_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-starter-1', 4)->>'status')::text,
  'AUTHORIZED'::text,
  'STARTER_FREE story authorizes Bab 4+ when starter identity matches'
);

-- Test 24: STARTER_FREE story rejects authorization if starter identity does not match
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-starter-fake', '11111111-1111-4111-a111-111111111111'::uuid, 'Starter Story Fake', '/c.webp', 't', 'r', '[]'::jsonb, 50, 's', 'BERJALAN', 1, 'private', 'personalized_ai', 'STARTER_FREE', 1);

insert into public.commercial_generation_intents (user_id, story_id, chapter_number, trigger_choice_id, status, quoted_credits, pricing_version)
values ('11111111-1111-4111-a111-111111111111'::uuid, 'story-starter-fake', 4, 'choice-fake', 'WAITING_FOR_CREDITS', 8, 'v1');

select throws_like(
  $$ select public.authorize_commercial_generation_intent_v1('11111111-1111-4111-a111-111111111111'::uuid, 'story-starter-fake', 4) $$,
  '%STARTER_IDENTITY_MISMATCH%',
  'STARTER_FREE story rejects authorization if starter identity does not match'
);

select * from finish();
rollback;
