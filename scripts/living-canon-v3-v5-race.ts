/**
 * publish_chapter_state_v3 (sync) vs publish_generation_job_chapter_v5 (worker)
 * race test — M10-A1c.1 (R1 redesign: per-lease-ownership; R3: replay
 * authority = immutable commit ledger, evaluated under the LOCKED J before L).
 *
 * Two real database connections publishing the SAME story + chapter
 * concurrently: one through the sync publisher (V3, checkpoint attempt bound
 * to a sync writer, no job) and one through the worker publisher (V5, RUNNING
 * job + claim-bound lease). The two properties differ in WHO OWNS the single
 * ACTIVE lease — each ownership proves the OTHER side is fenced:
 *
 * Property 1 — WORKER-owned ACTIVE lease (job_id/claim_token bound):
 *   V5 is eligible (lease matches job id/claim/holder) and wins. V3 is fenced
 *   as a non-sync lease: its replay evaluation (pure SELECT, BEFORE the lease
 *   gate) sees the winner's commit with a DIFFERENT checkpoint attempt →
 *   13-field CONFLICT → PUBLICATION_CONFLICT (R1-8: V3 loser is the replay
 *   fence, not an L-phase lease failure). The V3 lease gate itself
 *   (job_id IS NULL AND claim_token IS NULL) is proven separately in the
 *   pgTAP suite (v3-worker-lease → GENERATION_JOB_LEASE_INVALID).
 * Property 2 — SYNC-owned ACTIVE lease (job_id/claim_token NULL):
 *   V3 is eligible (sync lease contract) and wins. V5 is fenced by the SAME
 *   ledger replay (R3 — the SUCCEEDED dual-hash fast path is gone): its
 *   Phase C replay under the locked J sees the winner's sync commit with a
 *   different checkpoint attempt/correlation → 13-field CONFLICT; the loser's
 *   job is still RUNNING → PUBLICATION_CONFLICT. The lease binding itself
 *   (fresh V5 publication with a sync-owned lease → GENERATION_JOB_LEASE_INVALID)
 *   is proven separately in the pgTAP suite (v5-sync-lease).
 *
 * Deterministic winner via the advisory barrier (120799): the winner's session
 * completes its publication inside an open transaction and then blocks at the
 * barrier, holding S (120712) + all row locks. The loser starts afterwards,
 * blocks on S, and after the barrier releases is fenced. No deadlock (S is
 * the single serialization point), one chapter, one commit, revision +1,
 * winner checkpoint PUBLISHED, loser untouched.
 *
 * Properties:
 * 1. Worker lease → V5 wins → job SUCCEEDED, V3 fenced (PUBLICATION_CONFLICT
 *    via replay); exactly one publication.
 * 2. Sync lease → V3 wins → job stays RUNNING, V5 fenced (PUBLICATION_CONFLICT
 *    via replay); exactly one publication.
 */
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

const CONTEXT = 'living-canon V3/V5 race'
const CHAPTER = 10
const USER_ID = '00000000-0000-0000-0000-000000000001'
const CHOICE_PROMPT = 'Ke mana Raka melangkah sekarang?'
const TITLE = 'Bab Sepuluh — Persimpangan'
const PARAGRAPHS = '["Raka berhenti di persimpangan."]'
const WORKER_ID = 'v3v5-race-worker'
// Debt contract: main_mystery introduced ch1, mustCloseBy 48. Chapter 10
// publishes with NO closures — no deadline/omission violation at ch10.
const DEBTS_JSON =
  '[{"id":"main_mystery","question":"Apa misteri di balik kepergian ayah Raka?","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"}]'
const CHOICES =
  '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga bertongkat"}]'
const OUTCOMES =
  '[{"choiceId":"open-door","consequence":["Pintu terbuka."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},{"choiceId":"stop-guard","consequence":["Penjaga berhenti."],"nextChapterNumber":11,"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]'

function deltaJson(storyId: string): string {
  // Canonical delta: valid schema-1 shape, ALL sections empty → applier is a
  // no-op. Identical for both callers (parity of the publication surface).
  return JSON.stringify({
    schemaVersion: 1,
    chapterNumber: CHAPTER,
    storyId,
    facts: { add: [], markPaidOff: [] },
    knowledge: { grants: [] },
    secrets: { revealIds: [] },
    timeline: { append: [] },
    characters: { statusChanges: [] },
    threads: { touches: [], transitions: [] },
    actRollup: null,
    plotDebts: { progress: [], closures: [] },
  })
}

interface Fixture {
  storyId: string
  jobId: string
  leaseId: string
  claimToken: string
  syncAttemptId: string
}

/** Lease ownership decides which side is eligible (R1-3): a worker lease binds
 * job_id/claim_token (V5-only); a sync lease leaves them NULL (V3-only). */
type LeaseOwnership = 'worker' | 'sync'

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function insertFixture(
  target: RaceTarget,
  label: string,
  storyIds: string[],
  leaseOwnership: LeaseOwnership,
): Fixture {
  const storyId = `test:v3v5-race:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  const claimToken = crypto.randomUUID()
  const syncAttemptId = crypto.randomUUID()
  const syncCorrelationId = crypto.randomUUID()
  storyIds.push(storyId)

  const leaseInsert =
    leaseOwnership === 'worker'
      ? `
        insert into public.generation_leases (
          id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
        ) values (
          :'lease_id'::uuid, :'story_id', ${CHAPTER}, 'ACTIVE', '${WORKER_ID}',
          clock_timestamp() + interval '5 minutes', :'job_id'::uuid, :'claim_token'::uuid
        );`
      : `
        insert into public.generation_leases (
          id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
        ) values (
          :'lease_id'::uuid, :'story_id', ${CHAPTER}, 'ACTIVE', 'sync-holder',
          clock_timestamp() + interval '5 minutes', null, null
        );`

  execLocalPsql(target, `
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (:'user_id'::uuid, 'authenticated', 'authenticated', 'v3v5-race-owner@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
    on conflict (id) do nothing;
    insert into public.stories (id, title, owner_user_id, visibility, story_mode, story_contract_version, living_canon_version, canon_state_revision)
    values (:'story_id', 'V3/V5 race', :'user_id'::uuid, 'private', 'personalized_ai', 1, 1, 0);
    insert into public.reader_states (user_id, story_id, status, current_chapter)
    values (:'user_id'::uuid, :'story_id', 'BERJALAN', ${CHAPTER});
    insert into public.story_generation_contracts (story_id, mode, total_chapters, plot_debts_json, story_contract_version, story_contract_json)
    values (:'story_id', 'personalized_ai', 50, '${DEBTS_JSON}'::jsonb, 1,
      '{"actPlan":[{"actNumber":1,"fromChapter":1,"toChapter":4,"goal":"G1"},{"actNumber":2,"fromChapter":5,"toChapter":8,"goal":"G2"},{"actNumber":3,"fromChapter":9,"toChapter":12,"goal":"G3"},{"actNumber":4,"fromChapter":13,"toChapter":16,"goal":"G4"},{"actNumber":5,"fromChapter":17,"toChapter":20,"goal":"G5"},{"actNumber":6,"fromChapter":21,"toChapter":24,"goal":"G6"},{"actNumber":7,"fromChapter":25,"toChapter":28,"goal":"G7"},{"actNumber":8,"fromChapter":29,"toChapter":32,"goal":"G8"},{"actNumber":9,"fromChapter":33,"toChapter":36,"goal":"G9"},{"actNumber":10,"fromChapter":37,"toChapter":40,"goal":"G10"},{"actNumber":11,"fromChapter":41,"toChapter":44,"goal":"G11"},{"actNumber":12,"fromChapter":45,"toChapter":50,"goal":"G12"}]}'::jsonb);
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
        worker_id = '${WORKER_ID}', claim_token = :'claim_token'::uuid,
        claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
    where id = :'job_id'::uuid;
    ${leaseInsert}
    -- V5 (worker) checkpoint: attempt = job id, bound to job.
    insert into public.chapter_generation_checkpoints (
      story_id, chapter_number, attempt_id, correlation_id, status,
      title, paragraphs_json, prose_fingerprint,
      audit_signals_json, audit_signals_version,
      canon_version, blueprint_version, direction_fingerprint,
      generation_mode, generation_policy_version, prompt_contract_version,
      job_id, job_attempt_number, checkpoint_schema_version,
      state_delta_json, state_delta_hash, state_delta_schema_version, base_canon_revision,
      prose_attempt_count, choice_attempt_count, expires_at,
      story_contract_version
    ) values (
      :'story_id', ${CHAPTER}, :'job_id'::uuid,
      (select correlation_id from public.generation_jobs where id = :'job_id'::uuid),
      'PROSE_READY', '${TITLE}', '${PARAGRAPHS}'::jsonb,
      'v3v5-fp-0000000000000000000000000000000',
      '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
      2, 5, 2, 'v3v5-dir-00000000000000000000000000000', 'personalized', 2, 2,
      :'job_id'::uuid, 1, 3,
      '${deltaJson(storyId)}'::jsonb,
      chapter_state_delta_hash_v1('${deltaJson(storyId)}'::jsonb), 1, 0,
      1, 0, clock_timestamp() + interval '24 hours', 1
    );
    -- V3 (sync) checkpoint: separate attempt, no job binding. Same
    -- title/paragraphs/delta → identical publication surface.
    insert into public.chapter_generation_checkpoints (
      story_id, chapter_number, attempt_id, correlation_id, status,
      title, paragraphs_json, prose_fingerprint,
      audit_signals_json, audit_signals_version,
      canon_version, blueprint_version, direction_fingerprint,
      generation_mode, generation_policy_version, prompt_contract_version,
      job_id, job_attempt_number, checkpoint_schema_version,
      state_delta_json, state_delta_hash, state_delta_schema_version, base_canon_revision,
      prose_attempt_count, choice_attempt_count, expires_at,
      story_contract_version
    ) values (
      :'story_id', ${CHAPTER}, :'sync_attempt'::uuid, :'sync_correlation'::uuid,
      'PROSE_READY', '${TITLE}', '${PARAGRAPHS}'::jsonb,
      'v3v5-fp-0000000000000000000000000000000',
      '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
      2, 5, 2, 'v3v5-dir-00000000000000000000000000000', 'personalized', 2, 2,
      null, null, 3,
      '${deltaJson(storyId)}'::jsonb,
      chapter_state_delta_hash_v1('${deltaJson(storyId)}'::jsonb), 1, 0,
      1, 0, clock_timestamp() + interval '24 hours', 1
    );
  `, {
    story_id: storyId, user_id: USER_ID, job_id: jobId,
    lease_id: leaseId, claim_token: claimToken,
    sync_attempt: syncAttemptId, sync_correlation: syncCorrelationId,
    label,
  })

  return { storyId, jobId, leaseId, claimToken, syncAttemptId }
}

function v5CallSql(fixture: Fixture): string {
  return `
    select public.publish_generation_job_chapter_v5(
      '${fixture.jobId}'::uuid, '${WORKER_ID}',
      '${fixture.claimToken}'::uuid, '${fixture.leaseId}'::uuid,
      '${fixture.storyId}', ${CHAPTER},
      '${CHOICE_PROMPT}', '${CHOICES}'::jsonb, '${OUTCOMES}'::jsonb,
      null, null
    )::text;
  `
}

function v3CallSql(fixture: Fixture): string {
  return `
    select public.publish_chapter_state_v3(
      '${fixture.storyId}', ${CHAPTER}, '${USER_ID}'::uuid,
      '${fixture.leaseId}'::uuid, '${fixture.syncAttemptId}'::uuid,
      '${CHOICE_PROMPT}', '${CHOICES}'::jsonb, '${OUTCOMES}'::jsonb,
      null, null
    )::text;
  `
}

/** Loser session template: wrap the call so the fenced error lands in a temp
 * table row instead of killing the psql process. */
function loserSessionSql(callSql: string): string {
  return `
    begin;
    set local statement_timeout = '30s';
    set local lock_timeout = '12s';
    create temp table r_err(res text) on commit drop;
    do $$
    begin
      insert into r_err
      ${callSql}
    exception when others then
      insert into r_err values (SQLERRM);
    end; $$;
    select res from r_err;
    commit;
  `
}

/** Verify the loser session is blocked on the story advisory lock (S, key
 * hashtextextended(story_id, 120712)) held by the winner's open transaction. */
async function verifySAdvisoryBlocked(
  target: RaceTarget,
  blockedPid: number,
  storyId: string,
  retries = 35,
): Promise<void> {
  const query = `
    select count(*)::text
    from pg_locks
    where locktype = 'advisory'
      and pid = ${blockedPid}
      and not granted
      and objid::bigint = (hashtextextended('${storyId}', 120712) & 4294967295);`
  for (let i = 0; i < retries; i++) {
    const result = execLocalPsql(target, query).trim()
    if (parseInt(result, 10) > 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timeout waiting for S advisory block on PID ${blockedPid}`)
}

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

function cleanupTarget(target: RaceTarget, storyIds: string[]): void {
  for (const storyId of storyIds) {
    execLocalPsql(target, `
      delete from public.chapter_generation_checkpoints where story_id = :'sid';
      delete from public.chapter_state_commits where story_id = :'sid';
      delete from public.generation_job_attempts where job_id in (
        select id from public.generation_jobs where story_id = :'sid'
      );
      delete from public.idempotency_keys where story_id = :'sid';
      delete from public.story_events where story_id = :'sid';
      delete from public.chapters where story_id = :'sid';
      delete from public.choice_outcomes where story_id = :'sid';
      delete from public.reader_plot_debt_closures where story_id = :'sid';
      delete from public.reader_plot_debt_progress where story_id = :'sid';
      delete from public.generation_leases where story_id = :'sid';
      delete from public.generation_jobs where story_id = :'sid';
      delete from public.story_generation_contracts where story_id = :'sid';
      delete from public.reader_states where story_id = :'sid';
      delete from public.stories where id = :'sid';
    `, { sid: storyId })
  }
}

/** Shared outcome assertions after either ordering. */
function assertSinglePublication(
  target: RaceTarget,
  fixture: Fixture,
  winner: 'v3' | 'v5',
  winnerSession: RunningRacePsql,
  loserSession: RunningRacePsql,
): void {
  // One publication: one chapter, one commit, revision +1.
  const chapterCount = execLocalPsql(target, `
    select count(*)::text from public.chapters
    where story_id = '${fixture.storyId}' and number = ${CHAPTER};
  `).trim()
  check(chapterCount === '1', `${winner}: chapter published exactly once (got: ${chapterCount})`)

  const commitCount = execLocalPsql(target, `
    select count(*)::text from public.chapter_state_commits
    where story_id = '${fixture.storyId}' and chapter_number = ${CHAPTER};
  `).trim()
  check(commitCount === '1', `${winner}: commit ledger exactly once (got: ${commitCount})`)

  const revision = execLocalPsql(target, `
    select canon_state_revision::text from public.stories where id = '${fixture.storyId}';
  `).trim()
  check(revision === '1', `${winner}: canon_state_revision 1 (got: ${revision})`)

  // Winner terminal, loser untouched.
  const winnerCheckpoint = execLocalPsql(target, `
    select status from public.chapter_generation_checkpoints
    where story_id = '${fixture.storyId}' and chapter_number = ${CHAPTER}
    order by (attempt_id = ${winner === 'v5' ? `'${fixture.jobId}'` : `'${fixture.syncAttemptId}'`}::uuid) desc
    limit 1;
  `).trim()
  check(winnerCheckpoint === 'PUBLISHED', `${winner}: winner checkpoint PUBLISHED (got: ${winnerCheckpoint})`)

  const loserCheckpoint = execLocalPsql(target, `
    select status from public.chapter_generation_checkpoints
    where story_id = '${fixture.storyId}' and chapter_number = ${CHAPTER}
    order by (attempt_id = ${winner === 'v5' ? `'${fixture.syncAttemptId}'` : `'${fixture.jobId}'`}::uuid) desc
    limit 1;
  `).trim()
  check(loserCheckpoint === 'PROSE_READY', `${winner}: loser checkpoint untouched (got: ${loserCheckpoint})`)

  const leaseStatus = execLocalPsql(target, `
    select status from public.generation_leases where id = '${fixture.leaseId}';
  `).trim()
  check(leaseStatus === 'RELEASED', `${winner}: shared lease RELEASED (got: ${leaseStatus})`)

  // Loser fenced without a deadlock (R3 — replay authority is the immutable
  // commit ledger for BOTH paths, evaluated BEFORE the L-phase lease gate):
  //  - V3 loser (P1, worker-owned lease): the winner's commit already exists
  //    with a different checkpoint attempt → 13-field CONFLICT →
  //    PUBLICATION_CONFLICT (R1-8: V3 loser is the replay fence, not an
  //    L-phase lease failure).
  //  - V5 loser (P2, sync-owned lease): its Phase C replay under the locked J
  //    exists the same way — the winner's sync commit has a different
  //    checkpoint attempt/correlation → 13-field CONFLICT; the loser's job is
  //    still RUNNING (never terminalized) → PUBLICATION_CONFLICT. (R3 removed
  //    V5's SUCCEEDED dual-hash fast path, which would have raced ahead of the
  //    ledger; the lease binding itself is covered by pgTAP v5-sync-lease →
  //    GENERATION_JOB_LEASE_INVALID on a fresh publication.)
  const expectedFence = 'PUBLICATION_CONFLICT'
  check(
    loserSession.stdout.includes(expectedFence),
    `${winner}: loser fenced with ${expectedFence}`,
  )
  check(!loserSession.stdout.includes('40P01'), `${winner}: loser no deadlock (40P01)`)
  check(!loserSession.stdout.includes('deadlock detected'), `${winner}: loser no deadlock message`)
  check(!winnerSession.stdout.includes('40P01'), `${winner}: winner no deadlock (40P01)`)

  // No closure/progress ledgers written (empty delta).
  const closures = execLocalPsql(target, `
    select count(*)::text from public.reader_plot_debt_closures where story_id = '${fixture.storyId}';
  `).trim()
  check(closures === '0', `${winner}: no closures (got: ${closures})`)
}

async function runRaceTests(): Promise<void> {
  const target = verifyLocalRaceTarget(CONTEXT)
  const storyIds: string[] = []
  const sessions: RunningRacePsql[] = []

  try {
    // ─── Property 1: WORKER-owned lease → V5 (worker) wins; V3 (sync) fenced ───
    // V5 completes publication in an open transaction and blocks at the
    // barrier, holding S + row locks. V3 starts after, blocks on S, and after
    // the barrier release is fenced by the replay fast path (the winner's
    // commit has a different checkpoint attempt → PUBLICATION_CONFLICT).
    {
      const fixture = insertFixture(target, 'v5-wins', storyIds, 'worker')

      const barrier = startRacePsql(target, 'v5w-barrier', {})
      sessions.push(barrier)
      await waitForRaceSession(barrier)
      barrier.child.stdin.write(`
        select pg_advisory_lock(120799);
        select 'BARRIER_HELD';
      `)
      await waitForRaceToken(barrier, 'BARRIER_HELD')

      const winner = startRacePsql(target, 'v5w-winner', {})
      sessions.push(winner)
      await waitForRaceSession(winner)

      const loser = startRacePsql(target, 'v5w-loser', {})
      sessions.push(loser)
      await waitForRaceSession(loser)

      // Winner (V5): publish, then block at the barrier inside the same txn.
      winner.child.stdin.end(`
        begin;
        set local statement_timeout = '30s';
        set local lock_timeout = '0';
        ${v5CallSql(fixture)}
        select pg_advisory_xact_lock(120799);
        commit;
      `)

      check(
        barrier.backendPid !== null && winner.backendPid !== null && loser.backendPid !== null,
        'P1: backend PIDs must be resolved',
      )

      // Winner completed publication and is parked at the barrier.
      await verifyAdvisoryBarrierBlocked(target, winner.backendPid)

      // Loser (V3): starts while winner holds S; must block on S.
      loser.child.stdin.end(loserSessionSql(v3CallSql(fixture)))
      await verifySAdvisoryBlocked(target, loser.backendPid, fixture.storyId)

      // Release the barrier → winner commits → loser proceeds and is fenced.
      barrier.child.stdin.end('select pg_advisory_unlock(120799);')
      await waitForRaceSuccess(barrier)
      await Promise.all([waitForRaceSuccess(winner), waitForRaceSuccess(loser)])

      // Winner effects.
      const jobStatus = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(jobStatus === 'SUCCEEDED', `P1: winner job SUCCEEDED (got: ${jobStatus})`)

      assertSinglePublication(target, fixture, 'v5', winner, loser)
      console.log('  ✓ Property 1: worker lease → V5 wins → job SUCCEEDED, V3 fenced (PUBLICATION_CONFLICT), one publication')
    }

    // ─── Property 2: SYNC-owned lease → V3 (sync) wins; V5 (worker) fenced,
    // job still RUNNING ───
    // Mirror of P1 with swapped lease ownership. V3's publication never
    // touches the job row, so the fenced V5 job must remain RUNNING — V5 is
    // fenced at its L-phase recheck by the missing job/claim binding.
    {
      const fixture = insertFixture(target, 'v3-wins', storyIds, 'sync')

      const barrier = startRacePsql(target, 'v3w-barrier', {})
      sessions.push(barrier)
      await waitForRaceSession(barrier)
      barrier.child.stdin.write(`
        select pg_advisory_lock(120799);
        select 'BARRIER_HELD';
      `)
      await waitForRaceToken(barrier, 'BARRIER_HELD')

      const winner = startRacePsql(target, 'v3w-winner', {})
      sessions.push(winner)
      await waitForRaceSession(winner)

      const loser = startRacePsql(target, 'v3w-loser', {})
      sessions.push(loser)
      await waitForRaceSession(loser)

      // Winner (V3): publish, then block at the barrier inside the same txn.
      winner.child.stdin.end(`
        begin;
        set local statement_timeout = '30s';
        set local lock_timeout = '0';
        ${v3CallSql(fixture)}
        select pg_advisory_xact_lock(120799);
        commit;
      `)

      check(
        barrier.backendPid !== null && winner.backendPid !== null && loser.backendPid !== null,
        'P2: backend PIDs must be resolved',
      )

      await verifyAdvisoryBarrierBlocked(target, winner.backendPid)

      // Loser (V5): starts while winner holds S; must block on S.
      loser.child.stdin.end(loserSessionSql(v5CallSql(fixture)))
      await verifySAdvisoryBlocked(target, loser.backendPid, fixture.storyId)

      barrier.child.stdin.end('select pg_advisory_unlock(120799);')
      await waitForRaceSuccess(barrier)
      await Promise.all([waitForRaceSuccess(winner), waitForRaceSuccess(loser)])

      // V3 never touches the job: fenced V5 job must still be RUNNING.
      const jobStatus = execLocalPsql(target, `
        select status from public.generation_jobs where id = '${fixture.jobId}';
      `).trim()
      check(jobStatus === 'RUNNING', `P2: fenced job still RUNNING (got: ${jobStatus})`)

      assertSinglePublication(target, fixture, 'v3', winner, loser)
      console.log('  ✓ Property 2: sync lease → V3 wins → job stays RUNNING, V5 fenced (PUBLICATION_CONFLICT via ledger replay), one publication')
    }

    console.log(`\n  All ${CONTEXT} properties verified.`)
  } catch (error) {
    console.error('Race execution error: dumping session outputs:')
    for (const s of sessions) {
      if (s.stdout) console.log(`[SESSION ${s.applicationName} STDOUT]:`, s.stdout)
      if (s.stderr) console.error(`[SESSION ${s.applicationName} STDERR]:`, s.stderr)
    }
    throw error
  } finally {
    try {
      cleanupTarget(target, storyIds)
    } catch (cleanupError) {
      console.error('Cleanup warning (non-fatal):', (cleanupError as Error).message)
    }
    await cleanupRaceResources(target, sessions, storyIds, [])
  }
}

runRaceTests().catch((error) => {
  console.error(`${CONTEXT} FAILED:`, error)
  process.exit(1)
})
