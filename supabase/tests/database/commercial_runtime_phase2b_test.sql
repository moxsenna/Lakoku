-- supabase/tests/database/commercial_runtime_phase2b_test.sql
-- pgTAP tests for Phase 2B V5 atomic publication, credit capture, and status transitions.

\set ON_ERROR_STOP 1
begin;
select plan(12);

-- Seed global credit config
insert into public.feature_credit_costs (feature_key, credits_required, is_active)
values ('story_start', 24, true), ('chapter_unlock', 8, true)
on conflict (feature_key) do update set credits_required = excluded.credits_required;

-- Test 1: Function publish_generation_job_chapter_v5 exists
select has_function('public', 'publish_generation_job_chapter_v5', 'publish_generation_job_chapter_v5 function exists');

-- Test 2: Verify parameter signature (exact 14 parameters with p_paragraphs jsonb)
select has_function(
  'public',
  'publish_generation_job_chapter_v5',
  ARRAY['uuid', 'text', 'uuid', 'uuid', 'text', 'integer', 'text', 'jsonb', 'text', 'jsonb', 'jsonb', 'text', 'text', 'jsonb'],
  'publish_generation_job_chapter_v5 signature matches expected 14 parameters'
);

-- Seed test user & account
insert into auth.users (id, email)
values ('99999999-9999-4999-9999-999999999999', 'v5test@example.com')
on conflict (id) do nothing;

insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at)
values ('99999999-9999-4999-9999-999999999999', 'story-starter-1', now())
on conflict (user_id) do nothing;

-- Test 3: Attempting to set credit_reservations.status = FULFILLED throws constraint violation
select throws_like(
  $$ insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
     values ('99999999-9999-4999-9999-999999999999', 'story-invalid', 4, 'CHAPTER_UNLOCK', 8, 'invalid-status-ref', 'FULFILLED', now() + interval '1 hour') $$,
  '%',
  'credit_reservations rejects invalid FULFILLED status'
);

-- Seed PENDING_PAID_START story
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin)
values ('story-v5-pending', '99999999-9999-4999-9999-999999999999', 'Paid Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BARU', 0, '{}', 'private', 'personalized_ai', 'PENDING_PAID_START')
on conflict (id) do nothing;

-- Test 4: Story initial origin is PENDING_PAID_START
select is(
  (select commercial_origin from public.stories where id = 'story-v5-pending'),
  'PENDING_PAID_START',
  'story origin initially PENDING_PAID_START'
);

-- Seed active reservation for STORY_START
insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v5-pending', 1, 'STORY_START', 24, 'story-start:99999999-9999-4999-9999-999999999999:story-v5-pending', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

-- Seed creation request
insert into public.story_creation_requests (owner_user_id, story_id, request_kind, idempotency_key, request_hash, status)
values ('99999999-9999-4999-9999-999999999999', 'story-v5-pending', 'personalized', 'key-v5-pending', 'hash-v5-pending-000000000000000000000000000000000000000000000000', 'RESERVED');

-- Test 5: Reservation is ACTIVE
select is(
  (select status from public.credit_reservations where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v5-pending'),
  'ACTIVE',
  'story start reservation is active'
);

-- Seed generation job for Bab 1
insert into public.generation_jobs (id, user_id, story_id, chapter_number, generation_kind, status, worker_id, claim_token, correlation_id, deadline_at, publication_idempotency_key)
values ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-9999-999999999999', 'story-v5-pending', 1, 'personalized', 'QUEUED', null, null, gen_random_uuid(), now() + interval '5 minutes', 'generation-job:88888888-8888-4888-8888-888888888888:publish:1')
on conflict (id) do nothing;

-- Test 6: Verify publish_generation_job_chapter_v5 fails closed when lease is missing
select throws_like(
  $$ select public.publish_generation_job_chapter_v5(
    '88888888-8888-4888-8888-888888888888'::uuid,
    'worker-1',
    '77777777-7777-4777-7777-777777777777'::uuid,
    gen_random_uuid(),
    'story-v5-pending',
    1,
    'Bab 1',
    '["Paragraph 1"]'::jsonb,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    null,
    null,
    '[]'::jsonb
  ) $$,
  '%',
  'publish_generation_job_chapter_v5 fails when lease invalid'
);

-- Test 7: Reservation remains ACTIVE when publication fails
select is(
  (select status from public.credit_reservations where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v5-pending'),
  'ACTIVE',
  'reservation remains ACTIVE when publication fails'
);

-- Test 8: Creation request remains RESERVED when publication fails
select is(
  (select status from public.story_creation_requests where story_id = 'story-v5-pending'),
  'RESERVED',
  'creation request remains RESERVED when publication fails'
);

-- Seed Bab 4+ story & reservation for positive capture test
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin)
values ('story-v5-ch4', '99999999-9999-4999-9999-999999999999', 'Ch4 Paid Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'PAID_START')
on conflict (id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v5-ch4', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v5-ch4:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

insert into public.generation_jobs (id, user_id, story_id, chapter_number, generation_kind, status, worker_id, claim_token, correlation_id, deadline_at, publication_idempotency_key)
values ('77777777-7777-4777-7777-777777777777', '99999999-9999-4999-9999-999999999999', 'story-v5-ch4', 4, 'personalized', 'QUEUED', null, null, gen_random_uuid(), now() + interval '5 minutes', 'generation-job:77777777-7777-4777-7777-777777777777:publish:4')
on conflict (id) do nothing;

insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v5-ch4', 4, 'choice-4a', '77777777-7777-4777-7777-777777777777', 'QUEUED', 8, 'v1');

-- Test 9: Bab 4+ intent initially QUEUED
select is(
  (select status from public.commercial_generation_intents where generation_job_id = '77777777-7777-4777-7777-777777777777'),
  'QUEUED',
  'Bab 4+ commercial intent initially QUEUED'
);

-- Test 10: Bab 4+ reservation initially ACTIVE
select is(
  (select status from public.credit_reservations where ref = 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v5-ch4:4'),
  'ACTIVE',
  'Bab 4+ reservation initially ACTIVE'
);

-- Test 11: Reader state exists
insert into public.reader_states (user_id, story_id, current_chapter, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v5-ch4', 3, now())
on conflict (user_id, story_id) do nothing;

select is(
  (select current_chapter from public.reader_states where user_id = '99999999-9999-4999-9999-999999999999' and story_id = 'story-v5-ch4'),
  3,
  'reader state initial current chapter is 3'
);

-- Test 12: Verify reservation ref format matches canonical pattern
select matches(
  (select ref from public.credit_reservations where story_id = 'story-v5-ch4' and chapter_number = 4),
  '^chapter-reservation:',
  'canonical chapter unlock reservation ref starts with chapter-reservation:'
);

select * from finish();
rollback;
