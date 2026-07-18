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

const CONTEXT = 'generation job claim race'
const ITERATIONS = 3

type Side = 'A' | 'B'
type ClaimResult = { claimed: boolean; job?: { id?: string; attempt_count?: number; claim_token?: string } }

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function claimSql(side: Side): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'CLAIM_RESULT|${side}|' || public.claim_generation_job_v1(:'worker_id')::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function parseClaim(running: RunningRacePsql, side: Side): ClaimResult {
  const prefix = `CLAIM_RESULT|${side}|`
  const line = running.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix))
  check(line, `contender ${side} result unavailable`)
  return JSON.parse(line.slice(prefix.length)) as ClaimResult
}

async function waitForContenderOverlap(
  target: RaceTarget,
  contenderA: RunningRacePsql,
  contenderB: RunningRacePsql,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const overlap = execLocalPsql(
      target,
      `select count(*)
       from pg_stat_activity
       where pid in (:'contender_a_pid'::integer, :'contender_b_pid'::integer)
         and state = 'active'
         and wait_event_type = 'Lock'
         and wait_event = 'advisory';`,
      {
        contender_a_pid: String(contenderA.backendPid),
        contender_b_pid: String(contenderB.backendPid),
      },
    ).trim()
    if (overlap === '2') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check(false, 'both contender backends must be active and blocked before release')
}

async function claimConcurrently(
  target: RaceTarget,
  variablesA: Record<string, string>,
  variablesB: Record<string, string>,
  sessions: RunningRacePsql[],
): Promise<[ClaimResult, ClaimResult]> {
  const holder = startRacePsql(target, 'holder', { barrier: variablesA.barrier })
  sessions.push(holder)
  await waitForRaceSession(holder)
  holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
  await waitForRaceToken(holder, 'BARRIER_READY')

  const contenderA = startRacePsql(target, 'contender-a', variablesA)
  const contenderB = startRacePsql(target, 'contender-b', variablesB)
  sessions.push(contenderA, contenderB)
  await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
  contenderA.child.stdin.end(claimSql('A'))
  contenderB.child.stdin.end(claimSql('B'))
  await Promise.all([
    waitForRaceToken(contenderA, 'CONTENDER_READY|A'),
    waitForRaceToken(contenderB, 'CONTENDER_READY|B'),
  ])

  await waitForContenderOverlap(target, contenderA, contenderB)

  holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)
  await Promise.all([
    waitForRaceSuccess(holder),
    waitForRaceSuccess(contenderA),
    waitForRaceSuccess(contenderB),
  ])
  return [parseClaim(contenderA, 'A'), parseClaim(contenderB, 'B')]
}

function insertJob(
  target: RaceTarget,
  storyId: string,
  userId: string,
  chapterNumber: number,
): string {
  const jobId = crypto.randomUUID()
  execLocalPsql(
    target,
    `insert into public.generation_jobs (
       id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
       status, max_attempts, available_at, deadline_at, publication_idempotency_key
     ) values (
       :'job_id'::uuid, :'story_id', :'chapter_number'::integer, :'user_id'::uuid,
       'standard', :'trigger_choice_id', 'QUEUED', 4,
       clock_timestamp() - interval '1 second', clock_timestamp() + interval '20 minutes',
       'generation-job:' || :'job_id' || ':publish:' || :'chapter_number'
     );`,
    {
      job_id: jobId,
      story_id: storyId,
      chapter_number: String(chapterNumber),
      user_id: userId,
      trigger_choice_id: `race-choice:${chapterNumber}`,
    },
  )
  return jobId
}

function assertClaimShape(result: ClaimResult, label: string): asserts result is Required<ClaimResult> {
  check(result.claimed === true, `${label} must claim work`)
  check(typeof result.job?.id === 'string', `${label} job ID unavailable`)
  check(result.job.attempt_count === 1, `${label} attempt count must increment once`)
  check(typeof result.job.claim_token === 'string', `${label} claim token unavailable`)
}

async function runIteration(
  target: RaceTarget,
  iteration: number,
  userId: string,
  storyIds: string[],
  sessions: RunningRacePsql[],
): Promise<void> {
  const storyOne = `test:generation-claim-one:${crypto.randomUUID()}`
  const storyTwo = `test:generation-claim-two:${crypto.randomUUID()}`
  storyIds.push(storyOne, storyTwo)
  execLocalPsql(
    target,
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode)
     values
       (:'story_one', 'Generation claim one fixture', :'user_id'::uuid, 'private', 'standard'),
       (:'story_two', 'Generation claim two fixture', :'user_id'::uuid, 'private', 'standard');`,
    { story_one: storyOne, story_two: storyTwo, user_id: userId },
  )

  const oneJobId = insertJob(target, storyOne, userId, 10 + iteration)
  const barrierOne = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration)
  const [oneA, oneB] = await claimConcurrently(
    target,
    { barrier: barrierOne, worker_id: `worker-one-a-${iteration}` },
    { barrier: barrierOne, worker_id: `worker-one-b-${iteration}` },
    sessions,
  )
  const oneClaims = [oneA, oneB].filter((result) => result.claimed)
  check(oneClaims.length === 1, 'one available job must be claimed once')
  assertClaimShape(oneClaims[0], 'single winner')
  check(oneClaims[0].job.id === oneJobId, 'single winner must claim exact job')
  check([oneA, oneB].filter((result) => !result.claimed).length === 1, 'single loser must receive claimed false')

  const oneSnapshot = execLocalPsql(
    target,
    `select concat_ws('|', status, attempt_count, count(*) over ())
     from public.generation_jobs where id = :'job_id'::uuid;`,
    { job_id: oneJobId },
  ).trim()
  check(oneSnapshot === 'RUNNING|1|1', 'single-job race must leave one row with one attempt')

  const firstTwoJobId = insertJob(target, storyTwo, userId, 20 + iteration * 2)
  const secondTwoJobId = insertJob(target, storyTwo, userId, 21 + iteration * 2)
  const barrierTwo = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration + 100)
  const [twoA, twoB] = await claimConcurrently(
    target,
    { barrier: barrierTwo, worker_id: `worker-two-a-${iteration}` },
    { barrier: barrierTwo, worker_id: `worker-two-b-${iteration}` },
    sessions,
  )
  assertClaimShape(twoA, 'two-job contender A')
  assertClaimShape(twoB, 'two-job contender B')
  check(twoA.job.id !== twoB.job.id, 'two available jobs must yield distinct claims')
  check(
    new Set([twoA.job.id, twoB.job.id]).size === 2
      && [twoA.job.id, twoB.job.id].every((id) => id === firstTwoJobId || id === secondTwoJobId),
    'two contenders must claim exact available fixtures',
  )

  const twoSnapshot = execLocalPsql(
    target,
    `select concat_ws('|', count(*), count(*) filter (where status = 'RUNNING'), sum(attempt_count), count(distinct claim_token))
     from public.generation_jobs where id in (:'first_job_id'::uuid, :'second_job_id'::uuid);`,
    { first_job_id: firstTwoJobId, second_job_id: secondTwoJobId },
  ).trim()
  check(twoSnapshot === '2|2|2|2', 'two-job race must leave distinct owners and one attempt each')
}

async function main(): Promise<void> {
  const target = verifyLocalRaceTarget(CONTEXT)
  const userId = crypto.randomUUID()
  const storyIds: string[] = []
  const userIds = [userId]
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
      { user_id: userId, email: `generation-claim-race-${userId}@example.invalid` },
    )

    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await runIteration(target, iteration, userId, storyIds, sessions)
    }
    console.log(`Generation job claim races: ${ITERATIONS}/${ITERATIONS} PASS`)
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, userIds)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'generation job claim race failed')
  process.exitCode = 1
})
