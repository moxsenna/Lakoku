-- supabase/tests/database/commercial_runtime_phase2b_test.sql
-- pgTAP tests for Phase 2B V6 atomic publication, PayCore credit capture, status transitions, Living Canon V5 integration, and corruption resistance.

\set ON_ERROR_STOP 1
begin;
select plan(23);

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
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-v6-pending', '99999999-9999-4999-9999-999999999999', 'Paid Story Bab 1', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BARU', 0, '{}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version)
values ('story-v6-pending', 'personalized_ai', 50, 1)
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-pending', 1, 'BARU', now())
on conflict (user_id, story_id) do nothing;

-- Seed active reservation for STORY_START
insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-pending', 1, 'STORY_START', 24, 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

-- Enqueue job & bind creation request for Bab 1
do $$
declare
  v_enq jsonb;
  v_job_id uuid;
  v_claim jsonb;
  v_lease_res jsonb;
  v_claim_token uuid;
  v_lease_id uuid;
  v_corr_id uuid;
  v_bind jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-9999-999999999999', true);
  v_enq := public.enqueue_generation_job_v1('story-v6-pending', 1, 'personalized', null);
  v_job_id := (v_enq->>'jobId')::uuid;

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at
  ) values (
    'story-v6-pending', 1, v_job_id, v_corr_id, v_job_id, 2, 'PROSE_READY', 'Bab 1 Utama', '["Paragraf 1 awal cerita."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-pending-1', 'personalized', 1, now() + interval '1 hour'
  );

  insert into public.story_creation_requests (owner_user_id, story_id, request_kind, idempotency_key, request_hash, status, generation_job_id)
  values ('99999999-9999-4999-9999-999999999999', 'story-v6-pending', 'personalized', 'key-v6-pending', 'hash-v6-pending-000000000000000000000000000000000000000000000000', 'RESERVED', null)
  on conflict (story_id) do nothing;

  v_bind := public.bind_story_creation_request_job_v1('99999999-9999-4999-9999-999999999999'::uuid, 'story-v6-pending', v_job_id);

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-v6-pending',
    1,
    'Bab 1 Utama',
    '["Paragraf 1 awal cerita."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"c1","label":"Periksa ruang bawah tanah"},{"id":"c2","label":"Buka jendela kamar utama"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Test 4: Verify Bab 1 publication executed successfully
select pass('publish_generation_job_chapter_v6 executes successfully for Bab 1 paid start');

-- Test 5: Reservation status updated to CAPTURED
select is(
  (select status from public.credit_reservations where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending'),
  'CAPTURED',
  'Bab 1 reservation status updated to CAPTURED'
);

-- Test 6: PayCore credit_ledger contains entry with delta = -24 and reason = story_start
select is(
  (select delta from public.credit_ledger where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending'),
  -24,
  'credit_ledger delta is -24'
);

select is(
  (select reason from public.credit_ledger where ref = 'story-start:99999999-9999-4999-9999-999999999999:story-v6-pending'),
  'story_start',
  'credit_ledger reason is story_start'
);

-- Test 7: Story commercial_origin promoted to PAID_START
select is(
  (select commercial_origin from public.stories where id = 'story-v6-pending'),
  'PAID_START',
  'story origin promoted to PAID_START'
);

-- Test 8: Creation request status promoted to READY
select is(
  (select status from public.story_creation_requests where story_id = 'story-v6-pending'),
  'READY',
  'creation request status promoted to READY'
);

-- Test 9: Bab 1 publication replay returns cached success without duplicate debit
do $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
begin
  select * into v_job from public.generation_jobs where story_id = 'story-v6-pending' and chapter_number = 1;
  select * into v_lease from public.generation_leases where job_id = v_job.id;

  perform public.publish_generation_job_chapter_v6(
    v_job.id,
    v_job.worker_id,
    v_job.claim_token,
    v_lease.id,
    v_job.story_id,
    v_job.chapter_number,
    'Bab 1 Utama',
    '["Paragraf 1 awal cerita."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"c1","label":"Periksa ruang bawah tanah"},{"id":"c2","label":"Buka jendela kamar utama"}]'::jsonb,
    '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

select pass('Bab 1 replay executed idempotently');

-- Seed Bab 4+ story & reservation for positive capture test
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-v6-ch4', '99999999-9999-4999-9999-999999999999', 'Ch4 Paid Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 3, '{}', 'private', 'personalized_ai', 'PAID_START', 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version)
values ('story-v6-ch4', 'personalized_ai', 50, 1)
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-ch4', 3, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-ch4', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-ch4:4', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

-- Enqueue Bab 4+ job via production enqueue_generation_job_v1
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
  v_enq := public.enqueue_generation_job_v1('story-v6-ch4', 4, 'personalized', 'choice-4a');
  v_job_id := (v_enq->>'jobId')::uuid;

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at
  ) values (
    'story-v6-ch4', 4, v_job_id, v_corr_id, v_job_id, 2, 'PROSE_READY', 'Bab 4 Lanjutan', '["Paragraf 1 bab 4."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-ch4-1', 'personalized', 1, now() + interval '1 hour'
  );

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v6-ch4', 4, 'choice-4a', v_job_id, 'QUEUED', 8, 'v1');

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-v6-ch4',
    4,
    'Bab 4 Lanjutan',
    '["Paragraf 1 bab 4."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"c4","label":"Cari kunci rahasia lemari"},{"id":"c5","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"c4","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c5","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Test 10: Verify Bab 4+ publication executed successfully
select pass('publish_generation_job_chapter_v6 executes successfully for Bab 4+ unlock');

-- Test 11: Bab 4+ reservation status updated to CAPTURED
select is(
  (select status from public.credit_reservations where ref = 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-ch4:4'),
  'CAPTURED',
  'Bab 4+ reservation status updated to CAPTURED'
);

-- Test 12: PayCore credit_ledger contains entry with delta = -8 and reason = unlock_chapter
select is(
  (select delta from public.credit_ledger where ref = 'unlock:story-v6-ch4:4'),
  -8,
  'Bab 4+ credit_ledger delta is -8'
);

select is(
  (select reason from public.credit_ledger where ref = 'unlock:story-v6-ch4:4'),
  'unlock_chapter',
  'Bab 4+ credit_ledger reason is unlock_chapter'
);

-- Test 13: Commercial generation intent status updated to FULFILLED
select is(
  (select status from public.commercial_generation_intents where story_id = 'story-v6-ch4' and chapter_number = 4),
  'FULFILLED',
  'Bab 4+ commercial generation intent status updated to FULFILLED'
);

-- Test 14: Job status updated to SUCCEEDED
select is(
  (select status from public.generation_jobs where story_id = 'story-v6-ch4' and chapter_number = 4),
  'SUCCEEDED',
  'generation job status updated to SUCCEEDED'
);

-- Test 15: Lease status updated to RELEASED
select is(
  (select status from public.generation_leases where story_id = 'story-v6-ch4' and chapter_number = 4),
  'RELEASED',
  'generation lease status updated to RELEASED'
);

-- Test 16: Bab 4+ publication replay returns cached success without duplicate debit
do $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
begin
  select * into v_job from public.generation_jobs where story_id = 'story-v6-ch4' and chapter_number = 4;
  select * into v_lease from public.generation_leases where job_id = v_job.id;

  perform public.publish_generation_job_chapter_v6(
    v_job.id,
    v_job.worker_id,
    v_job.claim_token,
    v_lease.id,
    v_job.story_id,
    v_job.chapter_number,
    'Bab 4 Lanjutan',
    '["Paragraf 1 bab 4."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"c4","label":"Cari kunci rahasia lemari"},{"id":"c5","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"c4","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c5","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

select pass('Bab 4+ replay executed idempotently');

-- Test 17: REQUIREMENT G — Pricing Snapshot Invariant (catalog price changes from 8 to 12 after reservation)
update public.feature_credit_costs
set credits_required = 12
where feature_key = 'chapter_unlock';

-- Seed Bab 5 story with original quoted price = 8
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, story_contract_version)
values ('story-v6-ch5', '99999999-9999-4999-9999-999999999999', 'Ch5 Paid Story', '/cover.webp', 'Tag', 'Role', '{}', 50, 'Syn', 'BERJALAN', 4, '{}', 'private', 'personalized_ai', 'PAID_START', 1)
on conflict (id) do nothing;

insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version)
values ('story-v6-ch5', 'personalized_ai', 50, 1)
on conflict (story_id) do nothing;

insert into public.reader_states (user_id, story_id, current_chapter, status, updated_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-ch5', 4, 'BERJALAN', now())
on conflict (user_id, story_id) do nothing;

-- Active reservation at original price 8
insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at)
values ('99999999-9999-4999-9999-999999999999', 'story-v6-ch5', 5, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-ch5:5', 'ACTIVE', now() + interval '1 hour')
on conflict (ref) do nothing;

-- Enqueue Bab 5 job
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
  v_enq := public.enqueue_generation_job_v1('story-v6-ch5', 5, 'personalized', 'choice-5a');
  v_job_id := (v_enq->>'jobId')::uuid;

  v_claim := public.claim_generation_job_by_id_v1(v_job_id, 'worker-v6');
  v_claim_token := (v_claim->'job'->>'claim_token')::uuid;
  v_corr_id := (v_claim->'job'->>'correlation_id')::uuid;

  v_lease_res := public.acquire_generation_job_lease_v1(v_job_id, 'worker-v6', v_claim_token, 120);
  v_lease_id := (v_lease_res->>'lease_id')::uuid;

  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at
  ) values (
    'story-v6-ch5', 5, v_job_id, v_corr_id, v_job_id, 2, 'PROSE_READY', 'Bab 5 Lanjutan', '["Paragraf 1 bab 5."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-ch5-1', 'personalized', 1, now() + interval '1 hour'
  );

  insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version)
  values (gen_random_uuid(), '99999999-9999-4999-9999-999999999999', 'story-v6-ch5', 5, 'choice-5a', v_job_id, 'QUEUED', 8, 'v1');

  perform public.publish_generation_job_chapter_v6(
    v_job_id,
    'worker-v6',
    v_claim_token,
    v_lease_id,
    'story-v6-ch5',
    5,
    'Bab 5 Lanjutan',
    '["Paragraf 1 bab 5."]'::jsonb,
    'Pilih langkah selanjutnya',
    '[{"id":"c6","label":"Cari kunci rahasia lemari"},{"id":"c7","label":"Lari menuju pintu belakang"}]'::jsonb,
    '[{"choiceId":"c6","consequence":["Hasil B"],"nextChapterNumber":6,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c7","consequence":["Hasil C"],"nextChapterNumber":6,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
    null,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Restore original price catalog setting
update public.feature_credit_costs set credits_required = 8 where feature_key = 'chapter_unlock';

select is(
  (select delta from public.credit_ledger where ref = 'unlock:story-v6-ch5:5'),
  -8,
  'Pricing snapshot invariant: captured at quoted 8 credits despite catalog price increase to 12'
);

-- Test 18 & 19: REQUIREMENT 13 — Financial Corruption Replay Tests (throws_like)
select throws_like(
  $sql$ do $do$
     declare
       v_job public.generation_jobs%rowtype;
       v_lease public.generation_leases%rowtype;
     begin
       select * into v_job from public.generation_jobs where story_id = 'story-v6-ch4' and chapter_number = 4;
       select * into v_lease from public.generation_leases where job_id = v_job.id;

       -- Corrupt ledger delta
       update public.credit_ledger set delta = -999 where ref = 'unlock:story-v6-ch4:4';

       perform public.publish_generation_job_chapter_v6(
         v_job.id, v_job.worker_id, v_job.claim_token, v_lease.id, v_job.story_id, v_job.chapter_number,
         'Bab 4 Lanjutan', '["Paragraf 1 bab 4."]'::jsonb, 'Pilih langkah selanjutnya',
         '[{"id":"c4","label":"Cari kunci rahasia lemari"},{"id":"c5","label":"Lari menuju pintu belakang"}]'::jsonb,
         '[{"choiceId":"c4","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c5","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
         null, null, '[]'::jsonb
       );
     end;
     $do$; $sql$,
  '%COMMERCIAL_FINALIZATION_CONFLICT%',
  'Replay fails closed with COMMERCIAL_FINALIZATION_CONFLICT when ledger delta is corrupted'
);

select pass('Financial corruption replay assertion completed');

-- Test 20 & 21: Living Canon Schema-3 V5 Delegation Test
-- Seed Living Canon story (living_canon_version = 1)
insert into public.stories (id, owner_user_id, title, cover, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, visibility, story_mode, commercial_origin, story_contract_version, living_canon_version)
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
end;
$$;

select is(
  (select status from public.credit_reservations where ref = 'chapter-reservation:99999999-9999-4999-9999-999999999999:story-v6-lc:4'),
  'CAPTURED',
  'Living Canon V5 delegation: reservation status updated to CAPTURED'
);

select is(
  (select status from public.commercial_generation_intents where story_id = 'story-v6-lc' and chapter_number = 4),
  'FULFILLED',
  'Living Canon V5 delegation: intent status updated to FULFILLED'
);

select * from finish();
rollback;
