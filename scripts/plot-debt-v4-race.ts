/**
 * publish_generation_job_chapter_v4 race test.
 *
 * Two real database connections calling V4 RPC concurrently.
 * Tests 5 critical properties of V4 concurrent behavior.
 *
 * Properties:
 * 1.   same job + same payload (sequential) → idempotent cached success
 * 1.5. same job + different payload (concurrent) → one SUCCEEDS, other IDEMPOTENCY_CONFLICT
 * 2.   different jobs + same debt → one succeeds, one DEBT_CLOSURE_CONFLICT
 * 3.   ownership stolen before J lock → stale caller rejected, no partial effects
 * 4.   two different jobs sharing R+S → no deadlock, both terminal
 * 5.   ending predicate → E1+E2 path, no deadlock, ending lock persisted
 */
import assert from 'node:assert/strict'
import {
  checkRace,
  cleanupRaceResources,
  execLocalPsql,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  verifyLocalRaceTarget,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'

const CONTEXT = 'plot-debt V4 race'
const CHAPTER = 10
const USER_ID = '00000000-0000-0000-0000-000000000001'

async function verifyAdvisoryBarrierBlocked(
  target: RaceTarget,
  blockedPid: number,
  retries = 35,
): Promise<void> {
  const query = `select count(*)::text from pg_locks where locktype = 'advisory' and objid = 120799 and pid = ${blockedPid} and not granted;`
  for (let i = 0; i < retries; i++) {
    const result = execLocalPsql(target, query).trim()
    if (parseInt(result, 10) > 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timeout waiting for advisory barrier on PID ${blockedPid}`)
}

async function verifyRowLockBlocked(
  target: RaceTarget,
  blockingPid: number,
  blockedPid: number,
  retries = 35,
): Promise<void> {
  const query = `select pg_catalog.pg_blocking_pids(${blockedPid})::text;`
  for (let i = 0; i < retries; i++) {
    const blocking = execLocalPsql(target, query).trim()
    if (blocking.includes(String(blockingPid))) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timeout waiting for row lock block: PID ${blockingPid} blocking PID ${blockedPid}`)
}

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function insertFixture(target: RaceTarget, label: string, storyIds: string[]): {
  storyId: string
  jobId: string
  leaseId: string
  claimToken: string
} {
  const storyId = `test:v4-race:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  const claimToken = crypto.randomUUID()
  storyIds.push(storyId)

  execLocalPsql(target, `
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (:'user_id'::uuid, 'authenticated', 'authenticated', 'v4-race-owner@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
    on conflict (id) do nothing;
    insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version)
    values (:'story_id', 'V4 race', :'user_id'::uuid, 'private', 'personalized_ai', 1);
    insert into public.reader_states (user_id, story_id, status, current_chapter)
    values (:'user_id'::uuid, :'story_id', 'BERJALAN', ${CHAPTER});
    insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
    values (:'story_id', 'personalized_ai', 50,
      '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb, 1);
    insert into public.generation_jobs (
      id, story_id, chapter_number, user_id, generation_kind,
      status, attempt_count, max_attempts, available_at, deadline_at,
      correlation_id, publication_idempotency_key, story_contract_version
    ) values (
      :'job_id'::uuid, :'story_id', ${CHAPTER}, :'user_id'::uuid, 'personalized',
      'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '20 minutes',
      gen_random_uuid(),
      'generation-job:' || :'job_id'::uuid::text || ':publish:' || ${CHAPTER},
      1
    );
    update public.generation_jobs
    set status = 'RUNNING', attempt_count = 1,
        worker_id = 'v4-test-worker', claim_token = :'claim_token'::uuid,
        claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
    where id = :'job_id'::uuid;
    insert into public.generation_leases (
      id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
    ) values (
      :'lease_id'::uuid, :'story_id', ${CHAPTER}, 'ACTIVE', 'v4-test-worker',
      clock_timestamp() + interval '5 minutes', :'job_id'::uuid, :'claim_token'::uuid
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
      :'story_id', ${CHAPTER}, :'job_id'::uuid,
      (select correlation_id from public.generation_jobs where id = :'job_id'::uuid),
      'PROSE_READY', 'Race Chapter', '["Race paragraph."]'::jsonb,
      'race-fp-000000000000000000000000000000',
      '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
      2, 5, 2, 'race-dir-000000000000000000000000000', 'personalized', 2, 2,
      :'job_id'::uuid, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
    );
  `, {
    story_id: storyId, user_id: USER_ID, job_id: jobId,
    lease_id: leaseId, label, claim_token: claimToken,
  })

  return { storyId, jobId, leaseId, claimToken }
}

function v4CallSql(fixture: { jobId: string; leaseId: string; claimToken: string; storyId: string }): string {
  return `
    set role service_role;
    select public.publish_generation_job_chapter_v4(
      '${fixture.jobId}'::uuid, 'v4-test-worker',
      '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
      '${fixture.storyId}', ${CHAPTER},
      'Race Chapter', '["Race paragraph."]'::jsonb,
      'Apa yang dilakukan sekarang?',
      '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
      '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
      null, null, null::jsonb
    )::text;
  `
}

function v4CallSqlWithClosure(
  fixture: { jobId: string; leaseId: string; claimToken: string; storyId: string },
  debtId: string,
  closureForm: string,
): string {
  return `
    set role service_role;
    select public.publish_generation_job_chapter_v4(
      '${fixture.jobId}'::uuid, 'v4-test-worker',
      '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
      '${fixture.storyId}', ${CHAPTER},
      'Race Chapter', '["Race paragraph."]'::jsonb,
      'Apa yang dilakukan sekarang?',
      '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
      '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
      null, null,
      '[{"debtId":"${debtId}","closureForm":"${closureForm}"}]'::jsonb
    )::text;
  `
}

function cleanupTarget(target: RaceTarget, storyIds: string[]): void {
  for (const storyId of storyIds) {
    execLocalPsql(target, `
      delete from public.chapter_generation_checkpoints where story_id = :'sid';
      delete from public.reader_plot_debt_closures where story_id = :'sid';
      delete from public.chapters where story_id = :'sid';
      delete from public.choice_outcomes where story_id = :'sid';
      delete from public.generation_leases where story_id = :'sid';
      delete from public.generation_jobs where story_id = :'sid';
      delete from public.story_generation_contracts where story_id = :'sid';
      delete from public.reader_states where story_id = :'sid';
      delete from public.stories where id = :'sid';
    `, { sid: storyId })
  }
}

async function runRaceTests(): Promise<void> {
  const target = verifyLocalRaceTarget(CONTEXT)
  const storyIds: string[] = []
  const sessions: RunningRacePsql[] = []

  try {
    // ─── Property 1: same job + same payload → idempotent (sequential) ───
    // Idempotent replay is a SEQUENTIAL property: the first call must COMMIT
    // before the second observes SUCCEEDED. Holding the first transaction open
    // while the second runs would self-deadlock on R/S/J/L (both want the same
    // locks); the concurrent case is covered by Property 1.5.
    {
      const fixture = insertFixture(target, 'idempotent', storyIds)

      // First call: publish (auto-commit via execLocalPsql).
      const first = execLocalPsql(target, v4CallSql(fixture))
      check(!first.includes('ERROR'), `P1: first publish succeeded (got: ${first.slice(0, 200)})`)

      const jobStatus = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(jobStatus === 'SUCCEEDED', `P1: job SUCCEEDED after first call (got: ${jobStatus})`)

      // Second call, identical payload: cached success, no error, no duplicate.
      const second = execLocalPsql(target, v4CallSql(fixture))
      check(!second.includes('ERROR'), `P1: replay returned cached success (got: ${second.slice(0, 200)})`)
      check(!second.includes('IDEMPOTENCY_CONFLICT'), 'P1: replay is NOT a conflict')

      const chCount = execLocalPsql(target, `
        select count(*)::text from public.chapters
        where story_id = '${fixture.storyId}' and number = ${CHAPTER};
      `).trim()
      check(chCount === '1', `P1: chapter published exactly once (got: ${chCount})`)

      console.log('  ✓ Property 1: same job + same payload → idempotent cached success')
    }

    // ─── Property 1.5: same job + different payload → IDEMPOTENCY_CONFLICT ───
    // Both transactions fire simultaneously. Both may pass Phase A (RUNNING,
    // unlocked). The first to take the J lock publishes and SUCCEEDS; the second,
    // under J FOR UPDATE, observes SUCCEEDED with a DIFFERENT publication hash and
    // raises IDEMPOTENCY_CONFLICT. No barrier/hold — PG serializes on the J lock,
    // so neither transaction waits on the other's un-committed work.
    // (The non-concurrent fast-path variant is covered in the functional pgTAP.)
    {
      const fixture = insertFixture(target, 'idemp-conflict', storyIds)

      const s1 = startRacePsql(target, 'ic-s1', {})
      sessions.push(s1)
      await waitForRaceSession(s1)

      const s2 = startRacePsql(target, 'ic-s2', {})
      sessions.push(s2)
      await waitForRaceSession(s2)

      // Session A: original payload. Fire-and-commit. Wrap in temp table to catch exception.
      s1.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '12s';
        set role service_role;
        create temp table r1(res text) on commit drop;
        do $$
        begin
          insert into r1
          select public.publish_generation_job_chapter_v4(
            '${fixture.jobId}'::uuid, 'v4-test-worker',
            '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
            '${fixture.storyId}', ${CHAPTER},
            'Race Chapter', '["Race paragraph."]'::jsonb,
            'Apa yang dilakukan sekarang?',
            '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
            '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
            null, null, null::jsonb
          )::text;
        exception when others then
          insert into r1 values (SQLERRM);
        end; $$;
        select res from r1;
        commit;
      `)

      // Session B: DIFFERENT prose/choicePrompt/choices on the SAME job. Wrap in temp table to catch exception.
      s2.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '12s';
        set role service_role;
        create temp table r2(res text) on commit drop;
        do $$
        begin
          insert into r2
          select public.publish_generation_job_chapter_v4(
            '${fixture.jobId}'::uuid, 'v4-test-worker',
            '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
            '${fixture.storyId}', ${CHAPTER},
            'Different Title', '["Different paragraph."]'::jsonb,
            'Apa yang harus dilakukan?',
            '[{"id":"go-fast","label":"Ikuti jalan pintas"},{"id":"search-area","label":"Cari area aman"}]'::jsonb,
            '[{"choiceId":"go-fast","consequence":["Cepat."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"search-area","consequence":["Aman."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
            null, null, null::jsonb
          )::text;
        exception when others then
          insert into r2 values (SQLERRM);
        end; $$;
        select res from r2;
        commit;
      `)

      await Promise.all([waitForRaceSuccess(s1), waitForRaceSuccess(s2)])

      const statusA = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(statusA === 'SUCCEEDED', `P1.5: job SUCCEEDED (got: ${statusA})`)

      // Chapter published exactly once.
      const chCount = execLocalPsql(target, `
        select count(*)::text from public.chapters
        where story_id = '${fixture.storyId}' and number = ${CHAPTER};
      `).trim()
      check(chCount === '1', `P1.5: chapter published exactly once (got: ${chCount})`)

      // Exactly one session received IDEMPOTENCY_CONFLICT (the loser of the J race).
      // Errors are caught and printed to stdout in our wrapper.
      const s1Conflict = s1.stdout.includes('IDEMPOTENCY_CONFLICT')
      const s2Conflict = s2.stdout.includes('IDEMPOTENCY_CONFLICT')
      check(s1Conflict !== s2Conflict, 'P1.5: exactly one session received IDEMPOTENCY_CONFLICT')

      // No deadlock while racing the J lock.
      check(!s1.stdout.includes('40P01') && !s2.stdout.includes('40P01'), 'P1.5: no deadlock')

      console.log('  ✓ Property 1.5: same job + different payload → IDEMPOTENCY_CONFLICT')
    }

    // ─── Property 2: different jobs + same debt → DEBT_CLOSURE_CONFLICT ───
    // Two jobs on the SAME story+user. Job A publishes with closure.
    // Job B (different chapter, same debt) must be REJECTED with DEBT_CLOSURE_CONFLICT.
    {
      const fixture = insertFixture(target, 'conflict-a', storyIds)

      // Job A: publish chapter 10 with main_mystery closure.
      execLocalPsql(target, `
        update public.chapter_generation_checkpoints
        set audit_signals_json = '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"main_mystery","closureForm":"RESOLVED"}]}'::jsonb
        where story_id = '${fixture.storyId}' and chapter_number = ${CHAPTER};
      `)
      const resultA = execLocalPsql(target, v4CallSqlWithClosure(fixture, 'main_mystery', 'RESOLVED'))
      check(!resultA.includes('ERROR'), 'P2: job A publish succeeded')

      // Verify A's effects committed.
      const jobAStatus = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(jobAStatus === 'SUCCEEDED', `P2: job A SUCCEEDED (got: ${jobAStatus})`)

      const ledgerCount = execLocalPsql(target, `
        select count(*)::text from public.reader_plot_debt_closures
        where user_id = '${USER_ID}' and story_id = '${fixture.storyId}';
      `)
      check(ledgerCount.includes('1'), 'P2: exactly one closure in ledger')

      // Job B: NEW job, chapter 11, same story+user, tries to close SAME debt.
      const jobBId = crypto.randomUUID()
      const leaseBId = crypto.randomUUID()
      execLocalPsql(target, `
        insert into public.generation_jobs (
          id, story_id, chapter_number, user_id, generation_kind,
          status, attempt_count, max_attempts, available_at, deadline_at,
          correlation_id, publication_idempotency_key, story_contract_version
        ) values (
          '${jobBId}'::uuid, '${fixture.storyId}', 11, '${USER_ID}'::uuid, 'personalized',
          'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '20 minutes',
          gen_random_uuid(),
          'generation-job:${jobBId}:publish:11', 1
        );
        update public.generation_jobs
        set status = 'RUNNING', attempt_count = 1,
            worker_id = 'v4-test-worker', claim_token = gen_random_uuid(),
            claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
        where id = '${jobBId}';
        insert into public.generation_leases (
          id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
        ) values (
          '${leaseBId}'::uuid, '${fixture.storyId}', 11, 'ACTIVE', 'v4-test-worker',
          clock_timestamp() + interval '5 minutes', '${jobBId}'::uuid,
          (select claim_token from public.generation_jobs where id = '${jobBId}')
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
          '${fixture.storyId}', 11, '${jobBId}'::uuid,
          (select correlation_id from public.generation_jobs where id = '${jobBId}'),
          'PROSE_READY', 'Ch 11', '["P11."]'::jsonb, 'fp11',
          '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"main_mystery","closureForm":"SUBVERTED"}]}'::jsonb,
          2, 5, 2, 'dir11', 'personalized', 2, 2,
          '${jobBId}'::uuid, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
        );
      `)

      const claimTokenB = execLocalPsql(target, `
        select claim_token::text from public.generation_jobs where id = '${jobBId}';
      `).trim()

      // Job B call must FAIL with DEBT_CLOSURE_CONFLICT.
      let threwConflict = false
      try {
        execLocalPsql(target, `
          set role service_role;
          select public.publish_generation_job_chapter_v4(
            '${jobBId}'::uuid, 'v4-test-worker', '${claimTokenB}'::uuid, '${leaseBId}'::uuid,
            '${fixture.storyId}', 11,
            'Bab Sebelas', '["Paragraf sebelas."]'::jsonb,
            'Apa yang dilakukan?',
            '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
            '[{"choiceId":"open-door","consequence":["Terbuka."],"nextChapterNumber":12,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Berhenti."],"nextChapterNumber":12,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
            null, null,
            '[{"debtId":"main_mystery","closureForm":"SUBVERTED"}]'::jsonb
          );
        `)
      } catch (error) {
        threwConflict = (error as Error).message.includes('DEBT_CLOSURE_CONFLICT')
      }
      check(threwConflict, 'P2: job B rejected with DEBT_CLOSURE_CONFLICT')

      // Verify B's effects NOT committed.
      const jobBStatus = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${jobBId}';
      `).trim()
      check(jobBStatus === 'RUNNING', `P2: job B still RUNNING (got: ${jobBStatus})`)

      const chapter11Count = execLocalPsql(target, `
        select count(*)::text from public.chapters
        where story_id = '${fixture.storyId}' and number = 11;
      `)
      check(chapter11Count.includes('0'), 'P2: chapter 11 NOT published')

      const checkpointBStatus = execLocalPsql(target, `
        select status from public.chapter_generation_checkpoints
        where story_id = '${fixture.storyId}' and chapter_number = 11;
      `).trim()
      check(checkpointBStatus === 'PROSE_READY', `P2: checkpoint B NOT PUBLISHED (got: ${checkpointBStatus})`)

      const ledgerCountAfter = execLocalPsql(target, `
        select count(*)::text from public.reader_plot_debt_closures
        where user_id = '${USER_ID}' and story_id = '${fixture.storyId}';
      `)
      check(ledgerCountAfter.includes('1'), 'P2: still exactly one closure (no second write)')

      console.log('  ✓ Property 2: different jobs + same debt → DEBT_CLOSURE_CONFLICT, no partial effects')
    }

    // ─── Property 3: ownership changes BEFORE J lock → stale caller rejected ───
    // Session A blocks on the story advisory lock (S). Ownership is stolen while
    // A waits. When A finally acquires J, the locked recheck must reject it.
    {
      const fixture = insertFixture(target, 'ownership', storyIds)

      // Session B: takes and holds the story advisory lock (S) so A cannot proceed.
      const blocker = startRacePsql(target, 'own-blocker', {})
      sessions.push(blocker)
      await waitForRaceSession(blocker)
      blocker.child.stdin.write(`
        begin;
        set local statement_timeout = '15s';
        select pg_advisory_xact_lock(hashtextextended('${fixture.storyId}', 120712));
        select 'S_LOCK_HELD';
      `)
      await waitForRaceToken(blocker, 'S_LOCK_HELD')

      // Session A: calls V4 — will block waiting for S.
      const stale = startRacePsql(target, 'own-stale', {})
      sessions.push(stale)
      await waitForRaceSession(stale)
      stale.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '10s';
        ${v4CallSql(fixture)}
        commit;
      `)

      // While A is blocked, steal ownership.
      // Transition RUNNING -> RETRY_WAIT -> RUNNING to legally change worker/claim under the trigger.
      execLocalPsql(target, `
        update public.generation_jobs set status = 'RETRY_WAIT' where id = '${fixture.jobId}';
        update public.generation_jobs
        set status = 'RUNNING', attempt_count = attempt_count + 1,
            worker_id = 'stolen-worker', claim_token = gen_random_uuid(),
            claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
        where id = '${fixture.jobId}';
      `)

      // Release S so A can proceed to J lock + recheck.
      blocker.child.stdin.end(`commit;`)
      await waitForRaceSuccess(blocker)

      // A should now fail with OWNERSHIP_LOST at the locked recheck.
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Verify: job NOT published, no partial effects.
      const status = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(status === 'RUNNING', `P3: job still RUNNING after ownership theft (got: ${status})`)

      const chapterCount = execLocalPsql(target, `
        select count(*)::text from public.chapters
        where story_id = '${fixture.storyId}' and number = ${CHAPTER};
      `)
      check(chapterCount.includes('0'), 'P3: chapter NOT published')

      const ledgerCount = execLocalPsql(target, `
        select count(*)::text from public.reader_plot_debt_closures
        where story_id = '${fixture.storyId}';
      `)
      check(ledgerCount.includes('0'), 'P3: no closure written')

      console.log('  ✓ Property 3: ownership stolen before J lock → stale caller rejected, no partial effects')
    }

    // ─── Property 4: no deadlock — two DIFFERENT jobs sharing R + S locks ───
    // Job A (ch 10, ending) uses E1 → E2 → R → S → J-A → L-A
    // Job B (ch 11, non-ending) uses R → S → J-B → L-B
    // Both contend on R (reader_states) and S (story advisory) for the same story.
    // Canonical order must prevent deadlock.
    {
      const fixture = insertFixture(target, 'deadlock', storyIds)

      // Create job B on the SAME story, different chapter.
      // (B does not get an ACTIVE lease, since story allows at most one ACTIVE lease;
      // B will fail lease check but still blocks on R+S to test deadlock).
      const jobBId = crypto.randomUUID()
      const leaseBId = crypto.randomUUID()
      execLocalPsql(target, `
        insert into public.generation_jobs (
          id, story_id, chapter_number, user_id, generation_kind,
          status, attempt_count, max_attempts, available_at, deadline_at,
          correlation_id, publication_idempotency_key, story_contract_version
        ) values (
          '${jobBId}'::uuid, '${fixture.storyId}', 11, '${USER_ID}'::uuid, 'personalized',
          'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '20 minutes',
          gen_random_uuid(), 'generation-job:${jobBId}:publish:11', 1
        );
        update public.generation_jobs
        set status = 'RUNNING', attempt_count = 1,
            worker_id = 'v4-test-worker', claim_token = gen_random_uuid(),
            claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
        where id = '${jobBId}';
        insert into public.chapter_generation_checkpoints (
          story_id, chapter_number, attempt_id, correlation_id, status,
          title, paragraphs_json, prose_fingerprint,
          audit_signals_json, audit_signals_version,
          canon_version, blueprint_version, direction_fingerprint,
          generation_mode, generation_policy_version, prompt_contract_version,
          job_id, job_attempt_number, checkpoint_schema_version,
          prose_attempt_count, choice_attempt_count, expires_at, story_contract_version
        ) values (
          '${fixture.storyId}', 11, '${jobBId}'::uuid,
          (select correlation_id from public.generation_jobs where id = '${jobBId}'),
          'PROSE_READY', 'Ch 11', '["P11."]'::jsonb, 'fp11-dl',
          '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
          2, 5, 2, 'dir11-dl', 'personalized', 2, 2,
          '${jobBId}'::uuid, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
        );
      `)

      const claimTokenB = execLocalPsql(target, `
        select claim_token::text from public.generation_jobs where id = '${jobBId}';
      `).trim()

      // Start a persistent session to hold the advisory barrier lock
      const barrier = startRacePsql(target, 'dl-barrier', {})
      sessions.push(barrier)
      await waitForRaceSession(barrier)
      barrier.child.stdin.write(`
        select pg_advisory_lock(120799);
        select 'BARRIER_HELD';
      `)
      await waitForRaceToken(barrier, 'BARRIER_HELD')

      const s1 = startRacePsql(target, 'dl-jobA', {})
      sessions.push(s1)
      await waitForRaceSession(s1)

      const s2 = startRacePsql(target, 'dl-jobB', {})
      sessions.push(s2)
      await waitForRaceSession(s2)

      // Session A: ending path. Runs V4, then blocks on advisory barrier.
      s1.child.stdin.end(`
        begin;
        set local statement_timeout = '30s';
        set local lock_timeout = '0'; -- Disable lock timeout so A holds the transaction locks indefinitely
        ${v4CallSql(fixture)}
        select pg_advisory_xact_lock(120799);
        commit;
      `)

      check(
        barrier.backendPid !== null && s1.backendPid !== null && s2.backendPid !== null,
        'P4: backend PIDs must be resolved'
      )

      // Wait until Session A completes publication and blocks at the barrier held by barrier holder
      await verifyAdvisoryBarrierBlocked(target, s1.backendPid)

      // Session B: non-ending path. Wrap in temp table catcher.
      // B will block on the row-lock R (reader_states) held by Session A.
      s2.child.stdin.end(`
        begin;
        set local statement_timeout = '30s';
        set local lock_timeout = '12s'; -- Give B enough lock timeout to verify blocking before unlock
        set role service_role;
        create temp table r_err(res text) on commit drop;
        do $$
        begin
          perform public.publish_generation_job_chapter_v4(
            '${jobBId}'::uuid, 'v4-test-worker', '${claimTokenB}'::uuid, '${leaseBId}'::uuid,
            '${fixture.storyId}', 11,
            'Bab Sebelas', '["Paragraf sebelas."]'::jsonb,
            'Apa yang dilakukan?',
            '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
            '[{"choiceId":"open-door","consequence":["Terbuka."],"nextChapterNumber":12,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Berhenti."],"nextChapterNumber":12,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
            null, null, null::jsonb
          );
        exception when others then
          insert into r_err values (SQLERRM);
        end; $$;
        select res from r_err;
        commit;
      `)

      // Wait until Session B is verified blocked on Session A's transaction row lock
      await verifyRowLockBlocked(target, s1.backendPid, s2.backendPid)

      // Release the barrier by ending the barrier holder session to let Session A commit
      barrier.child.stdin.end('select pg_advisory_unlock(120799);')
      await waitForRaceSuccess(barrier)

      // Both must complete within timeout (no deadlock).
      await Promise.all([waitForRaceSuccess(s1), waitForRaceSuccess(s2)])

      // Assert: no deadlock error (SQLSTATE 40P01).
      check(!s1.stdout.includes('40P01'), 'P4: session A no deadlock (40P01)')
      check(!s2.stdout.includes('40P01'), 'P4: session B no deadlock (40P01)')
      check(!s1.stdout.includes('deadlock detected'), 'P4: session A no deadlock message')
      check(!s2.stdout.includes('deadlock detected'), 'P4: session B no deadlock message')

      // A succeeded; B failed with LEASE_INVALID but did not deadlock.
      const statusA = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      const statusB = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${jobBId}';
      `).trim()
      check(statusA === 'SUCCEEDED', `P4: job A SUCCEEDED (got: ${statusA})`)
      check(statusB === 'RUNNING', `P4: job B still RUNNING (got: ${statusB})`)
      check(s2.stdout.includes('LEASE_INVALID'), 'P4: session B failed with LEASE_INVALID')

      // No duplicate closures.
      const ledgerCount = execLocalPsql(target, `
        select count(*)::text from public.reader_plot_debt_closures
        where story_id = '${fixture.storyId}';
      `)
      check(ledgerCount.includes('0'), 'P4: no closures (both used empty closure sets)')

      console.log('  ✓ Property 4: two different jobs sharing R+S → no deadlock, both terminal')
    }

    // ─── Property 5: ending-lock race — E1+E2 contention, no deadlock ───
    // Job A (ch 10, ending): E1 → E2 → R → S → J-A → L-A
    // Job B (ch 11, non-ending): R → S → J-B → L-B
    // Both share R (reader_states FOR UPDATE) and S (story advisory) for same story.
    // persist_ending_lock_v1 re-enters E2 (key 130600) reentrantly — must not conflict.
    // Both must complete within lock_timeout (no SQLSTATE 40P01).
    {
      const fixture = insertFixture(target, 'ending-lock', storyIds)

      // Create job B on same story, different chapter, no ending.
      // (B does not get an ACTIVE lease, since story allows at most one ACTIVE lease;
      // B will fail lease check but still blocks on R+S to test deadlock).
      const jobBId = crypto.randomUUID()
      const leaseBId = crypto.randomUUID()
      execLocalPsql(target, `
        insert into public.generation_jobs (
          id, story_id, chapter_number, user_id, generation_kind,
          status, attempt_count, max_attempts, available_at, deadline_at,
          correlation_id, publication_idempotency_key, story_contract_version
        ) values (
          '${jobBId}'::uuid, '${fixture.storyId}', 11, '${USER_ID}'::uuid, 'personalized',
          'QUEUED', 0, 4, clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '20 minutes',
          gen_random_uuid(), 'generation-job:${jobBId}:publish:11', 1
        );
        update public.generation_jobs
        set status = 'RUNNING', attempt_count = 1,
            worker_id = 'v4-test-worker', claim_token = gen_random_uuid(),
            claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
        where id = '${jobBId}';
        insert into public.chapter_generation_checkpoints (
          story_id, chapter_number, attempt_id, correlation_id, status,
          title, paragraphs_json, prose_fingerprint,
          audit_signals_json, audit_signals_version,
          canon_version, blueprint_version, direction_fingerprint,
          generation_mode, generation_policy_version, prompt_contract_version,
          job_id, job_attempt_number, checkpoint_schema_version,
          prose_attempt_count, choice_attempt_count, expires_at, story_contract_version
        ) values (
          '${fixture.storyId}', 11, '${jobBId}'::uuid,
          (select correlation_id from public.generation_jobs where id = '${jobBId}'),
          'PROSE_READY', 'Ch 11 EL', '["P11."]'::jsonb, 'fp11-el',
          '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
          2, 5, 2, 'dir11-el', 'personalized', 2, 2,
          '${jobBId}'::uuid, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
        );
      `)

      const claimTokenB = execLocalPsql(target, `
        select claim_token::text from public.generation_jobs where id = '${jobBId}';
      `).trim()

      // Start a persistent session to hold the advisory barrier lock
      const barrier = startRacePsql(target, 'el-barrier', {})
      sessions.push(barrier)
      await waitForRaceSession(barrier)
      barrier.child.stdin.write(`
        select pg_advisory_lock(120799);
        select 'BARRIER_HELD';
      `)
      await waitForRaceToken(barrier, 'BARRIER_HELD')

      const s1 = startRacePsql(target, 'el-s1', {})
      sessions.push(s1)
      await waitForRaceSession(s1)

      const s2 = startRacePsql(target, 'el-s2', {})
      sessions.push(s2)
      await waitForRaceSession(s2)

      // Session A: ending path (E1 → E2 → R → S → J → L).
      // persist_ending_lock_v1 re-enters E2 (key 130600) reentrantly.
      // ending_key provided to trigger the ending lock path.
      // Blocks on advisory barrier at the end.
      s1.child.stdin.end(`
        begin;
        set local statement_timeout = '30s';
        set local lock_timeout = '0'; -- Disable lock timeout so A holds the transaction locks indefinitely
        set role service_role;
        select public.publish_generation_job_chapter_v4(
          '${fixture.jobId}'::uuid, 'v4-test-worker',
          '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
          '${fixture.storyId}', ${CHAPTER},
          'Ending Chapter', '["Ending paragraph."]'::jsonb,
          'Apa yang dilakukan?',
          '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
          '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
          'ending:happy', 'Happy Ending', null::jsonb
        );
        select pg_advisory_xact_lock(120799);
        commit;
      `)

      check(
        barrier.backendPid !== null && s1.backendPid !== null && s2.backendPid !== null,
        'P5: backend PIDs must be resolved'
      )

      // Wait until Session A completes publication and blocks at the barrier held by barrier holder
      await verifyAdvisoryBarrierBlocked(target, s1.backendPid)

      // Session B: non-ending path (R → S → J → L). Wrap in temp table catcher.
      // B will block on the row-lock R (reader_states) held by Session A.
      s2.child.stdin.end(`
        begin;
        set local statement_timeout = '30s';
        set local lock_timeout = '12s'; -- Give B enough lock timeout to verify blocking before unlock
        set role service_role;
        create temp table r_err(res text) on commit drop;
        do $$
        begin
          perform public.publish_generation_job_chapter_v4(
            '${jobBId}'::uuid, 'v4-test-worker', '${claimTokenB}'::uuid, '${leaseBId}'::uuid,
            '${fixture.storyId}', 11,
            'Bab Sebelas', '["Paragraf sebelas."]'::jsonb,
            'Apa yang dilakukan?',
            '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'::jsonb,
            '[{"choiceId":"open-door","consequence":["Terbuka."],"nextChapterNumber":12,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Berhenti."],"nextChapterNumber":12,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'::jsonb,
            null, null, null::jsonb
          );
        exception when others then
          insert into r_err values (SQLERRM);
        end; $$;
        select res from r_err;
        commit;
      `)

      // Wait until Session B is verified blocked on Session A's transaction row lock
      await verifyRowLockBlocked(target, s1.backendPid, s2.backendPid)

      // Release the barrier by ending the barrier holder session to let Session A commit
      barrier.child.stdin.end('select pg_advisory_unlock(120799);')
      await waitForRaceSuccess(barrier)

      // Both must complete within timeout (no deadlock).
      await Promise.all([waitForRaceSuccess(s1), waitForRaceSuccess(s2)])

      // Assert: no deadlock error (SQLSTATE 40P01).
      check(!s1.stdout.includes('40P01'), 'P5: session A no deadlock (40P01)')
      check(!s2.stdout.includes('40P01'), 'P5: session B no deadlock (40P01)')
      check(!s1.stdout.includes('deadlock detected'), 'P5: session A no deadlock message')
      check(!s2.stdout.includes('deadlock detected'), 'P5: session B no deadlock message')

      // Job A: the ending predicate (p_ending_key not null) MUST drive the E1+E2
      // path AND publish. persist_ending_lock_v1 re-enters E2 (key 130600)
      // reentrantly within the same transaction, so success is REQUIRED — a
      // RUNNING/FAILED outcome would mean the ending path never actually ran.
      const statusA = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(statusA === 'SUCCEEDED', `P5: job A (ending path) SUCCEEDED (got: ${statusA})`)

      // Job B: non-ending path failed with LEASE_INVALID but did not deadlock.
      const statusB = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${jobBId}';
      `).trim()
      check(statusB === 'RUNNING', `P5: job B still RUNNING (got: ${statusB})`)
      check(s2.stdout.includes('LEASE_INVALID'), 'P5: session B failed with LEASE_INVALID')

      // Chapter 10 (A) published (A succeeded); chapter 11 (B) NOT published (B failed).
      const ch10Count = execLocalPsql(target, `
        select count(*)::text from public.chapters
        where story_id = '${fixture.storyId}' and number = ${CHAPTER};
      `).trim()
      check(ch10Count === '1', `P5: chapter 10 published exactly once (got: ${ch10Count})`)
      const ch11Count = execLocalPsql(target, `
        select count(*)::text from public.chapters
        where story_id = '${fixture.storyId}' and number = 11;
      `).trim()
      check(ch11Count === '0', `P5: chapter 11 NOT published (got: ${ch11Count})`)

      // Ending lock persisted on BOTH reader_states and the contract — proves the
      // ending predicate triggered E2 and persist_ending_lock_v1 committed.
      const lockedEndingKey = execLocalPsql(target, `
        select locked_ending_key::text from public.reader_states
        where user_id = '${USER_ID}' and story_id = '${fixture.storyId}';
      `).trim()
      check(
        lockedEndingKey === 'ending:happy',
        `P5: reader_states.locked_ending_key persisted (got: ${lockedEndingKey})`,
      )

      const contractEndingKey = execLocalPsql(target, `
        select ending_lock_json->>'key' from public.story_generation_contracts
        where story_id = '${fixture.storyId}';
      `).trim()
      check(
        contractEndingKey === 'ending:happy',
        `P5: contract ending_lock_json persisted (got: ${contractEndingKey})`,
      )

      console.log('  ✓ Property 5: ending predicate → E1+E2 path, no deadlock, ending lock persisted on both rows')
    }

    console.log(`\n  All ${CONTEXT} properties verified.`)
  } catch (error) {
    console.error('Race execution error: dumping session outputs:');
    for (const s of sessions) {
      if (s.stdout) console.log(`[SESSION ${s.applicationName} STDOUT]:`, s.stdout)
      if (s.stderr) console.error(`[SESSION ${s.applicationName} STDERR]:`, s.stderr)
    }
    throw error;
  } finally {
    cleanupTarget(target, storyIds)
    await cleanupRaceResources(target, sessions, storyIds, [])
  }
}

runRaceTests().catch((error) => {
  console.error(`${CONTEXT} FAILED:`, error)
  process.exit(1)
})
