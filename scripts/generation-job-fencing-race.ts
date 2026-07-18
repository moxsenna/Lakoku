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

const CONTEXT = 'generation job fencing race'
const ITERATIONS = Number(process.env.GENERATION_JOB_FENCING_RACE_ITERATIONS ?? '3')
const CHAPTER_NUMBER = 2

const CHOICES = JSON.stringify([
  { id: 'open-door', label: 'Buka pintu gudang', hint: 'Sari menunggu dekat gudang' },
  { id: 'stop-guard', label: 'Hadang penjaga gudang' },
])
const EFFECT = {
  routeDeltas: {},
  trustDeltas: {},
  flagsSet: {},
  evidenceAdded: [],
  endingBiasDeltas: {},
  threadTouches: [],
}
const OUTCOMES = JSON.stringify([
  {
    choiceId: 'open-door',
    consequence: ['Raka membuka pintu gudang.'],
    nextChapterNumber: 3,
    isEnding: false,
    effect_json: EFFECT,
    choice_kind: 'normal',
  },
  {
    choiceId: 'stop-guard',
    consequence: ['Raka menghadang penjaga gudang.'],
    nextChapterNumber: 3,
    isEnding: false,
    effect_json: EFFECT,
    choice_kind: 'normal',
  },
])

type Fixture = {
  storyId: string
  jobId: string
  claimToken: string
  leaseId: string
  workerId: string
  publicationKey: string
}

type RecoveryResult = { recovered_count: number }
type PublicationResult = { ok: boolean; chapter_number: number; seq: number; jobId: string }
type Snapshot = {
  status: string
  publication_result: PublicationResult | null
  worker_id: string | null
  claim_token: string | null
  lease_status: string
  chapter_count: number
  event_count: number
  outbox_count: number
  idempotency_count: number
  success_count: number
  interrupted_count: number
}

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function parseJsonLine<T>(running: RunningRacePsql, prefix: string): T {
  const line = running.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix))
  check(line, `${prefix} result unavailable (${running.stdout})`)
  return JSON.parse(line.slice(prefix.length)) as T
}

function parsePsqlJson<T>(value: string, label: string): T {
  const line = value.trim().split(/\r?\n/).find((candidate) => candidate.startsWith('{'))
  check(line, `${label} result unavailable`)
  return JSON.parse(line) as T
}

function insertFixture(
  target: RaceTarget,
  userId: string,
  storyIds: string[],
  label: string,
): Fixture {
  const storyId = `test:generation-fencing-race:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const claimToken = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  const workerId = `fencing-race:${label}`
  const publicationKey = `generation-job:${jobId}:publish:${CHAPTER_NUMBER}`
  storyIds.push(storyId)

  execLocalPsql(
    target,
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode)
     values (:'story_id', 'Generation fencing race fixture', :'user_id'::uuid, 'private', 'standard');
     insert into public.generation_jobs (
       id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
       status, max_attempts, available_at, deadline_at, publication_idempotency_key
     ) values (
       :'job_id'::uuid, :'story_id', :'chapter_number'::integer, :'user_id'::uuid,
       'standard', :'trigger_choice_id', 'QUEUED', 4,
       clock_timestamp() - interval '10 minutes', clock_timestamp() + interval '20 minutes',
       :'publication_key'
     );
     update public.generation_jobs
     set status = 'RUNNING', attempt_count = 1, worker_id = :'worker_id',
         claim_token = :'claim_token'::uuid,
         claimed_at = clock_timestamp() - interval '80 seconds',
         heartbeat_at = clock_timestamp() - interval '76 seconds'
     where id = :'job_id'::uuid;
     insert into public.generation_leases (
       id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
     ) values (
       :'lease_id'::uuid, :'story_id', :'chapter_number'::integer, 'ACTIVE', :'worker_id',
       clock_timestamp() - interval '1 second', :'job_id'::uuid, :'claim_token'::uuid
     );`,
    {
      story_id: storyId,
      user_id: userId,
      job_id: jobId,
      chapter_number: String(CHAPTER_NUMBER),
      trigger_choice_id: `choice:${label}`,
      publication_key: publicationKey,
      worker_id: workerId,
      claim_token: claimToken,
      lease_id: leaseId,
    },
  )

  return { storyId, jobId, claimToken, leaseId, workerId, publicationKey }
}

function makeWrapperLeasePublishable(target: RaceTarget, fixture: Fixture): void {
  execLocalPsql(
    target,
    `update public.generation_leases
     set expires_at = clock_timestamp() + interval '10 minutes'
     where id = :'lease_id'::uuid;`,
    { lease_id: fixture.leaseId },
  )
}

function raceVariables(fixture: Fixture): Record<string, string> {
  return {
    story_id: fixture.storyId,
    job_id: fixture.jobId,
    claim_token: fixture.claimToken,
    lease_id: fixture.leaseId,
    worker_id: fixture.workerId,
    chapter_number: String(CHAPTER_NUMBER),
    choices: CHOICES,
    outcomes: OUTCOMES,
  }
}

function wrapperCallSql(prefix: string): string {
  return `select '${prefix}' || public.publish_generation_job_chapter_v2(
    :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid,
    :'story_id', :'chapter_number'::integer, 'Bab Race',
    '["Raka berdiri di depan pintu gudang."]'::jsonb,
    'Apa yang Raka lakukan sekarang?', :'choices'::jsonb, :'outcomes'::jsonb
  )::text;`
}

function recoverOnce(target: RaceTarget): RecoveryResult {
  return parsePsqlJson<RecoveryResult>(
    execLocalPsql(
      target,
      `begin;
       set local role service_role;
       select public.recover_stale_generation_jobs_v1(100)::text;
       commit;`,
    ),
    'follow-up recovery',
  )
}

async function waitForBackendState(
  target: RaceTarget,
  running: RunningRacePsql,
  predicate: string,
  message: string,
): Promise<void> {
  check(running.backendPid !== null, 'backend PID unavailable')
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const count = execLocalPsql(
      target,
      `select count(*) from pg_stat_activity
       where pid = :'pid'::integer and application_name = :'application_name' and (${predicate});`,
      { pid: String(running.backendPid), application_name: running.applicationName },
    ).trim()
    if (count === '1') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check(false, message)
}

async function waitForJobRowLock(target: RaceTarget, running: RunningRacePsql): Promise<void> {
  check(running.backendPid !== null, 'backend PID unavailable')
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const count = execLocalPsql(
      target,
      `select count(*)
       from pg_locks waiting
       join pg_locks holding
         on holding.locktype = waiting.locktype
        and holding.database is not distinct from waiting.database
        and holding.relation is not distinct from waiting.relation
        and holding.page is not distinct from waiting.page
        and holding.tuple is not distinct from waiting.tuple
        and holding.transactionid is not distinct from waiting.transactionid
        and holding.classid is not distinct from waiting.classid
        and holding.objid is not distinct from waiting.objid
        and holding.objsubid is not distinct from waiting.objsubid
        and holding.pid <> waiting.pid
       where waiting.pid = :'pid'::integer
         and not waiting.granted
         and holding.granted
         and waiting.locktype in ('tuple', 'transactionid');`,
      { pid: String(running.backendPid) },
    ).trim()
    if (Number(count) >= 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check(false, 'contender must visibly wait on held job row lock')
}

function readSnapshot(target: RaceTarget, fixture: Fixture): Snapshot {
  return parsePsqlJson<Snapshot>(
    execLocalPsql(
      target,
      `select jsonb_build_object(
         'status', j.status,
         'publication_result', j.publication_result,
         'worker_id', j.worker_id,
         'claim_token', j.claim_token,
         'lease_status', l.status,
         'chapter_count', (select count(*) from public.chapters c where c.story_id = j.story_id and c.number = j.chapter_number),
         'event_count', (select count(*) from public.story_events e where e.story_id = j.story_id and e.type = 'CHAPTER_PUBLISHED'),
         'outbox_count', (select count(*) from public.outbox o where o.payload @> jsonb_build_object('story_id', j.story_id, 'chapter_number', j.chapter_number)),
         'idempotency_count', (select count(*) from public.idempotency_keys i where i.key = j.publication_idempotency_key),
         'success_count', (select count(*) from public.generation_job_attempts a where a.job_id = j.id and a.workflow_phase = 'PUBLICATION_SUCCEEDED'),
         'interrupted_count', (select count(*) from public.generation_job_attempts a where a.job_id = j.id and a.workflow_phase = 'WORKER_ATTEMPT_INTERRUPTED')
       )::text
       from public.generation_jobs j
       join public.generation_leases l on l.id = :'lease_id'::uuid
       where j.id = :'job_id'::uuid;`,
      { job_id: fixture.jobId, lease_id: fixture.leaseId },
    ),
    'final snapshot',
  )
}

function assertWrapperFirstSnapshot(snapshot: Snapshot, result: PublicationResult, fixture: Fixture): void {
  check(snapshot.status === 'SUCCEEDED', 'wrapper-first job must be SUCCEEDED')
  check(JSON.stringify(snapshot.publication_result) === JSON.stringify(result), 'job must store exact wrapper result')
  check(result.ok === true && result.chapter_number === CHAPTER_NUMBER && result.jobId === fixture.jobId, 'wrapper must return exact successful v2 result')
  check(snapshot.worker_id === null && snapshot.claim_token === null, 'successful job must clear ownership')
  check(snapshot.lease_status === 'RELEASED', 'wrapper-first lease must release')
  check(snapshot.chapter_count === 1, 'wrapper-first must publish one chapter')
  check(snapshot.event_count === 1, 'wrapper-first must publish one relevant event')
  check(snapshot.outbox_count === 1, 'wrapper-first must publish one relevant outbox row')
  check(snapshot.idempotency_count === 1, 'wrapper-first must publish one relevant idempotency row')
  check(snapshot.success_count === 1, 'wrapper-first must write one success telemetry row')
  check(snapshot.interrupted_count === 0, 'wrapper-first must not write interrupted duplicate')
}

function assertRecoveryFirstSnapshot(snapshot: Snapshot): void {
  check(snapshot.status === 'RETRY_WAIT', 'recovery-first job must enter legal retry state')
  check(snapshot.publication_result === null, 'recovery-first must not store publication result')
  check(snapshot.worker_id === null && snapshot.claim_token === null, 'recovery-first must clear old ownership')
  check(snapshot.lease_status !== 'ACTIVE', 'recovery-first old lease must not remain ACTIVE')
  check(snapshot.chapter_count === 0, 'stale wrapper must publish no chapter')
  check(snapshot.event_count === 0, 'stale wrapper must publish no event')
  check(snapshot.outbox_count === 0, 'stale wrapper must publish no outbox row')
  check(snapshot.idempotency_count === 0, 'stale wrapper must publish no idempotency row')
  check(snapshot.success_count === 0, 'stale wrapper must publish no success telemetry')
  check(snapshot.interrupted_count === 1, 'recovery-first must write one interrupted attempt')
}

async function runWrapperFirst(
  target: RaceTarget,
  iteration: number,
  userId: string,
  storyIds: string[],
  sessions: RunningRacePsql[],
): Promise<void> {
  const fixture = insertFixture(target, userId, storyIds, `wrapper-first-${iteration}`)
  makeWrapperLeasePublishable(target, fixture)
  const variables = raceVariables(fixture)

  const wrapper = startRacePsql(target, `wrapper-first-${iteration}`, variables)
  sessions.push(wrapper)
  await waitForRaceSession(wrapper)
  wrapper.child.stdin.write(`
    begin;
    set local role service_role;
    ${wrapperCallSql('WRAPPER_RESULT|')}
    select 'WRAPPER_LOCK_HELD';
  `)
  await waitForRaceToken(wrapper, 'WRAPPER_LOCK_HELD')
  await waitForBackendState(target, wrapper, "state = 'idle in transaction'", 'wrapper must hold job lock before recovery starts')

  const recovery = startRacePsql(target, `recovery-after-wrapper-${iteration}`, variables)
  sessions.push(recovery)
  await waitForRaceSession(recovery)
  recovery.child.stdin.end(`
    begin;
    set local role service_role;
    select 'RECOVERY_RESULT|' || public.recover_stale_generation_jobs_v1(100)::text;
    commit;
  `)
  await waitForRaceSuccess(recovery)
  await waitForBackendState(target, wrapper, "state = 'idle in transaction'", 'wrapper transaction must remain open until skipped recovery completes')

  const recoveryResult = parseJsonLine<RecoveryResult>(recovery, 'RECOVERY_RESULT|')
  check(recoveryResult.recovered_count === 0, 'recovery must SKIP LOCKED in-flight wrapper job')

  wrapper.child.stdin.end('commit;\n')
  await waitForRaceSuccess(wrapper)
  const secondRecoveryResult = recoverOnce(target)
  check(secondRecoveryResult.recovered_count === 0, 'recovery after wrapper commit must leave SUCCEEDED job untouched')

  const wrapperResult = parseJsonLine<PublicationResult>(wrapper, 'WRAPPER_RESULT|')
  assertWrapperFirstSnapshot(readSnapshot(target, fixture), wrapperResult, fixture)
}

async function runRecoveryFirst(
  target: RaceTarget,
  iteration: number,
  userId: string,
  storyIds: string[],
  sessions: RunningRacePsql[],
): Promise<void> {
  const fixture = insertFixture(target, userId, storyIds, `recovery-first-${iteration}`)
  const variables = raceVariables(fixture)

  const recovery = startRacePsql(target, `recovery-first-${iteration}`, variables)
  sessions.push(recovery)
  await waitForRaceSession(recovery)
  recovery.child.stdin.write(`
    begin;
    set local role service_role;
    select 'RECOVERY_RESULT|' || public.recover_stale_generation_jobs_v1(100)::text;
    select 'RECOVERY_LOCK_HELD';
  `)
  await waitForRaceToken(recovery, 'RECOVERY_LOCK_HELD')
  const recoveryResult = parseJsonLine<RecoveryResult>(recovery, 'RECOVERY_RESULT|')
  check(recoveryResult.recovered_count === 1, 'recovery-first contender must transition exact stale job')
  await waitForBackendState(target, recovery, "state = 'idle in transaction'", 'recovery must retain exact job row lock')

  const staleWrapper = startRacePsql(target, `stale-wrapper-${iteration}`, variables)
  sessions.push(staleWrapper)
  await waitForRaceSession(staleWrapper)
  staleWrapper.child.stdin.end(`
    create function pg_temp.call_stale_wrapper(
      p_job_id uuid, p_worker_id text, p_claim_token uuid, p_lease_id uuid,
      p_story_id text, p_chapter_number integer, p_choices jsonb, p_outcomes jsonb
    ) returns text language plpgsql as $stale$
    begin
      perform public.publish_generation_job_chapter_v2(
        p_job_id, p_worker_id, p_claim_token, p_lease_id,
        p_story_id, p_chapter_number, 'Bab Race',
        '["Raka berdiri di depan pintu gudang."]'::jsonb,
        'Apa yang Raka lakukan sekarang?', p_choices, p_outcomes
      );
      return 'STALE_WRAPPER_UNEXPECTEDLY_PUBLISHED';
    exception
      when sqlstate 'P0001' then return sqlerrm;
    end
    $stale$;
    begin;
    set local role service_role;
    select 'STALE_WRAPPER_READY';
    select 'STALE_WRAPPER_RESULT|' || pg_temp.call_stale_wrapper(
      :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid,
      :'story_id', :'chapter_number'::integer, :'choices'::jsonb, :'outcomes'::jsonb
    );
    commit;
  `)
  await waitForRaceToken(staleWrapper, 'STALE_WRAPPER_READY')
  await waitForJobRowLock(target, staleWrapper)

  recovery.child.stdin.end('commit;\n')
  await Promise.all([waitForRaceSuccess(recovery), waitForRaceSuccess(staleWrapper)])
  const staleWrapperResult = staleWrapper.stdout.split(/\r?\n/).find((line) => line.startsWith('STALE_WRAPPER_RESULT|'))
  check(
    staleWrapperResult === 'STALE_WRAPPER_RESULT|GENERATION_JOB_NOT_RUNNING'
      || staleWrapperResult === 'STALE_WRAPPER_RESULT|GENERATION_JOB_OWNERSHIP_LOST',
    `stale wrapper must return exact ownership error (${staleWrapper.stdout})`,
  )
  assertRecoveryFirstSnapshot(readSnapshot(target, fixture))
}

async function main(): Promise<void> {
  check(Number.isInteger(ITERATIONS) && ITERATIONS >= 1 && ITERATIONS <= 20, 'iteration count must be 1..20')
  const target = verifyLocalRaceTarget(CONTEXT)
  const userId = crypto.randomUUID()
  const storyIds: string[] = []
  const sessions: RunningRacePsql[] = []

  try {
    execLocalPsql(
      target,
      `insert into auth.users (
         id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) values (
         :'user_id'::uuid, 'authenticated', 'authenticated', :'email', '', clock_timestamp(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
         clock_timestamp(), clock_timestamp()
       );`,
      { user_id: userId, email: `generation-fencing-race-${userId}@example.invalid` },
    )

    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await runWrapperFirst(target, iteration, userId, storyIds, sessions)
      await runRecoveryFirst(target, iteration, userId, storyIds, sessions)
    }
    console.log(`Generation job fencing races: ${ITERATIONS}/${ITERATIONS} iterations, 2 scenarios each PASS`)
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, [userId])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'generation job fencing race failed')
  process.exitCode = 1
})
