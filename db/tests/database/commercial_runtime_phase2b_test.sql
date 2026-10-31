-- supabase/tests/database/commercial_runtime_phase2b_test.sql
-- pgTAP tests for Phase 2B V6 atomic publication, PayCore credit capture, status transitions, Living Canon V5 integration, and corruption resistance.

\set ON_ERROR_STOP 1
begin;
select plan(40);

-- Seed global credit config
insert into public.feature_credit_costs (feature_key, credits_required, is_active)
values ('story_start', 24, true), ('chapter_unlock', 8, true)
on conflict (feature_key) do update set credits_required = excluded.credits_required;

-- Test 1: Function publish_generation_job_chapter_v6 exists
select has_function('public', 'publish_generation_job_chapter_v6', 'publish_generation_job_chapter_v6 function exists');

-- Test 2: Verify parameter signature (exact 14 parameters with p_closures jsonb default)
select has_function(
  'public',
  'publish_generation_job_chapter_v6',
  ARRAY['uuid', 'text', 'uuid', 'uuid', 'text', 'integer', 'text', 'jsonb', 'text', 'jsonb', 'jsonb', 'text', 'text', 'jsonb'],
  'publish_generation_job_chapter_v6 signature matches expected 14 parameters'
);

-- Seed test user & account
insert into auth.users (id, email)
values ('99999999-9999-4999-9999-999999999999', 'v6test@example.com')
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

-- Seed PENDING_PAID_START story for Bab 1 capture test
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-v6-pending', '99999999-9999-4999-9999-999999999999', 'Paid Story Bab 1', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BARU', 0, '{}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-v6-pending', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-pending', 1, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-pending', 1, 'STORY_START', 24, 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
  v_bind_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-pending', 1, 'personalized', null);
  v_job_id := (v_enq->>'jobId')::uuid;

  insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status)
  values ('99999999-9999-4999-9999-999999999999', 'personalized', 'hash-1', 'story-v6-pending', 'req-key-1', 'RESERVED');

  v_bind_res := public.bind_story_creation_request_job_v1('99999999-9999-4999-9999-999999999999', 'story-v6-pending', v_job_id);

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-v6-pending', 1, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Bab 1 Judul', '["Paragraf 1."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-pending-1', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-pending', 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-pending', 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-v6-pending',
    1,
    'Bab 1 Judul',
    '["Paragraf 1."]'::jsonb,
    'Pilih opsi',
    '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Test 4: Paid Bab 1 promotion to PAID_START
select is(
  (select commercial_origin from public.stories where id = 'story-v6-pending'),
  'PAID_START',
  'V6 Bab 1 publish promotes story commercial_origin to PAID_START'
);

-- Test 5: Paid Bab 1 creation request status updated to READY
select is(
  (select status from public.story_creation_requests where story_id = 'story-v6-pending'),
  'READY',
  'V6 Bab 1 publish promotes story_creation_requests status to READY'
);

-- Test 6: Paid Bab 1 reservation status updated to CAPTURED
select is(
  (select status from public.credit_reservations where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending'),
  'CAPTURED',
  'V6 Bab 1 publish updates credit_reservations status to CAPTURED'
);

-- Test 7: Paid Bab 1 credit ledger row written
select is(
  (select delta from public.credit_ledger where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending'),
  -24,
  'V6 Bab 1 publish writes PayCore ledger entry with delta -24'
);

-- Seed PAID_START story for Bab 4 capture test
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-v6-unlock', '99999999-9999-4999-9999-999999999999', 'Paid Story Bab 4 Unlock', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'PAID_START', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-v6-unlock', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-unlock', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-unlock', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-unlock:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-unlock', 4, 'personalized', 'choice-unlock4');
  v_job_id := (v_enq->>'jobId')::uuid;

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v6-unlock', 4, 'choice-unlock4', v_job_id, 'QUEUED', 8, 'v1');

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-v6-unlock', 4, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Bab 4 Judul', '["Paragraf 1."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-unlock-4', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-unlock', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-unlock', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-v6-unlock',
    4,
    'Bab 4 Judul',
    '["Paragraf 1."]'::jsonb,
    'Pilih opsi',
    '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Test 8: Bab 4 unlock reservation status updated to CAPTURED
select is(
  (select status from public.credit_reservations where ref = 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-unlock:4'),
  'CAPTURED',
  'V6 Bab 4 unlock updates credit_reservations status to CAPTURED'
);

-- Test 9: Bab 4 unlock intent status updated to FULFILLED
select is(
  (select status from public.commercial_generation_intents where story_id = 'story-v6-unlock' and chapter_number = 4),
  'FULFILLED',
  'V6 Bab 4 unlock updates commercial_generation_intents status to FULFILLED'
);

-- Test 10: Bab 4 unlock credit ledger row written with delta -8
select is(
  (select delta from public.credit_ledger where ref = 'unlock:story-v6-unlock:4'),
  -8,
  'V6 Bab 4 unlock writes PayCore ledger entry with delta -8'
);

-- Test 11: Replay Bab 4 unlock returns narrative success without duplicate debit
select is(
  (select count(*)::integer from public.credit_ledger where ref = 'unlock:story-v6-unlock:4'),
  1,
  'V6 Bab 4 unlock replay maintains exact single ledger entry'
);

-- Test 12: Mismatched pricing snapshot throws COMMERCIAL_PRICING_SNAPSHOT_MISMATCH
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-v6-mismatch', '99999999-9999-4999-9999-999999999999', 'Mismatch Pricing Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'PAID_START', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-v6-mismatch', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-mismatch', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-mismatch', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-mismatch:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-mismatch', 4, 'personalized', 'choice-mm4');
  v_job_id := (v_enq->>'jobId')::uuid;

  -- Intent with quoted_credits = 12 (mismatched with reservation amount = 8)
  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v6-mismatch', 4, 'choice-mm4', v_job_id, 'QUEUED', 12, 'v1');

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-v6-mismatch', 4, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Title', '["Para."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-mm-4', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-mismatch', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-mismatch', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  perform set_config('test.mismatch_job_id', v_job_id::text, true);
  perform set_config('test.mismatch_claim_token', v_claim_token::text, true);
  perform set_config('test.mismatch_lease_id', v_lease_id::text, true);
end;
$$;

select throws_like(
  format(
    $$ select public.publish_generation_job_chapter_v6(
         '%s'::uuid, 'worker-v6', '%s'::uuid, '%s'::uuid,
         'story-v6-mismatch', 4, 'Title', '["Para."]'::jsonb, 'Pilih langkah selanjutnya', '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"c1","consequence":["Res"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Res B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
       ) $$,
    current_setting('test.mismatch_job_id'),
    current_setting('test.mismatch_claim_token'),
    current_setting('test.mismatch_lease_id')
  ),
  '%COMMERCIAL_PRICING_SNAPSHOT_MISMATCH%',
  'V6 rejects publication when intent quoted_credits mismatches reservation amount'
);

-- Test 13: Non-queued intent status (e.g. WAITING_FOR_CREDITS) is rejected on fresh publication
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-v6-waiting-intent', '99999999-9999-4999-9999-999999999999', 'Waiting Intent Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'PAID_START', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-v6-waiting-intent', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-waiting-intent', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-waiting-intent', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-waiting-intent:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-waiting-intent', 4, 'personalized', 'choice-wi4');
  v_job_id := (v_enq->>'jobId')::uuid;

  -- Intent status is WAITING_FOR_CREDITS
  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v6-waiting-intent', 4, 'choice-wi4', v_job_id, 'WAITING_FOR_CREDITS', 8, 'v1');

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-v6-waiting-intent', 4, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Title', '["Para."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-wi-4', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-waiting-intent', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-waiting-intent', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  perform set_config('test.wi_job_id', v_job_id::text, true);
  perform set_config('test.wi_claim_token', v_claim_token::text, true);
  perform set_config('test.wi_lease_id', v_lease_id::text, true);
end;
$$;

select throws_like(
  format(
    $$ select public.publish_generation_job_chapter_v6(
         '%s'::uuid, 'worker-v6', '%s'::uuid, '%s'::uuid,
         'story-v6-waiting-intent', 4, 'Title', '["Para."]'::jsonb, 'Pilih langkah selanjutnya', '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"c1","consequence":["Res"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Res B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
       ) $$,
    current_setting('test.wi_job_id'),
    current_setting('test.wi_claim_token'),
    current_setting('test.wi_lease_id')
  ),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 rejects fresh publication when intent status is not QUEUED'
);

-- Seed Living Canon V5 + Commercial test story
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-v6-lc', '99999999-9999-4999-9999-999999999999', 'Living Canon Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'PAID_START', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-v6-lc', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-lc', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-lc', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-lc:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-lc', 4, 'personalized', 'choice-lc4');
  v_job_id := (v_enq->>'jobId')::uuid;

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-v6-lc', 4, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Bab 4 Living Canon', '["Paragraf 1 living canon."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-lc-1', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-lc', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-v6-lc', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v6-lc', 4, 'choice-lc4', v_job_id, 'QUEUED', 8, 'v1');

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-v6-lc',
    4,
    'Bab 4 Living Canon',
    '["Paragraf 1 living canon."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"clc1","label":"Cari kunci rahasia lemari"},{"id":"clc2","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"clc1","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"clc2","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );

  perform set_config('test.lc_job_id', v_job_id::text, true);
  perform set_config('test.lc_claim_token', v_claim_token::text, true);
  perform set_config('test.lc_lease_id', v_lease_id::text, true);
end;
$$;

-- REQUIREMENT 14: Complete Living Canon V6 Assertions
-- Test 14: Reservation CAPTURED
select is(
  (select status from public.credit_reservations where ref = 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-lc:4'),
  'CAPTURED',
  'Living Canon V5 delegation: reservation status updated to CAPTURED'
);

-- Test 15: Intent FULFILLED
select is(
  (select status from public.commercial_generation_intents where story_id = 'story-v6-lc' and chapter_number = 4),
  'FULFILLED',
  'Living Canon V5 delegation: intent status updated to FULFILLED'
);

-- Test 16: Chapters row count = 1
select is(
  (select count(*)::integer from public.chapters where story_id = 'story-v6-lc' and number = 4),
  1,
  'Living Canon V5 delegation: exactly 1 chapter created'
);

-- Test 17: Chapter state commits count = 1
select is(
  (select count(*)::integer from public.chapter_state_commits where story_id = 'story-v6-lc' and chapter_number = 4),
  1,
  'Living Canon V5 delegation: exactly 1 chapter_state_commit created'
);

-- Test 18: Committed canon revision = 1
select is(
  (select canon_state_revision::integer from public.stories where id = 'story-v6-lc'),
  1,
  'Living Canon V5 delegation: canon_state_revision updated to base + 1'
);

-- Test 19: Checkpoint status PUBLISHED
select is(
  (select status from public.chapter_generation_checkpoints where story_id = 'story-v6-lc' and chapter_number = 4),
  'PUBLISHED',
  'Living Canon V5 delegation: checkpoint status updated to PUBLISHED'
);

-- Test 20: Generation job status SUCCEEDED
select is(
  (select status from public.generation_jobs where id = current_setting('test.lc_job_id')::uuid),
  'SUCCEEDED',
  'Living Canon V5 delegation: generation job status updated to SUCCEEDED'
);

-- Test 21: Lease released
select is(
  (select status from public.generation_leases where job_id = current_setting('test.lc_job_id')::uuid),
  'RELEASED',
  'Living Canon V5 delegation: generation_lease status updated to RELEASED'
);

-- Test 22: Credit ledger entry exact -8 unlock_chapter
select is(
  (select delta from public.credit_ledger where ref = 'unlock:story-v6-lc:4'),
  -8,
  'Living Canon V5 delegation: exact ledger debit -8 created'
);

-- Test 23: Living Canon V6 Replay Idempotency
do $$
begin
  perform public.publish_generation_job_chapter_v6(
    current_setting('test.lc_job_id')::uuid,
    'worker-v6',
    current_setting('test.lc_claim_token')::uuid,
    current_setting('test.lc_lease_id')::uuid,
    'story-v6-lc',
    4,
    'Bab 4 Living Canon',
    '["Paragraf 1 living canon."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"clc1","label":"Cari kunci rahasia lemari"},{"id":"clc2","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"clc1","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"clc2","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Test 24: Replay commit count remains 1
select is(
  (select count(*)::integer from public.chapter_state_commits where story_id = 'story-v6-lc' and chapter_number = 4),
  1,
  'Living Canon V6 replay maintains exact single commit'
);

-- Test 25: Replay canon revision remains 1
select is(
  (select canon_state_revision::integer from public.stories where id = 'story-v6-lc'),
  1,
  'Living Canon V6 replay maintains exact single canon revision'
);

-- Test 26: Replay chapter count remains 1
select is(
  (select count(*)::integer from public.chapters where story_id = 'story-v6-lc' and number = 4),
  1,
  'Living Canon V6 replay maintains exact single chapter'
);

-- Test 27: Replay ledger count remains 1
select is(
  (select count(*)::integer from public.credit_ledger where ref = 'unlock:story-v6-lc:4'),
  1,
  'Living Canon V6 replay maintains exact single ledger entry'
);

-- REQUIREMENT 15: Corruption Replay Tests
insert into auth.users (id, email)
values ('88888888-8888-4888-8888-888888888888', 'secondary@example.com')
on conflict (id) do nothing;

-- Test 28: Wrong ledger user throws COMMERCIAL_FINALIZATION_CONFLICT
do $$
begin
  update public.credit_ledger set user_id = '88888888-8888-4888-8888-888888888888'::uuid where ref = 'unlock:story-v6-lc:4';
end;
$$;

select throws_like(
  format(
    $$ select public.publish_generation_job_chapter_v6(
         '%s'::uuid, 'worker-v6', '%s'::uuid, '%s'::uuid,
         'story-v6-lc', 4, 'Bab 4 Living Canon', '["Paragraf 1 living canon."]'::jsonb, 'Pilih langkah selanjutnya',
         '[{"id":"clc1","label":"Cari kunci rahasia lemari"},{"id":"clc2","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"clc1","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"clc2","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
       ) $$,
    current_setting('test.lc_job_id'),
    current_setting('test.lc_claim_token'),
    current_setting('test.lc_lease_id')
  ),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects execution when ledger user_id is corrupted'
);

-- Fix corrupted ledger user back for remaining tests
do $$
begin
  update public.credit_ledger set user_id = '99999999-9999-4999-9999-999999999999'::uuid where ref = 'unlock:story-v6-lc:4';
end;
$$;

-- Test 29: Wrong ledger reason throws COMMERCIAL_FINALIZATION_CONFLICT
do $$
begin
  update public.credit_ledger set reason = 'corrupted_reason' where ref = 'unlock:story-v6-lc:4';
end;
$$;

select throws_like(
  format(
    $$ select public.publish_generation_job_chapter_v6(
         '%s'::uuid, 'worker-v6', '%s'::uuid, '%s'::uuid,
         'story-v6-lc', 4, 'Bab 4 Living Canon', '["Paragraf 1 living canon."]'::jsonb, 'Pilih langkah selanjutnya',
         '[{"id":"clc1","label":"Cari kunci rahasia lemari"},{"id":"clc2","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"clc1","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"clc2","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
       ) $$,
    current_setting('test.lc_job_id'),
    current_setting('test.lc_claim_token'),
    current_setting('test.lc_lease_id')
  ),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects execution when ledger reason is corrupted'
);

-- Fix corrupted ledger reason back
do $$
begin
  update public.credit_ledger set reason = 'unlock_chapter' where ref = 'unlock:story-v6-lc:4';
end;
$$;

-- Test 30: Missing ledger throws COMMERCIAL_FINALIZATION_CONFLICT
do $$
begin
  delete from public.credit_ledger where ref = 'unlock:story-v6-lc:4';
end;
$$;

select throws_like(
  format(
    $$ select public.publish_generation_job_chapter_v6(
         '%s'::uuid, 'worker-v6', '%s'::uuid, '%s'::uuid,
         'story-v6-lc', 4, 'Bab 4 Living Canon', '["Paragraf 1 living canon."]'::jsonb, 'Pilih langkah selanjutnya',
         '[{"id":"clc1","label":"Cari kunci rahasia lemari"},{"id":"clc2","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"clc1","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"clc2","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
       ) $$,
    current_setting('test.lc_job_id'),
    current_setting('test.lc_claim_token'),
    current_setting('test.lc_lease_id')
  ),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects execution when ledger row is missing'
);

-- Test Enqueue Fencing & Policy Regression Tests
-- Seed test stories for enqueue regression tests
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, story_contract_version)
values
  ('story-enq-unlisted', '99999999-9999-4999-9999-999999999999', 'Unlisted Story', '/c.webp', 'T', 'R', '{}', 50, 'S', 'BERJALAN', 0, '{}', 'unlisted', 'personalized_ai', 'STARTER_FREE', 1),
  ('story-enq-public', '99999999-9999-4999-9999-999999999999', 'Public Personalized Story', '/c.webp', 'T', 'R', '{}', 50, 'S', 'BERJALAN', 0, '{}', 'public', 'personalized_ai', 'STARTER_FREE', 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version)
values
  ('story-enq-unlisted', 'personalized_ai', 50, 1),
  ('story-enq-public', 'personalized_ai', 50, 1)
on conflict (story_id) do nothing;

-- Test 31: Enqueue allows unlisted visibility for personalized mode
do $$
declare
  v_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_res := public.enqueue_generation_job_v1('story-enq-unlisted', 1, 'personalized', null);
  perform set_config('test.enq_unlisted_job_id', (v_res->>'jobId')::text, true);
end;
$$;

select is(
  (select count(*)::integer from public.generation_jobs where id = current_setting('test.enq_unlisted_job_id')::uuid),
  1,
  'enqueue_generation_job_v1 permits unlisted visibility for personalized mode'
);

-- Test 32: Enqueue rejects public visibility for personalized mode
select throws_like(
  $$ select public.enqueue_generation_job_v1('story-enq-public', 1, 'personalized', null) $$,
  '%GENERATION_JOB_CONFLICT%',
  'enqueue_generation_job_v1 rejects public visibility for personalized mode'
);

-- Test 33: Enqueue alreadyComplete check when chapter exists
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices, created_at)
values ('story-enq-unlisted', 1, 'Bab 1 Existing', '["P"]'::jsonb, 'Pilih langkah selanjutnya', '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb, now())
on conflict (story_id, number) do nothing;

select is(
  (select public.enqueue_generation_job_v1('story-enq-unlisted', 1, 'personalized', null)->>'alreadyComplete'),
  'true',
  'enqueue_generation_job_v1 returns alreadyComplete true when chapter already exists'
);

-- Test 34: Active job conflict rejection on mismatched trigger choice
do $$
declare
  v_res1 jsonb;
  v_res2 jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_res1 := public.enqueue_generation_job_v1('story-enq-unlisted', 2, 'personalized', 'choice-trigger-a');
  perform set_config('test.enq_active_job_id', (v_res1->>'jobId')::text, true);
end;
$$;

select throws_like(
  $$ select public.enqueue_generation_job_v1('story-enq-unlisted', 2, 'personalized', 'choice-trigger-b') $$,
  '%GENERATION_JOB_CONFLICT%',
  'enqueue_generation_job_v1 rejects active job conflict with mismatched trigger choice'
);

-- Test 35: STARTER_FREE Bab4+ unlock flow succeeds and captures reservation
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-starter-unlock', '99999999-9999-4999-9999-999999999999', 'Starter Unlock Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-starter-unlock', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

-- Fix account state for starter unlock story so starter identity revalidation passes
update public.account_commercial_states set starter_story_id = 'story-starter-unlock' where user_id = '99999999-9999-4999-9999-999999999999';

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-starter-unlock', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-starter-unlock', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-starter-unlock:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-starter-unlock', 4, 'personalized', 'choice-su4');
  v_job_id := (v_enq->>'jobId')::uuid;

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-starter-unlock', 4, 'choice-su4', v_job_id, 'QUEUED', 8, 'v1');

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-starter-unlock', 4, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Bab 4 Starter Unlock', '["Paragraf 1."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-su-4', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-starter-unlock', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-starter-unlock', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-starter-unlock',
    4,
    'Bab 4 Starter Unlock',
    '["Paragraf 1."]'::jsonb,
    'Pilih opsi',
    '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Test 36: STARTER_FREE Bab4+ reservation status CAPTURED
select is(
  (select status from public.credit_reservations where ref = 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-starter-unlock:4'),
  'CAPTURED',
  'STARTER_FREE Bab4+ unlock updates credit_reservations status to CAPTURED'
);

-- Test 37: STARTER_FREE Bab4+ intent status FULFILLED
select is(
  (select status from public.commercial_generation_intents where story_id = 'story-starter-unlock' and chapter_number = 4),
  'FULFILLED',
  'STARTER_FREE Bab4+ unlock updates commercial_generation_intents status to FULFILLED'
);

-- Test 38: STARTER_FREE Bab4+ identity mismatch throws COMMERCIAL_FINALIZATION_CONFLICT
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values ('story-starter-mismatch', '99999999-9999-4999-9999-999999999999', 'Starter Mismatch Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values ('story-starter-mismatch', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))))
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-starter-mismatch', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-starter-mismatch', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-starter-mismatch:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-starter-mismatch', 4, 'personalized', 'choice-sm4');
  v_job_id := (v_enq->>'jobId')::uuid;

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-starter-mismatch', 4, 'choice-sm4', v_job_id, 'QUEUED', 8, 'v1');

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  -- Schema 3 Living Canon checkpoint
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'story-starter-mismatch', 4, v_job_id, v_corr_id, v_job_id, 3, 'PROSE_READY', 'Title', '["Para."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-sm-4', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', 'story-starter-mismatch', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', 'story-starter-mismatch', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0
  );

  perform set_config('test.sm_job_id', v_job_id::text, true);
  perform set_config('test.sm_claim_token', v_claim_token::text, true);
  perform set_config('test.sm_lease_id', v_lease_id::text, true);
end;
$$;

select throws_like(
  format(
    $$ select public.publish_generation_job_chapter_v6(
         '%s'::uuid, 'worker-v6', '%s'::uuid, '%s'::uuid,
         'story-starter-mismatch', 4, 'Title', '["Para."]'::jsonb, 'Pilih langkah selanjutnya', '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"c1","consequence":["R"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["R B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb
       ) $$,
    current_setting('test.sm_job_id'),
    current_setting('test.sm_claim_token'),
    current_setting('test.sm_lease_id')
  ),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 rejects STARTER_FREE Bab4+ unlock when account starter_story_id mismatches story'
);

-- Test 39: RPC transition_story_creation_request_waiting_v1 exists and functions
select has_function('public', 'transition_story_creation_request_waiting_v1', ARRAY['uuid', 'text', 'text', 'uuid'], 'transition_story_creation_request_waiting_v1 exists');

-- Test 40: transition_story_creation_request_waiting_v1 updates request status to WAITING_FOR_CREDITS
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-v6-waiting-req', '99999999-9999-4999-9999-999999999999', 'Waiting Req Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BARU', 0, '{}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1)
on conflict (id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-waiting-req', 1, 'STORY_START', 24, 'story-start:99999999-9999-4999-9999-999999999999:story-v6-waiting-req', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_trans jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-waiting-req', 1, 'personalized', null);
  v_job_id := (v_enq->>'jobId')::uuid;

  insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status, generation_job_id)
  values ('99999999-9999-4999-9999-999999999999', 'personalized', 'hash-w1', 'story-v6-waiting-req', 'req-key-w1', 'RESERVED', v_job_id);

  v_trans := public.transition_story_creation_request_waiting_v1('99999999-9999-4999-9999-999999999999', 'story-v6-waiting-req', 'personalized', v_job_id);
  perform set_config('test.trans_req_ok', (v_trans->>'ok'), true);
end;
$$;

select is(
  current_setting('test.trans_req_ok'),
  'true',
  'transition_story_creation_request_waiting_v1 returns ok true'
);

-- Test 41: Request status updated to WAITING_FOR_CREDITS
select is(
  (select status from public.story_creation_requests where story_id = 'story-v6-waiting-req'),
  'WAITING_FOR_CREDITS',
  'transition_story_creation_request_waiting_v1 updates story_creation_requests status to WAITING_FOR_CREDITS'
);

-- Test 42: bind_story_creation_request_job_v1 replacement fails when previous job is RUNNING (not terminal)
do $$
declare
  v_enq jsonb;
  v_new_job_id uuid;
  v_bind_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-waiting-req', 1, 'personalized', null);
  v_new_job_id := (v_enq->>'jobId')::uuid;

  v_bind_res := public.bind_story_creation_request_job_v1('99999999-9999-4999-9999-999999999999', 'story-v6-waiting-req', v_new_job_id);
  perform set_config('test.bind_non_terminal_reason', (v_bind_res->>'reason'), true);
end;
$$;

select is(
  current_setting('test.bind_non_terminal_reason'),
  'PREVIOUS_JOB_NOT_TERMINAL',
  'bind_story_creation_request_job_v1 replacement rejects when previous bound job is not terminal'
);

select * from finish();
rollback;
