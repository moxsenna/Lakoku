import {
  checkRace,
  cleanupFixtureRows,
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

const ITERATIONS = 3
const CONTEXT = 'authoring claim race'
type RunningPsql = RunningRacePsql

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function claimSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'CLAIM_RESULT|${side}|' || public.claim_authoring_story_shell_v1(
  :'story_id', :'owner_id'::uuid, :'title', :'cover', :'tagline', :'role', :'tropes'::jsonb, 50, :'synopsis'
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

async function raceOnce(
  target: RaceTarget,
  iteration: number,
  ownerA: string,
  ownerB: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:authoring-race-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration)
  const sessions: RunningPsql[] = []

  try {
    const holder = startRacePsql(target, `holder-${iteration}`, { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(
      `begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`,
    )
    await waitForRaceToken(holder, 'BARRIER_READY')

    const common = {
      story_id: storyId,
      barrier,
      role: 'Race protagonist',
      tropes: '["Rival authors","Atomic claim"]',
    }
    const contenderA = startRacePsql(target, `contender-a-${iteration}`, {
      ...common,
      owner_id: ownerA,
      title: `Race owner A ${iteration}`,
      cover: '/race-a.svg',
      tagline: 'Race tagline A',
      synopsis: 'Race synopsis A keeps every payload field valid while ownership decides the only winner.',
    })
    const contenderB = startRacePsql(target, `contender-b-${iteration}`, {
      ...common,
      owner_id: ownerB,
      title: `Race owner B ${iteration}`,
      cover: '/race-b.svg',
      tagline: 'Race tagline B',
      synopsis: 'Race synopsis B keeps every payload field valid while ownership decides the only winner.',
    })
    sessions.push(contenderA, contenderB)
    await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
    contenderA.child.stdin.end(claimSql('A'))
    contenderB.child.stdin.end(claimSql('B'))

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

    const resultA = contenderA.stdout.includes('CLAIM_RESULT|A|true')
    const resultB = contenderB.stdout.includes('CLAIM_RESULT|B|true')
    check(Number(resultA) + Number(resultB) === 1, 'race must produce exactly one winner')

    const winnerId = resultA ? ownerA : ownerB
    const loserId = resultA ? ownerB : ownerA
    const winnerTitle = resultA ? `Race owner A ${iteration}` : `Race owner B ${iteration}`
    const loserTitle = resultA ? `Race owner B ${iteration}` : `Race owner A ${iteration}`
    storyIds.push(storyId)
    const final = execLocalPsql(
      target,
      `select owner_user_id::text || '|' || title || '|' || cover || '|' || tagline
       from public.stories where id = :'story_id';`,
      { story_id: storyId },
    ).trim()
    check(final.startsWith(`${winnerId}|${winnerTitle}|`), 'final owner and metadata must match race winner')
    check(!final.includes(loserTitle), 'loser metadata must not persist')

    const transfer = execLocalPsql(
      target,
      `set role service_role;
       select public.claim_authoring_story_shell_v1(
         :'story_id', :'loser_id'::uuid, 'Transfer attempt', '/transfer.svg',
         'Transfer tagline', 'Transfer role', '["Owner transfer","Retry claim"]'::jsonb, 50,
         'Transfer synopsis remains fully valid so ownership alone must reject this losing retry.'
       )::text;
       reset role;
       select owner_user_id::text || '|' || title from public.stories where id = :'story_id';`,
      { story_id: storyId, loser_id: loserId },
    ).trim().split(/\r?\n/)
    check(transfer[0] === 'false', 'loser retry must return false')
    check(transfer[1] === `${winnerId}|${winnerTitle}`, 'loser retry must not transfer ownership or metadata')
  } finally {
    await cleanupRaceSessions(target, sessions)
  }
}

async function main() {
  const target = verifyLocalRaceTarget(CONTEXT)
  const ownerA = crypto.randomUUID()
  const ownerB = crypto.randomUUID()
  const storyIds: string[] = []
  const userIds: string[] = []

  try {
    execLocalPsql(
      target,
      `insert into auth.users (
         id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) values
         (:'owner_a'::uuid, 'authenticated', 'authenticated', :'email_a', '', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());`,
      { owner_a: ownerA, email_a: `authoring-race-a-${ownerA}@example.invalid` },
    )
    userIds.push(ownerA)
    execLocalPsql(
      target,
      `insert into auth.users (
         id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) values
         (:'owner_b'::uuid, 'authenticated', 'authenticated', :'email_b', '', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());`,
      { owner_b: ownerB, email_b: `authoring-race-b-${ownerB}@example.invalid` },
    )
    userIds.push(ownerB)
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await raceOnce(target, iteration, ownerA, ownerB, storyIds)
    }
    console.log(`Authoring story claim race: ${ITERATIONS}/${ITERATIONS} PASS`)
  } finally {
    await cleanupFixtureRows(target, storyIds, userIds)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'authoring claim race failed')
  process.exitCode = 1
})
