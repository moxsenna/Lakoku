import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { assertLoopbackSupabaseUrl } from './personalized-db-safety'

const ITERATIONS = 3
const READY_TIMEOUT_MS = 10_000

type RunningPsql = {
  child: ChildProcessWithoutNullStreams
  stdout: string
  done: Promise<void>
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`authoring claim race: ${message}`)
}

function localStatus(): Record<string, unknown> {
  const output = process.platform === 'win32'
    ? execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', 'pnpm exec supabase status -o json'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
    : execFileSync(
        'pnpm',
        ['exec', 'supabase', 'status', '-o', 'json'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
  return JSON.parse(output) as Record<string, unknown>
}

function localContainer(): string {
  const status = localStatus()
  check(typeof status.API_URL === 'string', 'local Supabase API URL unavailable')
  check(typeof status.DB_URL === 'string', 'local Supabase DB URL unavailable')
  assertLoopbackSupabaseUrl(status.API_URL)
  assertLoopbackSupabaseUrl(status.DB_URL)

  const project = path.basename(process.cwd())
  check(/^[a-zA-Z0-9_-]+$/.test(project), 'unsafe local project name')
  const container = `supabase_db_${project}`
  let label = ''
  try {
    label = execFileSync(
      'docker',
      ['inspect', '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}', container],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    throw new Error('authoring claim race: local Supabase database container unavailable')
  }
  check(label === project, 'database container is not current local Supabase project')
  return container
}

function psqlArgs(container: string, variables: Record<string, string>): string[] {
  const args = [
    'exec', '-i', container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ]
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`)
  return args
}

function execPsql(
  container: string,
  sql: string,
  variables: Record<string, string> = {},
): string {
  try {
    return execFileSync('docker', psqlArgs(container, variables), {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error('authoring claim race: local PostgreSQL command failed')
  }
}

function startPsql(
  container: string,
  variables: Record<string, string>,
): RunningPsql {
  const child = spawn('docker', psqlArgs(container, variables), {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const running: RunningPsql = {
    child,
    stdout: '',
    done: Promise.resolve(),
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    running.stdout += chunk
  })
  running.done = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('authoring claim race: cannot start local PostgreSQL session')))
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error('authoring claim race: local PostgreSQL session failed'))
    })
  })
  return running
}

async function waitForToken(running: RunningPsql, token: string): Promise<void> {
  const started = Date.now()
  while (!running.stdout.includes(token)) {
    check(running.child.exitCode === null, 'PostgreSQL session exited before race barrier')
    check(Date.now() - started < READY_TIMEOUT_MS, 'PostgreSQL race barrier timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
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
  container: string,
  iteration: number,
  ownerA: string,
  ownerB: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:authoring-race-${crypto.randomUUID()}`
  storyIds.push(storyId)
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration)
  const holder = startPsql(container, { barrier })
  const contenders: RunningPsql[] = []

  try {
    holder.child.stdin.write(
      `begin;\nset local statement_timeout = '10s';\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`,
    )
    await waitForToken(holder, 'BARRIER_READY')

    const common = {
      story_id: storyId,
      barrier,
      role: 'Race protagonist',
      tropes: '["Rival authors","Atomic claim"]',
    }
    const contenderA = startPsql(container, {
      ...common,
      owner_id: ownerA,
      title: `Race owner A ${iteration}`,
      cover: '/race-a.svg',
      tagline: 'Race tagline A',
      synopsis: 'Race synopsis A keeps every payload field valid while ownership decides the only winner.',
    })
    const contenderB = startPsql(container, {
      ...common,
      owner_id: ownerB,
      title: `Race owner B ${iteration}`,
      cover: '/race-b.svg',
      tagline: 'Race tagline B',
      synopsis: 'Race synopsis B keeps every payload field valid while ownership decides the only winner.',
    })
    contenders.push(contenderA, contenderB)
    contenderA.child.stdin.end(claimSql('A'))
    contenderB.child.stdin.end(claimSql('B'))

    await Promise.all([
      waitForToken(contenderA, 'CONTENDER_READY|A'),
      waitForToken(contenderB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)
    await Promise.all([holder.done, contenderA.done, contenderB.done])

    const resultA = contenderA.stdout.includes('CLAIM_RESULT|A|true')
    const resultB = contenderB.stdout.includes('CLAIM_RESULT|B|true')
    check(Number(resultA) + Number(resultB) === 1, 'race must produce exactly one winner')

    const winnerId = resultA ? ownerA : ownerB
    const loserId = resultA ? ownerB : ownerA
    const winnerTitle = resultA ? `Race owner A ${iteration}` : `Race owner B ${iteration}`
    const loserTitle = resultA ? `Race owner B ${iteration}` : `Race owner A ${iteration}`
    const final = execPsql(
      container,
      `select owner_user_id::text || '|' || title || '|' || cover || '|' || tagline
       from public.stories where id = :'story_id';`,
      { story_id: storyId },
    ).trim()
    check(final.startsWith(`${winnerId}|${winnerTitle}|`), 'final owner and metadata must match race winner')
    check(!final.includes(loserTitle), 'loser metadata must not persist')

    const transfer = execPsql(
      container,
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
    for (const running of [holder, ...contenders]) {
      if (running.child.exitCode === null) running.child.kill()
    }
  }
}

async function main() {
  const container = localContainer()
  const marker = execPsql(container, "select current_setting('lakoku.test_target', true);").trim()
  check(marker === 'local-cli', 'lakoku.test_target must equal local-cli')

  const ownerA = crypto.randomUUID()
  const ownerB = crypto.randomUUID()
  const storyIds: string[] = []
  execPsql(
    container,
    `insert into auth.users (
       id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values
       (:'owner_a'::uuid, 'authenticated', 'authenticated', :'email_a', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
       (:'owner_b'::uuid, 'authenticated', 'authenticated', :'email_b', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());`,
    {
      owner_a: ownerA,
      owner_b: ownerB,
      email_a: `authoring-race-a-${ownerA}@example.invalid`,
      email_b: `authoring-race-b-${ownerB}@example.invalid`,
    },
  )

  try {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await raceOnce(container, iteration, ownerA, ownerB, storyIds)
    }
    console.log(`Authoring story claim race: ${ITERATIONS}/${ITERATIONS} PASS`)
  } finally {
    for (const storyId of storyIds) {
      execPsql(container, `delete from public.stories where id = :'story_id';`, { story_id: storyId })
    }
    execPsql(
      container,
      `delete from auth.users where id in (:'owner_a'::uuid, :'owner_b'::uuid);`,
      { owner_a: ownerA, owner_b: ownerB },
    )
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'authoring claim race failed')
  process.exitCode = 1
})
