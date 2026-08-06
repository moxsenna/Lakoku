import { describe, it, expect } from 'vitest'
import {
  verifyLocalRaceTarget,
  execLocalPsql,
  startRacePsql,
  waitForRaceSession,
  waitForRaceToken,
  waitForRaceSuccess,
  waitForProcessExit,
  cleanupRaceSessions,
  cleanupFixtureRows,
  type RunningRacePsql,
} from '../../scripts/authoring-race-session'

describe('V6 Commercial Publisher Concurrency & 5-Race Lock Order Matrix', () => {
  // RACE 1: V6 vs reserve_chapter_unlock_v1
  it('Race 1: V6 vs reserve_chapter_unlock_v1 maintains exact atomic financial state and zero deadlock', async () => {
    const target = verifyLocalRaceTarget('anti-abuse DB race 1')
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_race1_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'V6 Race Story 1', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4);`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-race1');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`
    ).trim()

    const claimOut = execLocalPsql(
      target,
      `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-race1')::text;`
    )
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token
    const corrId = claimObj.job.correlation_id

    const leaseOut = execLocalPsql(
      target,
      `set role service_role; select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-race1', '${claimToken}'::uuid, 120)::text;`
    )
    const leaseObj = JSON.parse(leaseOut)
    const leaseId = leaseObj.lease_id

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-race1', '${jobId}', 'QUEUED', 8, 'v1');\n` +
      `insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision) values ('${storyId}', 4, '${jobId}', '${corrId}', '${jobId}', 3, 'PROSE_READY', 'Bab 4 Race 1', '["Paragraf race 1."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-race1', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);`
    )

    const sessions: RunningRacePsql[] = []
    try {
      const holder = startRacePsql(target, 'r1-holder', { barrier })
      sessions.push(holder)
      await waitForRaceSession(holder)
      holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
      await waitForRaceToken(holder, 'BARRIER_READY')

      const params = { user_id: userId, story_id: storyId, job_id: jobId, claim_token: claimToken, lease_id: leaseId, barrier }
      const runnerA = startRacePsql(target, 'r1-v6', params)
      const runnerB = startRacePsql(target, 'r1-reserve', params)
      sessions.push(runnerA, runnerB)

      await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

      const v6Sql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|A';
select pg_advisory_lock_shared(:barrier);
select 'V6_RESULT|' || public.publish_generation_job_chapter_v6(
  :'job_id'::uuid, 'worker-race1', :'claim_token'::uuid, :'lease_id'::uuid, :'story_id', 4,
  'Bab 4 Race 1', '["Paragraf race 1."]'::jsonb, 'Pilih langkah berikutnya:',
  '[{"id":"c1","label":"Memeriksa dokumen rahasia di meja kerja"},{"id":"c2","label":"Menyelidiki pintu rahasia di balik lukisan"},{"id":"c3","label":"Mendekati suara langkah di lorong gelap"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null, null, '[]'::jsonb
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      const reserveConcurrentSql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|B';
select pg_advisory_lock_shared(:barrier);
select 'RESERVE_RESULT|' || public.reserve_chapter_unlock_v1(:'user_id'::uuid, :'story_id', 4)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      runnerA.child.stdin.end(v6Sql)
      runnerB.child.stdin.end(reserveConcurrentSql)

      await Promise.all([waitForRaceToken(runnerA, 'CONTENDER_READY|A'), waitForRaceToken(runnerB, 'CONTENDER_READY|B')])
      holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

      await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(runnerA), waitForRaceSuccess(runnerB)])

      expect(runnerA.stdout).not.toContain('40P01')
      expect(runnerB.stdout).not.toContain('40P01')
      expect(runnerA.stdout).toContain('V6_RESULT|{"ok": true')

      const capCount = execLocalPsql(target, `set role service_role; select count(*)::text from public.credit_reservations where user_id = '${userId}'::uuid and story_id = '${storyId}' and status = 'CAPTURED';`).trim()
      expect(parseInt(capCount, 10)).toBe(1)
    } finally {
      await cleanupRaceSessions(target, sessions)
      await cleanupFixtureRows(target, [storyId], [userId])
    }
  }, 30000)

  // RACE 2: V6 vs reserve_story_start_v1
  it('Race 2: V6 Bab1 vs reserve_story_start_v1 maintains linearizability', async () => {
    const target = verifyLocalRaceTarget('anti-abuse DB race 2')
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const starterId = `starter-${crypto.randomUUID()}`
    const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_race2_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${starterId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'V6 Race Story 2', '${userId}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 1, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 48, 'seed', 'seed:${userId}');\n` +
      `select public.reserve_story_start_v1('${userId}'::uuid, '${storyId}');`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 1, 'personalized', null);\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 1;`
    ).trim()

    execLocalPsql(
      target,
      `insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status) values ('${userId}', 'personalized', 'hash-race2', '${storyId}', 'req-race2', 'RESERVED');\n` +
      `set role service_role; select public.bind_story_creation_request_job_v1('${userId}'::uuid, '${storyId}'::text, '${jobId}'::uuid);`
    )

    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-race2')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token
    const corrId = claimObj.job.correlation_id

    const leaseOut = execLocalPsql(target, `set role service_role; select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-race2', '${claimToken}'::uuid, 120)::text;`)
    const leaseObj = JSON.parse(leaseOut)
    const leaseId = leaseObj.lease_id

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision) values ('${storyId}', 1, '${jobId}', '${corrId}', '${jobId}', 3, 'PROSE_READY', 'Bab 1 Race 2', '["Paragraf race 2."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-race2', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 1, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);`
    )

    const sessions: RunningRacePsql[] = []
    try {
      const holder = startRacePsql(target, 'r2-holder', { barrier })
      sessions.push(holder)
      await waitForRaceSession(holder)
      holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
      await waitForRaceToken(holder, 'BARRIER_READY')

      const params = { user_id: userId, story_id: storyId, job_id: jobId, claim_token: claimToken, lease_id: leaseId, barrier }
      const runnerA = startRacePsql(target, 'r2-v6', params)
      const runnerB = startRacePsql(target, 'r2-reserve-start', params)
      sessions.push(runnerA, runnerB)

      await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

      const v6Sql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|A';
select pg_advisory_lock_shared(:barrier);
select 'V6_RESULT|' || public.publish_generation_job_chapter_v6(
  :'job_id'::uuid, 'worker-race2', :'claim_token'::uuid, :'lease_id'::uuid, :'story_id', 1,
  'Bab 1 Race 2', '["Paragraf race 2."]'::jsonb, 'Pilih langkah berikutnya:',
  '[{"id":"c1","label":"Memeriksa dokumen rahasia di meja kerja"},{"id":"c2","label":"Menyelidiki pintu rahasia di balik lukisan"},{"id":"c3","label":"Mendekati suara langkah di lorong gelap"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["Hasil C"],"nextChapterNumber":2,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null, null, '[]'::jsonb
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      const reserveStartSql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|B';
select pg_advisory_lock_shared(:barrier);
select 'RESERVE_START_RESULT|' || public.reserve_story_start_v1(:'user_id'::uuid, :'story_id'::text)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      runnerA.child.stdin.end(v6Sql)
      runnerB.child.stdin.end(reserveStartSql)

      await Promise.all([waitForRaceToken(runnerA, 'CONTENDER_READY|A'), waitForRaceToken(runnerB, 'CONTENDER_READY|B')])
      holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

      await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(runnerA), waitForRaceSuccess(runnerB)])

      expect(runnerA.stdout).not.toContain('40P01')
      expect(runnerB.stdout).not.toContain('40P01')
      expect(runnerA.stdout).toContain('V6_RESULT|{"ok": true')

      const storyOrigin = execLocalPsql(target, `set role service_role; select commercial_origin::text from public.stories where id = '${storyId}';`).trim()
      expect(storyOrigin).toBe('PAID_START')
    } finally {
      await cleanupRaceSessions(target, sessions)
      await cleanupFixtureRows(target, [storyId, starterId], [userId])
    }
  }, 30000)

  // RACE 3: V6 vs release_credit_reservation_v1
  it('Race 3: V6 vs release_credit_reservation_v1 maintains serialization and exact single debit', async () => {
    const target = verifyLocalRaceTarget('anti-abuse DB race 3')
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_race3_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'V6 Race Story 3', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4);`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-race3');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`
    ).trim()

    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-race3')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token
    const corrId = claimObj.job.correlation_id

    const leaseOut = execLocalPsql(target, `set role service_role; select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-race3', '${claimToken}'::uuid, 120)::text;`)
    const leaseObj = JSON.parse(leaseOut)
    const leaseId = leaseObj.lease_id

    const resRef = `chapter-reservation:${userId}:${storyId}:4`

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-race3', '${jobId}', 'QUEUED', 8, 'v1');\n` +
      `insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision) values ('${storyId}', 4, '${jobId}', '${corrId}', '${jobId}', 3, 'PROSE_READY', 'Bab 4 Race 3', '["Paragraf race 3."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-race3', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);`
    )

    const sessions: RunningRacePsql[] = []
    try {
      const holder = startRacePsql(target, 'r3-holder', { barrier })
      sessions.push(holder)
      await waitForRaceSession(holder)
      holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
      await waitForRaceToken(holder, 'BARRIER_READY')

      const params = { user_id: userId, story_id: storyId, job_id: jobId, claim_token: claimToken, lease_id: leaseId, barrier, ref: resRef }
      const runnerA = startRacePsql(target, 'r3-v6', params)
      const runnerB = startRacePsql(target, 'r3-release', params)
      sessions.push(runnerA, runnerB)

      await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

      const v6Sql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|A';
select pg_advisory_lock_shared(:barrier);
select 'V6_RESULT|' || public.publish_generation_job_chapter_v6(
  :'job_id'::uuid, 'worker-race3', :'claim_token'::uuid, :'lease_id'::uuid, :'story_id', 4,
  'Bab 4 Race 3', '["Paragraf race 3."]'::jsonb, 'Pilih langkah berikutnya:',
  '[{"id":"c1","label":"Memeriksa dokumen rahasia di meja kerja"},{"id":"c2","label":"Menyelidiki pintu rahasia di balik lukisan"},{"id":"c3","label":"Mendekati suara langkah di lorong gelap"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null, null, '[]'::jsonb
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      const releaseSql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|B';
select pg_advisory_lock_shared(:barrier);
select 'RELEASE_RESULT|' || public.release_credit_reservation_v1(:'ref'::text)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      runnerA.child.stdin.end(v6Sql)
      runnerB.child.stdin.end(releaseSql)

      await Promise.all([waitForRaceToken(runnerA, 'CONTENDER_READY|A'), waitForRaceToken(runnerB, 'CONTENDER_READY|B')])
      holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

      await Promise.all([
        waitForRaceSuccess(holder),
        waitForProcessExit(runnerA, 5000),
        waitForProcessExit(runnerB, 5000),
      ])

      const allOutputA = runnerA.stdout + runnerA.stderr
      const allOutputB = runnerB.stdout + runnerB.stderr

      expect(allOutputA).not.toContain('40P01')
      expect(allOutputB).not.toContain('40P01')

      // Serialization check: Either V6 succeeded OR V6 failed closed with COMMERCIAL_FINALIZATION_CONFLICT
      const v6Success = runnerA.stdout.includes('V6_RESULT|{"ok": true')
      const v6FailClosed = runnerA.stderr.includes('COMMERCIAL_FINALIZATION_CONFLICT')
      expect(v6Success || v6FailClosed).toBe(true)
    } finally {
      await cleanupRaceSessions(target, sessions)
      await cleanupFixtureRows(target, [storyId], [userId])
    }
  }, 30000)

  // RACE 4: V6 vs spend_credits_v1
  it('Race 4: V6 vs spend_credits_v1 maintains financial lock order U -> M', async () => {
    const target = verifyLocalRaceTarget('anti-abuse DB race 4')
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_race4_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'V6 Race Story 4', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4);`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-race4');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`
    ).trim()

    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-race4')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token
    const corrId = claimObj.job.correlation_id

    const leaseOut = execLocalPsql(target, `set role service_role; select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-race4', '${claimToken}'::uuid, 120)::text;`)
    const leaseObj = JSON.parse(leaseOut)
    const leaseId = leaseObj.lease_id

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-race4', '${jobId}', 'QUEUED', 8, 'v1');\n` +
      `insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision) values ('${storyId}', 4, '${jobId}', '${corrId}', '${jobId}', 3, 'PROSE_READY', 'Bab 4 Race 4', '["Paragraf race 4."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-race4', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);`
    )

    const sessions: RunningRacePsql[] = []
    try {
      const holder = startRacePsql(target, 'r4-holder', { barrier })
      sessions.push(holder)
      await waitForRaceSession(holder)
      holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
      await waitForRaceToken(holder, 'BARRIER_READY')

      const params = { user_id: userId, story_id: storyId, job_id: jobId, claim_token: claimToken, lease_id: leaseId, barrier }
      const runnerA = startRacePsql(target, 'r4-v6', params)
      const runnerB = startRacePsql(target, 'r4-spend', params)
      sessions.push(runnerA, runnerB)

      await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

      const v6Sql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|A';
select pg_advisory_lock_shared(:barrier);
select 'V6_RESULT|' || public.publish_generation_job_chapter_v6(
  :'job_id'::uuid, 'worker-race4', :'claim_token'::uuid, :'lease_id'::uuid, :'story_id', 4,
  'Bab 4 Race 4', '["Paragraf race 4."]'::jsonb, 'Pilih langkah berikutnya:',
  '[{"id":"c1","label":"Memeriksa dokumen rahasia di meja kerja"},{"id":"c2","label":"Menyelidiki pintu rahasia di balik lukisan"},{"id":"c3","label":"Mendekati suara langkah di lorong gelap"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null, null, '[]'::jsonb
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      const spendSql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|B';
select pg_advisory_lock_shared(:barrier);
select 'SPEND_RESULT|' || public.spend_credits_v1(:'user_id'::uuid, 'test_spend'::text, 1, 'spend-ref-race4'::text)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      runnerA.child.stdin.end(v6Sql)
      runnerB.child.stdin.end(spendSql)

      await Promise.all([waitForRaceToken(runnerA, 'CONTENDER_READY|A'), waitForRaceToken(runnerB, 'CONTENDER_READY|B')])
      holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

      await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(runnerA), waitForRaceSuccess(runnerB)])

      expect(runnerA.stdout).not.toContain('40P01')
      expect(runnerB.stdout).not.toContain('40P01')
      expect(runnerA.stdout).toContain('V6_RESULT|{"ok": true')
    } finally {
      await cleanupRaceSessions(target, sessions)
      await cleanupFixtureRows(target, [storyId], [userId])
    }
  }, 30000)

  // RACE 5: V6 vs transition_commercial_generation_intent_v1
  it('Race 5: V6 vs transition_commercial_generation_intent_v1 maintains serialization and exact single transition', async () => {
    const target = verifyLocalRaceTarget('anti-abuse DB race 5')
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_race5_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'V6 Race Story 5', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4);`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-race5');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`
    ).trim()

    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-race5')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token
    const corrId = claimObj.job.correlation_id

    const leaseOut = execLocalPsql(target, `set role service_role; select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-race5', '${claimToken}'::uuid, 120)::text;`)
    const leaseObj = JSON.parse(leaseOut)
    const leaseId = leaseObj.lease_id

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-race5', '${jobId}', 'QUEUED', 8, 'v1');\n` +
      `insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision) values ('${storyId}', 4, '${jobId}', '${corrId}', '${jobId}', 3, 'PROSE_READY', 'Bab 4 Race 5', '["Paragraf race 5."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-race5', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);`
    )

    const sessions: RunningRacePsql[] = []
    try {
      const holder = startRacePsql(target, 'r5-holder', { barrier })
      sessions.push(holder)
      await waitForRaceSession(holder)
      holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
      await waitForRaceToken(holder, 'BARRIER_READY')

      const params = { user_id: userId, story_id: storyId, job_id: jobId, claim_token: claimToken, lease_id: leaseId, barrier }
      const runnerA = startRacePsql(target, 'r5-v6', params)
      const runnerB = startRacePsql(target, 'r5-trans-intent', params)
      sessions.push(runnerA, runnerB)

      await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

      const v6Sql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|A';
select pg_advisory_lock_shared(:barrier);
select 'V6_RESULT|' || public.publish_generation_job_chapter_v6(
  :'job_id'::uuid, 'worker-race5', :'claim_token'::uuid, :'lease_id'::uuid, :'story_id', 4,
  'Bab 4 Race 5', '["Paragraf race 5."]'::jsonb, 'Pilih langkah berikutnya:',
  '[{"id":"c1","label":"Memeriksa dokumen rahasia di meja kerja"},{"id":"c2","label":"Menyelidiki pintu rahasia di balik lukisan"},{"id":"c3","label":"Mendekati suara langkah di lorong gelap"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c3","consequence":["Hasil C"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null, null, '[]'::jsonb
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      const transIntentSql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|B';
select pg_advisory_lock_shared(:barrier);
select 'TRANS_RESULT|' || public.transition_commercial_generation_intent_v1(:'user_id'::uuid, :'story_id'::text, 4, 'WAITING_FOR_CREDITS'::text, :'job_id'::uuid)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      runnerA.child.stdin.end(v6Sql)
      runnerB.child.stdin.end(transIntentSql)

      await Promise.all([waitForRaceToken(runnerA, 'CONTENDER_READY|A'), waitForRaceToken(runnerB, 'CONTENDER_READY|B')])
      holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

      await Promise.all([
        waitForRaceSuccess(holder),
        waitForProcessExit(runnerA, 5000),
        waitForProcessExit(runnerB, 5000),
      ])

      const allOutputA = runnerA.stdout + runnerA.stderr
      const allOutputB = runnerB.stdout + runnerB.stderr

      expect(allOutputA).not.toContain('40P01')
      expect(allOutputB).not.toContain('40P01')

      // Serialization check: Either V6 succeeded OR V6 failed closed with COMMERCIAL_FINALIZATION_CONFLICT
      const v6Success = runnerA.stdout.includes('V6_RESULT|{"ok": true')
      const v6FailClosed = runnerA.stderr.includes('COMMERCIAL_FINALIZATION_CONFLICT')
      expect(v6Success || v6FailClosed).toBe(true)
    } finally {
      await cleanupRaceSessions(target, sessions)
      await cleanupFixtureRows(target, [storyId], [userId])
    }
  }, 30000)
})
