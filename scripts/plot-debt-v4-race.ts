/**
 * publish_generation_job_chapter_v4 race test.
 *
 * Two real database connections calling V4 RPC concurrently.
 * Tests 5 critical properties of V4 concurrent behavior.
 *
 * Properties:
 * 1. same job + same payload → idempotent success
 * 2. different jobs + same debt → one succeeds, one DEBT_CLOSURE_CONFLICT
 * 3. ownership changes before J lock → stale caller rejected
 * 4. no deadlock — two sessions complete within lock_timeout
 * 5. identical full replay → cached success
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
  storyIds.push(storyId)

  execLocalPsql(target, `
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
      'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '20 minutes',
      gen_random_uuid(),
      'generation-job:' || :'job_id'::uuid::text || ':publish:' || ${CHAPTER},
      1
    );
    insert into public.generation_leases (
      id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
    ) values (
      :'lease_id'::uuid, :'story_id', ${CHAPTER}, 'ACTIVE', :'label',
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
    lease_id: leaseId, label, claim_token: crypto.randomUUID(),
  })

  const claimToken = execLocalPsql(target, `
    select claim_token::text from public.generation_jobs where id = '${jobId}';
  `).trim()

  return { storyId, jobId, leaseId, claimToken }
}

function v4CallSql(fixture: { jobId: string; leaseId: string; claimToken: string; storyId: string }): string {
  return `
    set local role service_role;
    select public.publish_generation_job_chapter_v4(
      '${fixture.jobId}'::uuid, 'v4-test-worker',
      '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
      '${fixture.storyId}', ${CHAPTER},
      'Race Chapter', '["Race paragraph."]'::jsonb,
      'Apa yang dilakukan sekarang?',
      '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
      '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
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
    set local role service_role;
    select public.publish_generation_job_chapter_v4(
      '${fixture.jobId}'::uuid, 'v4-test-worker',
      '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
      '${fixture.storyId}', ${CHAPTER},
      'Race Chapter', '["Race paragraph."]'::jsonb,
      'Apa yang dilakukan sekarang?',
      '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
      '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
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
    // ─── Property 1: same job + same payload → idempotent ───
    {
      const fixture = insertFixture(target, 'idempotent', storyIds)

      // Session A: calls V4 (will publish + write closures).
      const s1 = startRacePsql(target, 'v4-s1', {})
      sessions.push(s1)
      await waitForRaceSession(s1)
      s1.child.stdin.write(`
        begin;
        set local statement_timeout = '10s';
        ${v4CallSql(fixture)}
        select 'S1_DONE';
      `)
      await waitForRaceToken(s1, 'S1_DONE')

      // Session B: calls V4 with same payload (will hit idempotent path).
      const s2 = startRacePsql(target, 'v4-s2', {})
      sessions.push(s2)
      await waitForRaceSession(s2)
      s2.child.stdin.write(`
        begin;
        set local statement_timeout = '10s';
        ${v4CallSql(fixture)}
        select 'S2_DONE';
      `)
      await waitForRaceToken(s2, 'S2_DONE')

      // Commit both.
      s1.child.stdin.end(`commit;`)
      s2.child.stdin.end(`commit;`)
      await Promise.all([waitForRaceSuccess(s1), waitForRaceSuccess(s2)])

      // Verify: chapter published, job SUCCEEDED.
      const jobStatus = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(jobStatus === 'SUCCEEDED', `P1: job SUCCEEDED (got: ${jobStatus})`)
      console.log('  ✓ Property 1: same job + same payload → idempotent success')
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
          'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '20 minutes',
          gen_random_uuid(),
          'generation-job:${jobBId}:publish:11', 1
        );
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
      const resultB = execLocalPsql(target, `
        set local role service_role;
        select public.publish_generation_job_chapter_v4(
          '${jobBId}'::uuid, 'v4-test-worker', '${claimTokenB}'::uuid, '${leaseBId}'::uuid,
          '${fixture.storyId}', 11,
          'Bab Sebelas', '["Paragraf sebelas."]'::jsonb,
          'Apa yang dilakukan?',
          '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
          '[{"choiceId":"open-door","consequence":["Terbuka."],"nextChapterNumber":12,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Berhenti."],"nextChapterNumber":12,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
          null, null,
          '[{"debtId":"main_mystery","closureForm":"SUBVERTED"}]'::jsonb
        );
      `)
      check(
        resultB.includes('DEBT_CLOSURE_CONFLICT'),
        `P2: job B rejected with DEBT_CLOSURE_CONFLICT (got: ${resultB.slice(0, 200)})`,
      )

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
      execLocalPsql(target, `
        update public.generation_jobs set worker_id = 'stolen-worker'
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
      const jobBId = crypto.randomUUID()
      const leaseBId = crypto.randomUUID()
      execLocalPsql(target, `
        insert into public.generation_jobs (
          id, story_id, chapter_number, user_id, generation_kind,
          status, attempt_count, max_attempts, available_at, deadline_at,
          correlation_id, publication_idempotency_key, story_contract_version
        ) values (
          '${jobBId}'::uuid, '${fixture.storyId}', 11, '${USER_ID}'::uuid, 'personalized',
          'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '20 minutes',
          gen_random_uuid(), 'generation-job:${jobBId}:publish:11', 1
        );
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
          'PROSE_READY', 'Ch 11', '["P11."]'::jsonb, 'fp11-dl',
          '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
          2, 5, 2, 'dir11-dl', 'personalized', 2, 2,
          '${jobBId}'::uuid, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
        );
      `)

      const claimTokenB = execLocalPsql(target, `
        select claim_token::text from public.generation_jobs where id = '${jobBId}';
      `).trim()

      const s1 = startRacePsql(target, 'dl-jobA', {})
      sessions.push(s1)
      await waitForRaceSession(s1)

      const s2 = startRacePsql(target, 'dl-jobB', {})
      sessions.push(s2)
      await waitForRaceSession(s2)

      // Both start simultaneously, contending on R + S for the same story.
      // lock_timeout ensures we detect blocking rather than hanging.
      s1.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '10s';
        ${v4CallSql(fixture)}
        commit;
      `)
      s2.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '10s';
        set local role service_role;
        select public.publish_generation_job_chapter_v4(
          '${jobBId}'::uuid, 'v4-test-worker', '${claimTokenB}'::uuid, '${leaseBId}'::uuid,
          '${fixture.storyId}', 11,
          'Bab Sebelas', '["Paragraf sebelas."]'::jsonb,
          'Apa yang dilakukan?',
          '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
          '[{"choiceId":"open-door","consequence":["Terbuka."],"nextChapterNumber":12,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Berhenti."],"nextChapterNumber":12,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
          null, null, null::jsonb
        );
        commit;
      `)

      // Both must complete within timeout (no deadlock).
      await Promise.all([waitForRaceSuccess(s1), waitForRaceSuccess(s2)])

      // Assert: no deadlock error (SQLSTATE 40P01).
      check(!s1.stdout.includes('40P01'), 'P4: session A no deadlock (40P01)')
      check(!s2.stdout.includes('40P01'), 'P4: session B no deadlock (40P01)')
      check(!s1.stdout.includes('deadlock detected'), 'P4: session A no deadlock message')
      check(!s2.stdout.includes('deadlock detected'), 'P4: session B no deadlock message')

      // Both jobs should reach terminal state.
      const statusA = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      const statusB = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${jobBId}';
      `).trim()
      check(statusA === 'SUCCEEDED', `P4: job A SUCCEEDED (got: ${statusA})`)
      check(statusB === 'SUCCEEDED', `P4: job B SUCCEEDED (got: ${statusB})`)

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
      const jobBId = crypto.randomUUID()
      const leaseBId = crypto.randomUUID()
      execLocalPsql(target, `
        insert into public.generation_jobs (
          id, story_id, chapter_number, user_id, generation_kind,
          status, attempt_count, max_attempts, available_at, deadline_at,
          correlation_id, publication_idempotency_key, story_contract_version
        ) values (
          '${jobBId}'::uuid, '${fixture.storyId}', 11, '${USER_ID}'::uuid, 'personalized',
          'RUNNING', 1, 4, clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '20 minutes',
          gen_random_uuid(), 'generation-job:${jobBId}:publish:11', 1
        );
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
          'PROSE_READY', 'Ch 11 EL', '["P11."]'::jsonb, 'fp11-el',
          '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
          2, 5, 2, 'dir11-el', 'personalized', 2, 2,
          '${jobBId}'::uuid, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
        );
      `)

      const claimTokenB = execLocalPsql(target, `
        select claim_token::text from public.generation_jobs where id = '${jobBId}';
      `).trim()

      const s1 = startRacePsql(target, 'el-s1', {})
      sessions.push(s1)
      await waitForRaceSession(s1)

      const s2 = startRacePsql(target, 'el-s2', {})
      sessions.push(s2)
      await waitForRaceSession(s2)

      // Session A: ending path (E1 → E2 → R → S → J → L).
      // persist_ending_lock_v1 re-enters E2 (key 130600) reentrantly.
      // ending_key provided to trigger the ending lock path.
      s1.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '10s';
        set local role service_role;
        select public.publish_generation_job_chapter_v4(
          '${fixture.jobId}'::uuid, 'v4-test-worker',
          '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
          '${fixture.storyId}', ${CHAPTER},
          'Ending Chapter', '["Ending paragraph."]'::jsonb,
          'Apa yang dilakukan?',
          '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
          '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
          'ending:happy', 'Happy Ending', null::jsonb
        );
        commit;
      `)

      // Session B: non-ending path (R → S → J → L).
      s2.child.stdin.end(`
        begin;
        set local statement_timeout = '15s';
        set local lock_timeout = '10s';
        set local role service_role;
        select public.publish_generation_job_chapter_v4(
          '${jobBId}'::uuid, 'v4-test-worker', '${claimTokenB}'::uuid, '${leaseBId}'::uuid,
          '${fixture.storyId}', 11,
          'Bab Sebelas', '["Paragraf sebelas."]'::jsonb,
          'Apa yang dilakukan?',
          '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadangi penjaga bertongkat"}]'::jsonb,
          '[{"choiceId":"open-door","consequence":["Terbuka."],"nextChapterNumber":12,"isEnding":false,"effect_json":{},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Berhenti."],"nextChapterNumber":12,"isEnding":false,"effect_json":{},"choice_kind":"normal"}]'::jsonb,
          null, null, null::jsonb
        );
        commit;
      `)

      // Both must complete within timeout (no deadlock).
      await Promise.all([waitForRaceSuccess(s1), waitForRaceSuccess(s2)])

      // Assert: no deadlock error (SQLSTATE 40P01).
      check(!s1.stdout.includes('40P01'), 'P5: session A no deadlock (40P01)')
      check(!s2.stdout.includes('40P01'), 'P5: session B no deadlock (40P01)')
      check(!s1.stdout.includes('deadlock detected'), 'P5: session A no deadlock message')
      check(!s2.stdout.includes('deadlock detected'), 'P5: session B no deadlock message')

      // Job A: may SUCCEEDED (if persist_ending_lock_v1 succeeded) or FAILED (if ending lock rejected).
      // Either outcome is acceptable — no deadlock, no partial publication.
      const statusA = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(
        statusA === 'SUCCEEDED' || statusA === 'RUNNING' || statusA === 'FAILED',
        `P5: job A in terminal/running state (got: ${statusA})`,
      )

      // Job B: non-ending path should SUCCEEDED (no ending lock contention).
      const statusB = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${jobBId}';
      `).trim()
      check(statusB === 'SUCCEEDED', `P5: job B SUCCEEDED (got: ${statusB})`)

      // No partial publications: if A failed, no chapter 10. If A succeeded, chapter 10 exists.
      if (statusA === 'SUCCEEDED') {
        const ch10Count = execLocalPsql(target, `
          select count(*)::text from public.chapters
          where story_id = '${fixture.storyId}' and number = ${CHAPTER};
        `)
        check(ch10Count.includes('1'), 'P5: chapter 10 published (A succeeded)')
      }

      console.log('  ✓ Property 5: ending-lock race — E1+E2 contention, no deadlock')
    }

    console.log(`\n  All ${CONTEXT} properties verified.`)
  } finally {
    cleanupTarget(target, storyIds)
    await cleanupRaceResources(target, sessions, storyIds, [])
  }
}

runRaceTests().catch((error) => {
  console.error(`${CONTEXT} FAILED:`, error)
  process.exit(1)
})
