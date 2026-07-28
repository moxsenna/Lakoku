/**
 * Plot-debt closure ledger race test.
 *
 * Two real database connections with synchronization barrier.
 * Tests the unique index ON CONFLICT behavior under concurrent insert.
 *
 * Scenarios:
 * 1. Same debt + same job → one insert, one ON CONFLICT DO NOTHING (idempotent)
 * 2. Same debt + same job → concurrent insert (both ON CONFLICT, no error)
 * 3. Hash constraint → invalid rejected, valid accepted
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

const CONTEXT = 'plot-debt closure race'
const CHAPTER = 10
const USER_ID = '00000000-0000-0000-0000-000000000001'

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

type Fixture = {
  storyId: string
  jobId: string
  workerId: string
  claimToken: string
  leaseId: string
}

function insertFixture(target: RaceTarget, label: string, storyIds: string[]): Fixture {
  const storyId = `test:closure-race:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const workerId = `closure-race:${label}`
  const claimToken = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  storyIds.push(storyId)

  execLocalPsql(target, `
    insert into public.stories (id, title, owner_user_id, visibility, story_mode)
    values (:'story_id', 'Closure race', :'user_id'::uuid, 'private', 'personalized_ai');
    insert into public.generation_jobs (
      id, story_id, chapter_number, user_id, generation_kind,
      status, max_attempts, available_at, deadline_at, publication_idempotency_key,
      story_contract_version
    ) values (
      :'job_id'::uuid, :'story_id', :chapter::integer, :'user_id'::uuid, 'personalized',
      'RUNNING', 4, clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '20 minutes',
      'generation-job:' || :'job_id'::uuid::text || ':publish:' || :chapter,
      1
    );
    insert into public.generation_leases (
      id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
    ) values (
      :'lease_id'::uuid, :'story_id', :chapter::integer, 'ACTIVE', :'worker_id',
      clock_timestamp() + interval '5 minutes', :'job_id'::uuid, :'claim_token'::uuid
    );
    insert into public.reader_states (user_id, story_id, status, current_chapter)
    values (:'user_id'::uuid, :'story_id', 'BERJALAN', :chapter::integer);
    insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version)
    values (:'story_id', 'personalized_ai', 50,
      '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'::jsonb,
      1);
  `, {
    story_id: storyId, user_id: USER_ID, job_id: jobId,
    chapter: String(CHAPTER), worker_id: workerId,
    claim_token: claimToken, lease_id: leaseId,
  })

  return { storyId, jobId, workerId, claimToken, leaseId }
}

function vars(fixture: Fixture): Record<string, string> {
  return {
    user_id: USER_ID, story_id: fixture.storyId,
    job_id: fixture.jobId, chapter: String(CHAPTER),
  }
}

function cleanupTarget(target: RaceTarget, storyIds: string[]): void {
  for (const storyId of storyIds) {
    execLocalPsql(target, `
      delete from public.reader_plot_debt_closures where story_id = :'sid';
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
    // ─── Scenario 1: Concurrent insert same debt → both ON CONFLICT DO NOTHING ───
    {
      const fixture = insertFixture(target, 'concurrent', storyIds)
      const v = vars(fixture)

      // Session A: holds the row lock by inserting first.
      const holder = startRacePsql(target, 'closure-holder', v)
      sessions.push(holder)
      const holderPid = await waitForRaceSession(holder)
      holder.child.stdin.write(`
        begin;
        set local statement_timeout = '5s';
        set local lock_timeout = '2s';
        insert into public.reader_plot_debt_closures
        (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
        values (:'user_id'::uuid, :'story_id', 'main_mystery', 'RESOLVED', ${CHAPTER}, :'job_id'::uuid);
        select 'ROW_INSERTED';
      `)
      await waitForRaceToken(holder, 'ROW_INSERTED')

      // Session B: tries to insert same debt (will block on unique index).
      const contender = startRacePsql(target, 'closure-contender', v)
      sessions.push(contender)
      await waitForRaceSession(contender)
      contender.child.stdin.end(`
        begin;
        set local statement_timeout = '5s';
        set local lock_timeout = '2s';
        insert into public.reader_plot_debt_closures
        (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
        values (:'user_id'::uuid, :'story_id', 'main_mystery', 'SUBVERTED', ${CHAPTER}, :'job_id'::uuid)
        on conflict (user_id, story_id, debt_id) do nothing;
        select 'CONTENDER_DONE';
      `)

      // Release holder.
      holder.child.stdin.end(`commit;`)

      // Both should complete without error.
      await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(contender)])

      // Verify exactly one row exists.
      const count = execLocalPsql(target, `
        select count(*)::text from public.reader_plot_debt_closures
        where user_id = '${USER_ID}' and story_id = '${fixture.storyId}' and debt_id = 'main_mystery';
      `)
      check(count.includes('1'), 'scenario 1: exactly one row after concurrent insert')
      console.log('  ✓ Scenario 1: concurrent insert same debt → one row, no error')
    }

    // ─── Scenario 2: Sequential idempotent insert ───
    {
      const fixture = insertFixture(target, 'seq-idempotent', storyIds)

      const first = execLocalPsql(target, `
        insert into public.reader_plot_debt_closures
        (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
        values ('${USER_ID}', '${fixture.storyId}', 'late_debt', 'RESOLVED', ${CHAPTER}, '${fixture.jobId}')
        returning 'inserted';
      `)
      check(first.includes('inserted'), 'scenario 2: first insert succeeded')

      const second = execLocalPsql(target, `
        insert into public.reader_plot_debt_closures
        (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
        values ('${USER_ID}', '${fixture.storyId}', 'late_debt', 'SUBVERTED', ${CHAPTER}, '${fixture.jobId}')
        on conflict (user_id, story_id, debt_id) do nothing
        returning 'inserted';
      `)
      check(!second.includes('ERROR'), 'scenario 2: ON CONFLICT no error')
      check(!second.includes('inserted'), 'scenario 2: ON CONFLICT no insert')

      console.log('  ✓ Scenario 2: sequential idempotent → no-op')
    }

    // ─── Scenario 3: Hash constraint ───
    {
      const fixture = insertFixture(target, 'hash', storyIds)

      const invalid = execLocalPsql(target, `
        update public.generation_jobs set closure_payload_hash = 'not-a-hash' where id = '${fixture.jobId}';
      `)
      check(invalid.includes('ERROR'), 'scenario 3: invalid hash rejected')

      const valid = execLocalPsql(target, `
        update public.generation_jobs
        set closure_payload_hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
        where id = '${fixture.jobId}';
      `)
      check(!valid.includes('ERROR'), 'scenario 3: valid hex hash accepted')
      console.log('  ✓ Scenario 3: hash constraint validated')
    }

    // ─── Scenario 4: UPDATE trigger rejects ───
    {
      const fixture = insertFixture(target, 'update', storyIds)

      execLocalPsql(target, `
        insert into public.reader_plot_debt_closures
        (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
        values ('${USER_ID}', '${fixture.storyId}', 'probe_debt', 'RESOLVED', ${CHAPTER}, '${fixture.jobId}');
      `)

      const updateResult = execLocalPsql(target, `
        update public.reader_plot_debt_closures
        set closure_form = 'SUBVERTED'
        where user_id = '${USER_ID}' and story_id = '${fixture.storyId}' and debt_id = 'probe_debt';
      `)
      check(updateResult.includes('PLOT_DEBT_CLOSURE_IMMUTABLE'), 'scenario 4: UPDATE trigger rejected')
      console.log('  ✓ Scenario 4: UPDATE trigger rejected')
    }

    console.log(`\n  All ${CONTEXT} scenarios passed.`)
  } finally {
    cleanupTarget(target, storyIds)
    await cleanupRaceResources(target, sessions, storyIds, [])
  }
}

runRaceTests().catch((error) => {
  console.error(`${CONTEXT} FAILED:`, error)
  process.exit(1)
})
