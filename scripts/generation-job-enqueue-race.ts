import {
  checkRace,
  cleanupRaceResources,
  cleanupRaceSessions,
  execLocalPsql,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  verifyLocalRaceTarget,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'

const CONTEXT = 'generation job enqueue race'
const ITERATIONS = 3

type RunningPsql = RunningRacePsql

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function enqueueSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', :'owner_id', true);
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'ENQUEUE_RESULT|${side}|' || public.enqueue_generation_job_v1(
  :'story_id', :'chapter_number'::integer, 'standard', :'trigger_choice_id'
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function parseResult(running: RunningPsql, side: 'A' | 'B'): {
  jobId: string
  correlationId: string
  status: string
} {
  const prefix = `ENQUEUE_RESULT|${side}|`
  const line = running.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix))
  check(line, `contender ${side} result unavailable`)

  const parsed = JSON.parse(line.slice(prefix.length)) as Record<string, unknown>
  check(parsed.alreadyComplete === false, `contender ${side} must enqueue active work`)
  check(typeof parsed.jobId === 'string', `contender ${side} jobId unavailable`)
  check(typeof parsed.correlationId === 'string', `contender ${side} correlationId unavailable`)
  check(parsed.status === 'QUEUED', `contender ${side} must return QUEUED`)
  return {
    jobId: parsed.jobId,
    correlationId: parsed.correlationId,
    status: parsed.status,
  }
}

async function releaseRaceBarrier(
  target: RaceTarget,
  variables: Record<string, string>,
): Promise<[RunningPsql, RunningPsql]> {
  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder', { barrier: variables.barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(
      `begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`,
    )
    await waitForRaceToken(holder, 'BARRIER_READY')

    const contenderA = startRacePsql(target, 'contender-a', variables)
    const contenderB = startRacePsql(target, 'contender-b', variables)
    sessions.push(contenderA, contenderB)
    await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
    contenderA.child.stdin.end(enqueueSql('A'))
    contenderB.child.stdin.end(enqueueSql('B'))
    await Promise.all([
      waitForRaceToken(contenderA, 'CONTENDER_READY|A'),
      waitForRaceToken(contenderB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)
    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(contenderA),
      waitForRaceSuccess(contenderB),
    ])
    return [contenderA, contenderB]
  } finally {
    await cleanupRaceSessions(target, sessions)
  }
}

async function runIteration(
  target: RaceTarget,
  iteration: number,
  ownerId: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:generation-enqueue-race:${crypto.randomUUID()}`
  const triggerChoiceId = `Choice:Opaque/Race_${iteration}`
  const chapterNumber = 10 + iteration
  const barrier = String(
    (parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration,
  )
  storyIds.push(storyId)

  execLocalPsql(
    target,
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode)
     values (:'story_id', 'Generation enqueue race fixture', :'owner_id'::uuid, 'private', 'standard');`,
    { story_id: storyId, owner_id: ownerId },
  )

  const variables = {
    story_id: storyId,
    owner_id: ownerId,
    chapter_number: String(chapterNumber),
    trigger_choice_id: triggerChoiceId,
    barrier,
  }
  const [contenderA, contenderB] = await releaseRaceBarrier(target, variables)
  const resultA = parseResult(contenderA, 'A')
  const resultB = parseResult(contenderB, 'B')

  check(resultA.jobId === resultB.jobId, 'duplicate contenders must return same jobId')
  check(
    resultA.correlationId === resultB.correlationId,
    'duplicate contenders must return same correlationId',
  )

  const snapshot = execLocalPsql(
    target,
    `select concat_ws('|',
       count(*),
       count(*) filter (where status in ('QUEUED','RUNNING','RETRY_WAIT')),
       (array_agg(id order by id))[1]::text,
       (array_agg(correlation_id order by correlation_id))[1]::text,
       (array_agg(user_id order by user_id))[1]::text,
       min(generation_kind),
       min(trigger_choice_id),
       min(publication_idempotency_key)
     )
     from public.generation_jobs
     where story_id = :'story_id' and chapter_number = :'chapter_number'::integer;`,
    { story_id: storyId, chapter_number: String(chapterNumber) },
  ).trim()
  const expected = [
    '1',
    '1',
    resultA.jobId,
    resultA.correlationId,
    ownerId,
    'standard',
    triggerChoiceId,
    `generation-job:${resultA.jobId}:publish:${chapterNumber}`,
  ].join('|')
  check(snapshot === expected, 'race must leave one exact compatible active row')
}

async function main() {
  const target = verifyLocalRaceTarget(CONTEXT)
  const ownerId = crypto.randomUUID()
  const storyIds: string[] = []
  const userIds: string[] = []
  const sessions: RunningPsql[] = []

  try {
    execLocalPsql(
      target,
      `insert into auth.users (
         id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) values (
         :'owner_id'::uuid, 'authenticated', 'authenticated', :'email', '', clock_timestamp(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
         clock_timestamp(), clock_timestamp()
       );`,
      {
        owner_id: ownerId,
        email: `generation-enqueue-race-${ownerId}@example.invalid`,
      },
    )
    userIds.push(ownerId)

    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await runIteration(target, iteration, ownerId, storyIds)
    }

    console.log(`Generation job enqueue duplicate races: ${ITERATIONS}/${ITERATIONS} PASS`)
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, userIds)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'generation job enqueue race failed')
  process.exitCode = 1
})
