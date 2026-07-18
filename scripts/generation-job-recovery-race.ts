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

const CONTEXT = 'generation job recovery race'
const ITERATIONS = 3

type HeartbeatResult = { ok: boolean; reason?: string }
type RecoveryResult = { recovered_count: number }
type Scenario = 'heartbeat-win' | 'recovery-win'

type FinalSnapshot = {
  status: string
  worker_id: string | null
  claim_token: string | null
  lease_status: string
  lease_is_future: boolean
  attempt_count: number
  interrupted_attempt_count: number
}

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function parseJsonResult<T>(running: RunningRacePsql, prefix: string): T {
  const line = running.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix))
  check(line, `${prefix} result unavailable`)
  return JSON.parse(line.slice(prefix.length)) as T
}

function parsePsqlJson<T>(value: string, label: string): T {
  const line = value.trim().split(/\r?\n/).find((candidate) => candidate.startsWith('{'))
  check(line, `${label} result unavailable`)
  return JSON.parse(line) as T
}

function insertFixture(
  target: RaceTarget,
  iteration: number,
  scenario: Scenario,
  userId: string,
  storyIds: string[],
): { jobId: string; claimToken: string; leaseId: string; workerId: string } {
  const storyId = `test:generation-recovery-race:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const claimToken = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  const workerId = `recovery-race-${scenario}-${iteration}`
  storyIds.push(storyId)

  execLocalPsql(
    target,
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode)
     values (:'story_id', 'Generation recovery race fixture', :'user_id'::uuid, 'private', 'standard');
     insert into public.generation_jobs (
       id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
       status, max_attempts, available_at, deadline_at, publication_idempotency_key
     ) values (
       :'job_id'::uuid, :'story_id', 2, :'user_id'::uuid, 'standard', :'trigger_choice_id',
       'QUEUED', 4, clock_timestamp() - interval '10 minutes',
       clock_timestamp() + interval '20 minutes',
       'generation-job:' || :'job_id' || ':publish:2'
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
       :'lease_id'::uuid, :'story_id', 2, 'ACTIVE', :'worker_id',
       clock_timestamp() + interval '5 minutes', :'job_id'::uuid, :'claim_token'::uuid
     );`,
    {
      story_id: storyId,
      user_id: userId,
      job_id: jobId,
      trigger_choice_id: `recovery-race-${scenario}-${iteration}`,
      worker_id: workerId,
      claim_token: claimToken,
      lease_id: leaseId,
    },
  )

  const fixtureState = execLocalPsql(
    target,
    `select concat_ws('|',
       (j.heartbeat_at < clock_timestamp() - interval '75 seconds')::text,
       (l.expires_at > clock_timestamp())::text)
     from public.generation_jobs j
     join public.generation_leases l on l.id = :'lease_id'::uuid
     where j.id = :'job_id'::uuid;`,
    { job_id: jobId, lease_id: leaseId },
  ).trim()
  check(fixtureState === 'true|true', `${scenario} fixture must start stale with future matching lease (${fixtureState})`)

  return { jobId, claimToken, leaseId, workerId }
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

function readFinalSnapshot(target: RaceTarget, jobId: string, leaseId: string): FinalSnapshot {
  return parsePsqlJson<FinalSnapshot>(
    execLocalPsql(
      target,
      `select pg_catalog.jsonb_build_object(
         'status', j.status,
         'worker_id', j.worker_id,
         'claim_token', j.claim_token,
         'lease_status', l.status,
         'lease_is_future', l.expires_at > clock_timestamp(),
         'attempt_count', (select count(*) from public.generation_job_attempts a where a.job_id = j.id),
         'interrupted_attempt_count', (
           select count(*) from public.generation_job_attempts a
           where a.job_id = j.id
             and a.workflow_phase = 'WORKER_ATTEMPT_INTERRUPTED'
             and a.error_code = 'WORKER_ATTEMPT_INTERRUPTED'
         )
       )::text
       from public.generation_jobs j
       join public.generation_leases l on l.id = :'lease_id'::uuid
       where j.id = :'job_id'::uuid;`,
      { job_id: jobId, lease_id: leaseId },
    ),
    'final snapshot',
  )
}

async function runHeartbeatWin(
  target: RaceTarget,
  fixture: ReturnType<typeof insertFixture>,
  iteration: number,
  sessions: RunningRacePsql[],
): Promise<void> {
  const heartbeat = startRacePsql(target, `heartbeat-win-heartbeat-${iteration}`, {
    job_id: fixture.jobId,
    worker_id: fixture.workerId,
    claim_token: fixture.claimToken,
    lease_id: fixture.leaseId,
  })
  sessions.push(heartbeat)
  await waitForRaceSession(heartbeat)
  heartbeat.child.stdin.write(`
    begin;
    set local role service_role;
    select 'HEARTBEAT_RESULT|' || public.heartbeat_generation_job_v1(
      :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid, 180
    )::text;
    select 'HEARTBEAT_LOCK_HELD';
  `)
  await waitForRaceToken(heartbeat, 'HEARTBEAT_LOCK_HELD')

  const recovery = startRacePsql(target, `heartbeat-win-recovery-${iteration}`, {})
  sessions.push(recovery)
  await waitForRaceSession(recovery)
  recovery.child.stdin.end(`
    begin;
    set local role service_role;
    select 'RECOVERY_RESULT|' || public.recover_stale_generation_jobs_v1(100)::text;
    commit;
  `)
  await waitForRaceSuccess(recovery)

  const heartbeatResult = parseJsonResult<HeartbeatResult>(heartbeat, 'HEARTBEAT_RESULT|')
  const recoveryResult = parseJsonResult<RecoveryResult>(recovery, 'RECOVERY_RESULT|')
  check(heartbeatResult.ok === true, `heartbeat winner must refresh ownership (${JSON.stringify(heartbeatResult)})`)
  check(recoveryResult.recovered_count === 0, 'recovery must SKIP LOCKED heartbeat-owned row')

  heartbeat.child.stdin.end('commit;\n')
  await waitForRaceSuccess(heartbeat)
  check(recoverOnce(target).recovered_count === 0, 'post-heartbeat recovery must leave fresh owner untouched')

  const snapshot = readFinalSnapshot(target, fixture.jobId, fixture.leaseId)
  check(snapshot.status === 'RUNNING', 'heartbeat winner must remain RUNNING')
  check(snapshot.worker_id === fixture.workerId && snapshot.claim_token === fixture.claimToken, 'heartbeat winner must retain exact owner')
  check(snapshot.lease_status === 'ACTIVE' && snapshot.lease_is_future === true, 'heartbeat winner must retain renewed active lease')
  check(snapshot.attempt_count === 0 && snapshot.interrupted_attempt_count === 0, 'heartbeat winner must not write interrupted attempt')
}

async function runRecoveryWin(
  target: RaceTarget,
  fixture: ReturnType<typeof insertFixture>,
  iteration: number,
  sessions: RunningRacePsql[],
): Promise<void> {
  const recovery = startRacePsql(target, `recovery-win-recovery-${iteration}`, {})
  sessions.push(recovery)
  await waitForRaceSession(recovery)
  recovery.child.stdin.write(`
    begin;
    set local role service_role;
    select 'RECOVERY_RESULT|' || public.recover_stale_generation_jobs_v1(100)::text;
    select 'RECOVERY_LOCK_HELD';
  `)
  await waitForRaceToken(recovery, 'RECOVERY_LOCK_HELD')

  const heartbeat = startRacePsql(target, `recovery-win-heartbeat-${iteration}`, {
    job_id: fixture.jobId,
    worker_id: fixture.workerId,
    claim_token: fixture.claimToken,
    lease_id: fixture.leaseId,
  })
  sessions.push(heartbeat)
  await waitForRaceSession(heartbeat)
  heartbeat.child.stdin.end(`
    begin;
    set local role service_role;
    select 'HEARTBEAT_RESULT|' || public.heartbeat_generation_job_v1(
      :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid, 180
    )::text;
    commit;
  `)

  recovery.child.stdin.end('commit;\n')
  await waitForRaceSuccess(recovery)
  await waitForRaceSuccess(heartbeat)

  const recoveryResult = parseJsonResult<RecoveryResult>(recovery, 'RECOVERY_RESULT|')
  const heartbeatResult = parseJsonResult<HeartbeatResult>(heartbeat, 'HEARTBEAT_RESULT|')
  check(recoveryResult.recovered_count === 1, 'recovery winner must recover stale row')
  check(
    heartbeatResult.ok === false && heartbeatResult.reason === 'OWNERSHIP_LOST',
    `old heartbeat must lose ownership after recovery (${JSON.stringify(heartbeatResult)})`,
  )
  check(recoverOnce(target).recovered_count === 0, 'recovery replay must be idempotent')

  const snapshot = readFinalSnapshot(target, fixture.jobId, fixture.leaseId)
  check(snapshot.status === 'RETRY_WAIT', 'recovery winner must move stale job to RETRY_WAIT')
  check(snapshot.worker_id === null && snapshot.claim_token === null, 'recovery winner must clear ownership')
  check(snapshot.lease_status === 'EXPIRED', 'recovery winner must expire matching future lease')
  check(snapshot.attempt_count === 1 && snapshot.interrupted_attempt_count === 1, 'recovery winner must write exactly one interrupted attempt')
}

async function runScenario(
  target: RaceTarget,
  iteration: number,
  scenario: Scenario,
  userId: string,
  storyIds: string[],
  sessions: RunningRacePsql[],
): Promise<void> {
  const fixture = insertFixture(target, iteration, scenario, userId, storyIds)
  if (scenario === 'heartbeat-win') {
    await runHeartbeatWin(target, fixture, iteration, sessions)
  } else {
    await runRecoveryWin(target, fixture, iteration, sessions)
  }
}

async function main(): Promise<void> {
  const target = verifyLocalRaceTarget(CONTEXT)
  const userId = crypto.randomUUID()
  const storyIds: string[] = []
  const sessions: RunningRacePsql[] = []

  try {
    execLocalPsql(target, `delete from public.stories where id like 'test:generation-recovery-race:%';`)
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
      { user_id: userId, email: `generation-recovery-race-${userId}@example.invalid` },
    )

    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await runScenario(target, iteration, 'heartbeat-win', userId, storyIds, sessions)
      await runScenario(target, iteration, 'recovery-win', userId, storyIds, sessions)
    }
    console.log(`Generation job recovery races: ${ITERATIONS}/${ITERATIONS} iterations, 2 scenarios each PASS`)
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, [userId])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'generation job recovery race failed')
  process.exitCode = 1
})
