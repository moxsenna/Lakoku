import { describe, it, expect } from 'vitest'
import {
  verifyLocalRaceTarget,
  execLocalPsql,
  startRacePsql,
  waitForRaceSession,
  waitForRaceToken,
  waitForRaceSuccess,
  cleanupRaceSessions,
  cleanupFixtureRows,
  type RunningRacePsql,
} from '../../scripts/authoring-race-session'

describe('V6 Commercial Publisher Concurrency & Lock Order', () => {
  it('prevents deadlock and maintains exact atomic financial state under 2-session PostgreSQL race', async () => {
    const target = verifyLocalRaceTarget('anti-abuse DB race')
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

    // Seed database fixture: auth user, commercial account, story (STARTER_FREE), contract (with actPlan), reader state, credit ledger (16 credits)
    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_race_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'V6 Race Story', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4);`
    )

    // Enqueue, claim, and lease job inside do $$ block with request.jwt.claim.sub set
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

    const claimOut = execLocalPsql(
      target,
      `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-v6-race')::text;`
    )
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token
    const corrId = claimObj.job.correlation_id

    const leaseOut = execLocalPsql(
      target,
      `set role service_role; select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-v6-race', '${claimToken}'::uuid, 120)::text;`
    )
    const leaseObj = JSON.parse(leaseOut)
    const leaseId = leaseObj.lease_id

    // Seed intent and Schema 3 Living Canon checkpoint
    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-race4', '${jobId}', 'QUEUED', 8, 'v1');\n` +
      `insert into public.chapter_generation_checkpoints (story_id, chapter_number, attempt_id, correlation_id, job_id, checkpoint_schema_version, status, title, paragraphs_json, audit_signals_version, audit_signals_json, story_contract_version, prose_fingerprint, generation_mode, job_attempt_number, expires_at, state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision) values ('${storyId}', 4, '${jobId}', '${corrId}', '${jobId}', 3, 'PROSE_READY', 'Bab 4 V6 Race', '["Paragraf 1 race."]'::jsonb, 2, '{"opensNewThread": false, "opensMajorMystery": false, "opensNewConflict": false, "closesPlotDebts": []}'::jsonb, 1, 'fp-v6-race-1', 'personalized', 1, now() + interval '1 hour', jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb)), 1, public.chapter_state_delta_hash_v1(jsonb_build_object('schemaVersion', '1', 'storyId', '${storyId}', 'chapterNumber', 4, 'facts', jsonb_build_object('add', '[]'::jsonb), 'threads', jsonb_build_object('touches', '[]'::jsonb, 'transitions', '[]'::jsonb))), 0);`
    )

    const sessions: RunningRacePsql[] = []
    try {
      const holder = startRacePsql(target, 'v6-holder', { barrier })
      sessions.push(holder)
      await waitForRaceSession(holder)
      holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
      await waitForRaceToken(holder, 'BARRIER_READY')

      const params = { user_id: userId, story_id: storyId, job_id: jobId, claim_token: claimToken, lease_id: leaseId, barrier }
      const runnerA = startRacePsql(target, 'v6-publisher', params)
      const runnerB = startRacePsql(target, 'reserve-concurrent', params)
      sessions.push(runnerA, runnerB)

      await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

      const v6Sql = `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|A';
select pg_advisory_lock_shared(:barrier);
select 'V6_RESULT|' || public.publish_generation_job_chapter_v6(
  :'job_id'::uuid,
  'worker-v6-race',
  :'claim_token'::uuid,
  :'lease_id'::uuid,
  :'story_id',
  4,
  'Bab 4 V6 Race',
  '["Paragraf 1 race."]'::jsonb,
  'Pilih langkah selanjutnya',
  '[{"id":"c1","label":"Cari kunci rahasia lemari"},{"id":"c2","label":"Lari menuju pintu belakang"}]'::jsonb,
  '[{"choiceId":"c1","consequence":["Hasil A"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"c2","consequence":["Hasil B"],"nextChapterNumber":5,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
  null,
  null,
  '[]'::jsonb
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
select 'RESERVE_RESULT|' || public.reserve_chapter_unlock_v1(
  :'user_id'::uuid, :'story_id', 4
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`

      runnerA.child.stdin.end(v6Sql)
      runnerB.child.stdin.end(reserveConcurrentSql)

      await Promise.all([
        waitForRaceToken(runnerA, 'CONTENDER_READY|A'),
        waitForRaceToken(runnerB, 'CONTENDER_READY|B'),
      ])

      // Release barrier so both transactions execute simultaneously
      holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

      await Promise.all([
        waitForRaceSuccess(holder),
        waitForRaceSuccess(runnerA),
        waitForRaceSuccess(runnerB),
      ])

      const outA = runnerA.stdout
      const outB = runnerB.stdout

      // Neither session should fail with SQLSTATE 40P01 (deadlock)
      expect(outA).not.toContain('40P01')
      expect(outB).not.toContain('40P01')
      expect(runnerA.stderr).not.toContain('deadlock detected')
      expect(runnerB.stderr).not.toContain('deadlock detected')

      // Assert V6 publication succeeded
      expect(outA).toContain('V6_RESULT|{"ok": true')

      // Assert exact final DB state
      const capCount = execLocalPsql(
        target,
        `set role service_role; select count(*)::text from public.credit_reservations where user_id = '${userId}'::uuid and story_id = '${storyId}' and status = 'CAPTURED';`
      )
      expect(parseInt(capCount.trim(), 10)).toBe(1)

      const ledgerCount = execLocalPsql(
        target,
        `set role service_role; select count(*)::text from public.credit_ledger where user_id = '${userId}'::uuid and reason = 'unlock_chapter';`
      )
      expect(parseInt(ledgerCount.trim(), 10)).toBe(1)

      const intentStatus = execLocalPsql(
        target,
        `set role service_role; select status::text from public.commercial_generation_intents where user_id = '${userId}'::uuid and story_id = '${storyId}' and chapter_number = 4;`
      )
      expect(intentStatus.trim()).toBe('FULFILLED')
    } finally {
      await cleanupRaceSessions(target, sessions)
      await cleanupFixtureRows(target, [storyId], [userId])
    }
  }, 30000)
})
