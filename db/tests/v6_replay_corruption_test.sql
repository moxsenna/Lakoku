-- supabase/tests/v6_replay_corruption_test.sql
-- Comprehensive hardening, corruption matrix, and ACL pgTAP test suite for V6 commercial publication

\set ON_ERROR_STOP 1
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    perform set_config('lakoku.test_target', 'local-cli', true);
  end if;
end
$$;

select plan(34);

-- 1. ACL Check for reactivate_commercial_chapter_reservation_v1 (4 tests)
select has_function('public', 'reactivate_commercial_chapter_reservation_v1', array['uuid', 'text', 'integer', 'uuid'], 'reactivate_commercial_chapter_reservation_v1 exists');
select ok(not has_function_privilege('anon', 'public.reactivate_commercial_chapter_reservation_v1(uuid, text, integer, uuid)', 'EXECUTE'), 'anon cannot execute reactivate_commercial_chapter_reservation_v1');
select ok(not has_function_privilege('authenticated', 'public.reactivate_commercial_chapter_reservation_v1(uuid, text, integer, uuid)', 'EXECUTE'), 'authenticated cannot execute reactivate_commercial_chapter_reservation_v1');
select ok(has_function_privilege('service_role', 'public.reactivate_commercial_chapter_reservation_v1(uuid, text, integer, uuid)', 'EXECUTE'), 'service_role can execute reactivate_commercial_chapter_reservation_v1');

-- 2. Setup environment for Block 2 (Fresh Paid Story Start corruption test)
select set_config('lakoku.corrupt_user', gen_random_uuid()::text, true);
select set_config('lakoku.corrupt_story', ('story-' || gen_random_uuid())::text, true);
select set_config('lakoku.corrupt_starter', ('starter-' || gen_random_uuid())::text, true);

insert into auth.users (id, email)
values (current_setting('lakoku.corrupt_user')::uuid, 'v6_corrupt_' || current_setting('lakoku.corrupt_user') || '@test.local');

insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at)
values (current_setting('lakoku.corrupt_user')::uuid, current_setting('lakoku.corrupt_starter'), clock_timestamp());

insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values (current_setting('lakoku.corrupt_story'), 'Corrupt Test Story', current_setting('lakoku.corrupt_user')::uuid, 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values (current_setting('lakoku.corrupt_story'), 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10))));

insert into public.reader_states (user_id, story_id, current_chapter, status)
values (current_setting('lakoku.corrupt_user')::uuid, current_setting('lakoku.corrupt_story'), 1, 'BERJALAN');

insert into public.credit_ledger (user_id, delta, reason, ref)
values (current_setting('lakoku.corrupt_user')::uuid, 48, 'seed', 'seed:' || current_setting('lakoku.corrupt_user'));

-- Seed invalid STORY_START reservation with amount = 1 (should be 24)
insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values (current_setting('lakoku.corrupt_user')::uuid, current_setting('lakoku.corrupt_story'), 1, 'STORY_START', 1, 'story-start:' || current_setting('lakoku.corrupt_user') || ':' || current_setting('lakoku.corrupt_story'), 'ACTIVE', clock_timestamp() + interval '1 hour');

-- Enqueue job, bind creation request, claim job with lease
select set_config('request.jwt.claim.sub', current_setting('lakoku.corrupt_user'), true);
select public.enqueue_generation_job_v1(current_setting('lakoku.corrupt_story'), 1, 'personalized', null);

do $$
declare
  v_user uuid := current_setting('lakoku.corrupt_user')::uuid;
  v_story text := current_setting('lakoku.corrupt_story');
  v_job uuid;
  v_corr uuid;
  v_claim uuid;
  v_lease uuid;
begin
  select id, correlation_id into v_job, v_corr from public.generation_jobs where story_id = v_story and chapter_number = 1;
  perform set_config('lakoku.corrupt_job', v_job::text, true);
  perform set_config('lakoku.corrupt_corr', v_corr::text, true);

  insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status)
  values (v_user, 'personalized', 'hash-corrupt-1', v_story, 'req-corrupt-1', 'RESERVED');

  perform set_config('role', 'service_role', true);
  perform public.bind_story_creation_request_job_v1(v_user, v_story, v_job);

  v_claim := (public.claim_generation_job_by_id_v1(v_job, 'worker-corrupt')->'job'->>'claim_token')::uuid;
  v_lease := (public.acquire_generation_job_lease_v1(v_job, 'worker-corrupt', v_claim, 120)->>'lease_id')::uuid;

  perform set_config('lakoku.corrupt_claim', v_claim::text, true);
  perform set_config('lakoku.corrupt_lease', v_lease::text, true);

  insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision)
  values (v_story, 1, v_job, v_corr, v_job, 3, 'PROSE_READY', 'Bab 1 Corrupt', '["Paragraf corrupt."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-corrupt', 'personalized', 1, clock_timestamp() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);
end
$$;

-- Test 5: Fresh Paid Start with reservation amount=1 MUST FAIL
select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-corrupt', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 Corrupt', '["Paragraf corrupt."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.corrupt_job'), current_setting('lakoku.corrupt_claim'), current_setting('lakoku.corrupt_lease'), current_setting('lakoku.corrupt_story')),
  '%INVALID_STORY_START_RESERVATION_AMOUNT%',
  'V6 fresh Paid Story Start with reservation amount=1 fails and rolls back'
);

-- Tests 6-10: Verify DB rollbacks after failed publication (including locked invariants)
select results_eq(
  format($$ select count(*)::integer from public.chapters where story_id = '%s' and number = 1 $$, current_setting('lakoku.corrupt_story')),
  array[0],
  'No chapter published after rollback'
);

select results_eq(
  format($$ select count(*)::integer from public.credit_ledger where user_id = '%s'::uuid and reason = 'story_start' $$, current_setting('lakoku.corrupt_user')),
  array[0],
  'No story_start debit in credit_ledger after rollback'
);

select results_eq(
  format($$ select commercial_origin from public.stories where id = '%s' $$, current_setting('lakoku.corrupt_story')),
  array['PENDING_PAID_START'::text],
  'Story remains PENDING_PAID_START'
);

select results_eq(
  format($$ select status from public.credit_reservations where ref = 'story-start:' || '%s' || ':' || '%s' $$, current_setting('lakoku.corrupt_user'), current_setting('lakoku.corrupt_story')),
  array['ACTIVE'::text],
  'Reservation status remains ACTIVE (NOT CAPTURED) after rollback'
);

select results_eq(
  format($$ select status from public.story_creation_requests where story_id = '%s' $$, current_setting('lakoku.corrupt_story')),
  array['RESERVED'::text],
  'Story creation request status remains RESERVED after rollback'
);

-- 3. Setup environment for Block 3 (Bab 4 Replay Price Catalog Change Test)
select set_config('lakoku.rp_user', gen_random_uuid()::text, false);
select set_config('lakoku.rp_story', ('story-' || gen_random_uuid())::text, false);

select set_config('role', 'postgres', true);
insert into auth.users (id, email)
values (current_setting('lakoku.rp_user')::uuid, 'v6_replay_price_' || current_setting('lakoku.rp_user') || '@test.local');

insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at)
values (current_setting('lakoku.rp_user')::uuid, current_setting('lakoku.rp_story'), clock_timestamp());

insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values (current_setting('lakoku.rp_story'), 'Replay Price Story', current_setting('lakoku.rp_user')::uuid, 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values (current_setting('lakoku.rp_story'), 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10))));

insert into public.reader_states (user_id, story_id, current_chapter, status)
values (current_setting('lakoku.rp_user')::uuid, current_setting('lakoku.rp_story'), 3, 'BERJALAN');

insert into public.credit_ledger (user_id, delta, reason, ref)
values (current_setting('lakoku.rp_user')::uuid, 16, 'seed', 'seed:' || current_setting('lakoku.rp_user'));

-- Reserve Bab 4 at catalog price 8
select set_config('role', 'service_role', true);
select public.reserve_chapter_unlock_v1(current_setting('lakoku.rp_user')::uuid, current_setting('lakoku.rp_story'), 4);

select set_config('request.jwt.claim.sub', current_setting('lakoku.rp_user'), true);
select public.enqueue_generation_job_v1(current_setting('lakoku.rp_story'), 4, 'personalized', 'choice-replay-1');

do $$
declare
  v_user uuid := current_setting('lakoku.rp_user')::uuid;
  v_story text := current_setting('lakoku.rp_story');
  v_job uuid;
  v_corr uuid;
  v_claim uuid;
  v_lease uuid;
begin
  select id, correlation_id into v_job, v_corr from public.generation_jobs where story_id = v_story and chapter_number = 4;
  perform set_config('lakoku.rp_job', v_job::text, false);
  perform set_config('lakoku.rp_corr', v_corr::text, false);

  v_claim := (public.claim_generation_job_by_id_v1(v_job, 'worker-rp')->'job'->>'claim_token')::uuid;
  v_lease := (public.acquire_generation_job_lease_v1(v_job, 'worker-rp', v_claim, 120)->>'lease_id')::uuid;

  perform set_config('lakoku.rp_claim', v_claim::text, false);
  perform set_config('lakoku.rp_lease', v_lease::text, false);

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), v_user, v_story, 4, 'choice-replay-1', v_job, 'QUEUED', 8, 'v1');

  insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision)
  values (v_story, 4, v_job, v_corr, v_job, 3, 'PROSE_READY', 'Bab 4 Replay', '["Paragraf."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-rp', 'personalized', 1, clock_timestamp() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);
end
$$;

-- First publish at price 8
select public.publish_generation_job_chapter_v6(
  current_setting('lakoku.rp_job')::uuid, 'worker-rp', current_setting('lakoku.rp_claim')::uuid, current_setting('lakoku.rp_lease')::uuid, current_setting('lakoku.rp_story'), 4,
  'Bab 4 Replay', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
  '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null, null, '[]'::jsonb
);

-- Update active catalog price to 10!
update public.feature_credit_costs set credits_required = 10 where feature_key = 'chapter_unlock';

-- Test 11: Replay publication MUST still succeed using historical quote (8)!
select results_eq(
  format($$ select (public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-rp', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Replay', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  )->>'ok')::boolean $$, current_setting('lakoku.rp_job'), current_setting('lakoku.rp_claim'), current_setting('lakoku.rp_lease'), current_setting('lakoku.rp_story')),
  array[true],
  'Replay succeeds despite active catalog price changing from 8 to 10'
);

-- Revert catalog price to 8
update public.feature_credit_costs set credits_required = 8 where feature_key = 'chapter_unlock';

-- Tests 12-13: Post-replay DB checks
select results_eq(
  format($$ select count(*)::integer from public.chapters where story_id = '%s' and number = 4 $$, current_setting('lakoku.rp_story')),
  array[1],
  'Exactly 1 chapter post-replay'
);

select results_eq(
  format($$ select count(*)::integer from public.credit_ledger where user_id = '%s'::uuid and reason = 'unlock_chapter' $$, current_setting('lakoku.rp_user')),
  array[1],
  'Exactly 1 debit ledger entry post-replay'
);

-- 4. Setup environment for Block 4 (Bab 4 & Bab 1 Mutation Corruption Matrix)
select set_config('lakoku.mx_user', gen_random_uuid()::text, true);
select set_config('lakoku.mx_story', ('story-' || gen_random_uuid())::text, true);

select set_config('role', 'postgres', true);
insert into auth.users (id, email)
values (current_setting('lakoku.mx_user')::uuid, 'v6_matrix_' || current_setting('lakoku.mx_user') || '@test.local');

insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at)
values (current_setting('lakoku.mx_user')::uuid, current_setting('lakoku.mx_story'), clock_timestamp());

insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values (current_setting('lakoku.mx_story'), 'Matrix Story', current_setting('lakoku.mx_user')::uuid, 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values (current_setting('lakoku.mx_story'), 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10))));

insert into public.reader_states (user_id, story_id, current_chapter, status)
values (current_setting('lakoku.mx_user')::uuid, current_setting('lakoku.mx_story'), 3, 'BERJALAN');

insert into public.credit_ledger (user_id, delta, reason, ref)
values (current_setting('lakoku.mx_user')::uuid, 32, 'seed', 'seed:' || current_setting('lakoku.mx_user'));

-- Test 14: Reservation amount mismatch (reservation amount=5, intent quoted_credits=8)
do $$
declare
  v_user uuid := current_setting('lakoku.mx_user')::uuid;
  v_story text := current_setting('lakoku.mx_story');
  v_job uuid;
  v_corr uuid;
  v_claim uuid;
  v_lease uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
  values (v_user, v_story, 4, 'CHAPTER_UNLOCK', 5, 'chapter-reservation:' || v_user::text || ':' || v_story || ':4', 'ACTIVE', clock_timestamp() + interval '1 hour');

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform public.enqueue_generation_job_v1(v_story, 4, 'personalized', 'choice-mx-1');

  select id, correlation_id into v_job, v_corr from public.generation_jobs where story_id = v_story and chapter_number = 4;
  perform set_config('lakoku.mx_job', v_job::text, true);
  perform set_config('lakoku.mx_corr', v_corr::text, true);

  perform set_config('role', 'service_role', true);
  v_claim := (public.claim_generation_job_by_id_v1(v_job, 'worker-mx')->'job'->>'claim_token')::uuid;
  v_lease := (public.acquire_generation_job_lease_v1(v_job, 'worker-mx', v_claim, 120)->>'lease_id')::uuid;

  perform set_config('lakoku.mx_claim', v_claim::text, true);
  perform set_config('lakoku.mx_lease', v_lease::text, true);

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), v_user, v_story, 4, 'choice-mx-1', v_job, 'QUEUED', 8, 'v1');

  insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision)
  values (v_story, 4, v_job, v_corr, v_job, 3, 'PROSE_READY', 'Bab 4 Matrix', '["Paragraf."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-mx', 'personalized', 1, clock_timestamp() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);
end
$$;

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_PRICING_SNAPSHOT_MISMATCH%',
  'V6 rejects reservation amount mismatch (amount=5 vs quote=8)'
);

-- Test 15: Intent status mismatch (intent status = 'WAITING_FOR_CREDITS')
update public.commercial_generation_intents set status = 'WAITING_FOR_CREDITS' where generation_job_id = current_setting('lakoku.mx_job')::uuid;

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_%',
  'V6 rejects intent status WAITING_FOR_CREDITS'
);

-- Reset intent back to QUEUED and fix reservation amount to 8 for subsequent tests
update public.commercial_generation_intents set status = 'QUEUED' where generation_job_id = current_setting('lakoku.mx_job')::uuid;
update public.credit_reservations set amount = 8 where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

-- Setup dummy user for FK valid user tests
select set_config('role', 'postgres', true);
select set_config('lakoku.dummy_user', gen_random_uuid()::text, true);
insert into auth.users (id, email) values (current_setting('lakoku.dummy_user')::uuid, 'dummy_' || current_setting('lakoku.dummy_user') || '@test.local');
select set_config('role', 'service_role', true);

-- Test 16: Intent wrong user_id
update public.commercial_generation_intents set user_id = current_setting('lakoku.dummy_user')::uuid where generation_job_id = current_setting('lakoku.mx_job')::uuid;

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects intent wrong user_id'
);

update public.commercial_generation_intents set user_id = current_setting('lakoku.mx_user')::uuid where generation_job_id = current_setting('lakoku.mx_job')::uuid;

-- Setup dummy generation job for FK valid job tests
select set_config('lakoku.dummy_job', gen_random_uuid()::text, true);
insert into public.generation_jobs (
  id, user_id, story_id, chapter_number, generation_kind, status, deadline_at, publication_idempotency_key
) values (
  current_setting('lakoku.dummy_job')::uuid, current_setting('lakoku.mx_user')::uuid, current_setting('lakoku.mx_story'), 44, 'personalized', 'QUEUED', clock_timestamp() + interval '1 hour', 'generation-job:' || current_setting('lakoku.dummy_job') || ':publish:44'
);

-- Test 17: Intent wrong generation_job_id
update public.commercial_generation_intents set generation_job_id = current_setting('lakoku.dummy_job')::uuid where user_id = current_setting('lakoku.mx_user')::uuid;

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects intent wrong generation_job_id'
);

update public.commercial_generation_intents set generation_job_id = current_setting('lakoku.mx_job')::uuid where user_id = current_setting('lakoku.mx_user')::uuid;

-- Test 18: Reservation wrong story_id
update public.credit_reservations set story_id = 'story-wrong' where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects reservation wrong story_id'
);

update public.credit_reservations set story_id = current_setting('lakoku.mx_story') where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

-- Test 19: Reservation wrong chapter_number
update public.credit_reservations set chapter_number = 5 where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects reservation wrong chapter_number'
);

update public.credit_reservations set chapter_number = 4 where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

-- Test 20: Reservation wrong reservation_kind
update public.credit_reservations set reservation_kind = 'STORY_START' where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-mx', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Matrix', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.mx_job'), current_setting('lakoku.mx_claim'), current_setting('lakoku.mx_lease'), current_setting('lakoku.mx_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects reservation wrong reservation_kind'
);

update public.credit_reservations set reservation_kind = 'CHAPTER_UNLOCK' where ref = 'chapter-reservation:' || current_setting('lakoku.mx_user') || ':' || current_setting('lakoku.mx_story') || ':4';

-- 5. Setup environment for Block 5 (Bab 1 Story Creation Request & STORY_START Provenance Corruption Matrix)
select set_config('lakoku.b1_user', gen_random_uuid()::text, true);
select set_config('lakoku.b1_story', ('story-' || gen_random_uuid())::text, true);

select set_config('role', 'postgres', true);
insert into auth.users (id, email)
values (current_setting('lakoku.b1_user')::uuid, 'v6_b1_' || current_setting('lakoku.b1_user') || '@test.local');

insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at)
values (current_setting('lakoku.b1_user')::uuid, current_setting('lakoku.b1_story'), clock_timestamp());

insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version)
values (current_setting('lakoku.b1_story'), 'B1 Matrix Story', current_setting('lakoku.b1_user')::uuid, 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json)
values (current_setting('lakoku.b1_story'), 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10))));

insert into public.reader_states (user_id, story_id, current_chapter, status)
values (current_setting('lakoku.b1_user')::uuid, current_setting('lakoku.b1_story'), 1, 'BERJALAN');

insert into public.credit_ledger (user_id, delta, reason, ref)
values (current_setting('lakoku.b1_user')::uuid, 48, 'seed', 'seed:' || current_setting('lakoku.b1_user'));

-- Valid STORY_START reservation (amount=24)
insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values (current_setting('lakoku.b1_user')::uuid, current_setting('lakoku.b1_story'), 1, 'STORY_START', 24, 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story'), 'ACTIVE', clock_timestamp() + interval '1 hour');

select set_config('request.jwt.claim.sub', current_setting('lakoku.b1_user'), true);
select public.enqueue_generation_job_v1(current_setting('lakoku.b1_story'), 1, 'personalized', null);

do $$
declare
  v_user uuid := current_setting('lakoku.b1_user')::uuid;
  v_story text := current_setting('lakoku.b1_story');
  v_job uuid;
  v_corr uuid;
  v_claim uuid;
  v_lease uuid;
begin
  select id, correlation_id into v_job, v_corr from public.generation_jobs where story_id = v_story and chapter_number = 1;
  perform set_config('lakoku.b1_job', v_job::text, true);
  perform set_config('lakoku.b1_corr', v_corr::text, true);

  insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status)
  values (v_user, 'personalized', 'hash-b1-1', v_story, 'req-b1-1', 'RESERVED');

  perform set_config('role', 'service_role', true);
  perform public.bind_story_creation_request_job_v1(v_user, v_story, v_job);

  v_claim := (public.claim_generation_job_by_id_v1(v_job, 'worker-b1')->'job'->>'claim_token')::uuid;
  v_lease := (public.acquire_generation_job_lease_v1(v_job, 'worker-b1', v_claim, 120)->>'lease_id')::uuid;

  perform set_config('lakoku.b1_claim', v_claim::text, true);
  perform set_config('lakoku.b1_lease', v_lease::text, true);

  insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision)
  values (v_story, 1, v_job, v_corr, v_job, 3, 'PROSE_READY', 'Bab 1 B1', '["Paragraf B1."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-b1', 'personalized', 1, clock_timestamp() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', v_story, 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);
end
$$;

-- Test 21: Creation request wrong status (status = 'WAITING_FOR_CREDITS')
update public.story_creation_requests set status = 'WAITING_FOR_CREDITS' where story_id = current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 rejects creation request wrong status (WAITING_FOR_CREDITS)'
);

update public.story_creation_requests set status = 'RESERVED' where story_id = current_setting('lakoku.b1_story');

-- Test 22: Creation request wrong owner_user_id
update public.story_creation_requests set owner_user_id = current_setting('lakoku.dummy_user')::uuid where story_id = current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects creation request wrong owner_user_id'
);

update public.story_creation_requests set owner_user_id = current_setting('lakoku.b1_user')::uuid where story_id = current_setting('lakoku.b1_story');

-- Test 23: Creation request wrong generation_job_id
update public.story_creation_requests set generation_job_id = current_setting('lakoku.dummy_job')::uuid where story_id = current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects creation request wrong generation_job_id'
);

update public.story_creation_requests set generation_job_id = current_setting('lakoku.b1_job')::uuid where story_id = current_setting('lakoku.b1_story');

-- Test 24: Creation request request_kind mismatch (request_kind = 'premium_clone' while story_mode = 'personalized_ai')
update public.story_creation_requests set request_kind = 'premium_clone' where story_id = current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects creation request request_kind mismatch'
);

update public.story_creation_requests set request_kind = 'personalized' where story_id = current_setting('lakoku.b1_story');

-- Test 25: STORY_START reservation wrong story_id
update public.credit_reservations set story_id = 'story-wrong-b1' where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects STORY_START reservation wrong story_id'
);

update public.credit_reservations set story_id = current_setting('lakoku.b1_story') where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

-- Test 26: STORY_START reservation wrong chapter_number
update public.credit_reservations set chapter_number = 2 where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects STORY_START reservation wrong chapter_number'
);

update public.credit_reservations set chapter_number = 1 where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

-- Test 27: STORY_START reservation wrong reservation_kind
update public.credit_reservations set reservation_kind = 'CHAPTER_UNLOCK' where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_PROVENANCE_MISSING%',
  'V6 rejects STORY_START reservation wrong reservation_kind'
);

update public.credit_reservations set reservation_kind = 'STORY_START' where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

-- Test 28: STORY_START reservation wrong amount (amount=12 instead of active price 24)
update public.credit_reservations set amount = 12 where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%INVALID_STORY_START_RESERVATION_AMOUNT%',
  'V6 rejects STORY_START reservation wrong amount (amount=12 vs active=24)'
);

update public.credit_reservations set amount = 24 where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

-- Test 29: Replay Paid Start request status mismatch (story is PAID_START, but request status is NOT 'READY')
update public.stories set commercial_origin = 'PAID_START' where id = current_setting('lakoku.b1_story');
update public.credit_reservations set status = 'CAPTURED' where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');
-- Request status is still 'RESERVED' (instead of 'READY')
select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects Paid Start request status mismatch (status=RESERVED instead of READY)'
);

-- Set request status to READY and insert valid ledger entry for Replay Story Start Ledger tests
update public.story_creation_requests set status = 'READY' where story_id = current_setting('lakoku.b1_story');
insert into public.credit_ledger (user_id, delta, reason, ref)
values (current_setting('lakoku.b1_user')::uuid, -24, 'story_start', 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story'));

-- Test 30: Story Start replay ledger wrong delta (delta = -10 instead of -24)
update public.credit_ledger set delta = -10 where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects Story Start ledger wrong delta (-10 instead of -24)'
);

update public.credit_ledger set delta = -24 where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

-- Test 31: Story Start replay ledger wrong user
update public.credit_ledger set user_id = current_setting('lakoku.dummy_user')::uuid where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects Story Start ledger wrong user'
);

update public.credit_ledger set user_id = current_setting('lakoku.b1_user')::uuid where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

-- Test 32: Story Start replay ledger wrong reason (reason = 'unlock_chapter' instead of 'story_start')
update public.credit_ledger set reason = 'unlock_chapter' where ref = 'story-start:' || current_setting('lakoku.b1_user') || ':' || current_setting('lakoku.b1_story');

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-b1', '%s'::uuid, '%s'::uuid, '%s', 1,
    'Bab 1 B1', '["Paragraf B1."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Mendatangi ruang kerja tua"},{"id":"c2","label":"Bertanya kepada penjaga toko"},{"id":"c3","label":"Pergi meninggalkan tempat itu"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.b1_job'), current_setting('lakoku.b1_claim'), current_setting('lakoku.b1_lease'), current_setting('lakoku.b1_story')),
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'V6 replay rejects Story Start ledger wrong reason'
);

-- 6. Setup environment for Block 6 (Bab 4 Replay Ledger Corruption)
-- Set Bab 4 intent to FULFILLED and reservation to CAPTURED, insert valid ledger ref
update public.credit_reservations set status = 'CAPTURED' where ref = 'chapter-reservation:' || current_setting('lakoku.rp_user') || ':' || current_setting('lakoku.rp_story') || ':4';
update public.commercial_generation_intents set status = 'FULFILLED' where generation_job_id = current_setting('lakoku.rp_job')::uuid;

-- Test 33: Bab 4 Replay ledger wrong delta (delta = -5 instead of -8)
update public.credit_ledger set delta = -5 where ref = 'chapter-reservation:' || current_setting('lakoku.rp_user') || ':' || current_setting('lakoku.rp_story') || ':4';

select throws_like(
  format($$ select public.publish_generation_job_chapter_v6(
    '%s'::uuid, 'worker-rp', '%s'::uuid, '%s'::uuid, '%s', 4,
    'Bab 4 Replay', '["Paragraf."]'::jsonb, 'Apa yang akan kamu lakukan selanjutnya?',
    '[{"id":"c1","label":"Memeriksa dokumen rahasia di meja kerja"},{"id":"c2","label":"Menyelidiki pintu rahasia di balik lukisan"},{"id":"c3","label":"Mendekati suara langkah di lorong gelap"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null, null, '[]'::jsonb
  ) $$, current_setting('lakoku.rp_job'), current_setting('lakoku.rp_claim'), current_setting('lakoku.rp_lease'), current_setting('lakoku.rp_story')),
  '%',
  'V6 Bab 4 replay rejects ledger wrong delta (-5 instead of -8)'
);

-- Test 34: Reactivate quote RPC contract check: CAPTURED returns ok:false RESERVATION_ALREADY_CAPTURED
update public.credit_reservations set status = 'CAPTURED' where story_id = current_setting('lakoku.rp_story') and chapter_number = 4;
update public.commercial_generation_intents set status = 'QUEUED' where generation_job_id = current_setting('lakoku.rp_job')::uuid;

select is(
  (public.reactivate_commercial_chapter_reservation_v1(
    current_setting('lakoku.rp_user')::uuid, current_setting('lakoku.rp_story'), 4, current_setting('lakoku.rp_job')::uuid
  )->>'reason')::text,
  'RESERVATION_ALREADY_CAPTURED'::text,
  'RPC reactivate_commercial_chapter_reservation_v1 returns ok:false RESERVATION_ALREADY_CAPTURED for CAPTURED status'
);

select * from finish();
rollback;
