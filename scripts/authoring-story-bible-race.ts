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
  if (!value) throw new Error(`authoring story bible race: ${message}`)
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
    throw new Error('authoring story bible race: local Supabase database container unavailable')
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
    throw new Error('authoring story bible race: local PostgreSQL command failed')
  }
}

function startPsql(container: string, variables: Record<string, string>): RunningPsql {
  const child = spawn('docker', psqlArgs(container, variables), {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const running: RunningPsql = { child, stdout: '', done: Promise.resolve() }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { running.stdout += chunk })
  running.done = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('authoring story bible race: cannot start PostgreSQL session')))
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error('authoring story bible race: PostgreSQL session failed'))
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

function replacementSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'REPLACE_RESULT|${side}|' || public.replace_authoring_story_bible_v1(
  :'story_id', :'owner_id'::uuid,
  'Race snapshot ${side}', '/race-${side.toLowerCase()}.svg', 'Race snapshot ${side} tagline', 'Race protagonist',
  '["Atomic replacement","Coherent canon"]'::jsonb, 50,
  'Race snapshot ${side} synopsis remains long enough for strict authoring metadata validation bounds.',
  jsonb_build_object(
    'characters', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':char:${side}', 'canonical_name', 'Character ${side}', 'role', 'Lead',
      'motivation', 'Keep ${side} coherent', 'introduced_chapter', 1, 'status', 'ALIVE'
    )),
    'character_aliases', jsonb_build_array(jsonb_build_object(
      'character_id', :'story_id' || ':char:${side}', 'alias', 'Alias ${side}', 'alias_type', 'NICKNAME'
    )),
    'character_voice_sheets', jsonb_build_array(jsonb_build_object(
      'character_id', :'story_id' || ':char:${side}', 'register', 'Register ${side}',
      'speech_habits', '["${side}"]'::jsonb, 'forbidden_words', '[]'::jsonb, 'sample_lines', '["${side}"]'::jsonb
    )),
    'facts_ledger', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':fact:${side}', 'statement', 'Fact ${side}',
      'subject_character_id', :'story_id' || ':char:${side}', 'established_chapter', 1,
      'salience', 0.8, 'load_bearing', true, 'paid_off', false
    )),
    'knowledge_scopes', jsonb_build_array(jsonb_build_object(
      'character_id', :'story_id' || ':char:${side}', 'fact_id', :'story_id' || ':fact:${side}', 'known_from_chapter', 1
    )),
    'secrets_reveals', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':secret:${side}', 'description', 'Secret ${side}', 'reveal_gate_chapter', 10, 'revealed', false
    )),
    'timeline_events', jsonb_build_array(jsonb_build_object(
      'chapter_number', 1, 'ordinal', 0, 'description', 'Event ${side}', 'is_flashback', false, 'occurs_at', 1
    )),
    'story_threads', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':thread:${side}', 'title', 'Thread ${side}', 'status', 'OPEN',
      'opened_chapter', 1, 'last_touched_chapter', 1, 'payoff_window', 20,
      'is_main_mystery', true, 'stale', false, 'stale_since_chapter', null
    )),
    'act_rollups', jsonb_build_array(jsonb_build_object(
      'act_number', 1, 'summary', 'Rollup ${side}', 'state_delta', jsonb_build_object('marker', '${side}'),
      'covers_from_chapter', 1, 'covers_to_chapter', 10
    )),
    'chapter_blueprints', jsonb_build_array(jsonb_build_object(
      'chapter_number', 1, 'version', 1, 'phase', 'Phase ${side}', 'chapter_goal', 'Goal ${side}',
      'mandatory_beats', '["${side}"]'::jsonb, 'forbidden_reveals', '[]'::jsonb,
      'allowed_state_delta', jsonb_build_object('marker', '${side}'),
      'introduces_characters', jsonb_build_array(:'story_id' || ':char:${side}'),
      'reconciled_from_version', null, 'reconciliation_reason', null
    ))
  )
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

async function releaseRaceBarrier(
  container: string,
  variablesA: Record<string, string>,
  variablesB: Record<string, string>,
): Promise<[RunningPsql, RunningPsql]> {
  const barrier = variablesA.barrier
  const holder = startPsql(container, { barrier })
  const contenders: RunningPsql[] = []
  try {
    holder.child.stdin.write(
      `begin;\nset local statement_timeout = '10s';\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`,
    )
    await waitForToken(holder, 'BARRIER_READY')

    const contenderA = startPsql(container, variablesA)
    const contenderB = startPsql(container, variablesB)
    contenders.push(contenderA, contenderB)
    contenderA.child.stdin.end(replacementSql('A'))
    contenderB.child.stdin.end(replacementSql('B'))
    await Promise.all([
      waitForToken(contenderA, 'CONTENDER_READY|A'),
      waitForToken(contenderB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)
    await Promise.all([holder.done, contenderA.done, contenderB.done])
    return [contenderA, contenderB]
  } catch (error) {
    for (const running of [holder, ...contenders]) {
      if (running.child.exitCode === null) running.child.kill()
    }
    throw error
  }
}

function finalSnapshot(container: string, storyId: string): string {
  return execPsql(
    container,
    `select concat_ws('|',
       s.owner_user_id::text, s.title,
       (select string_agg(canonical_name, ',') from public.characters where story_id = s.id),
       (select string_agg(alias, ',') from public.character_aliases where story_id = s.id),
       (select string_agg(register, ',') from public.character_voice_sheets where story_id = s.id),
       (select string_agg(statement, ',') from public.facts_ledger where story_id = s.id),
       (select count(*)::text from public.knowledge_scopes where story_id = s.id),
       (select string_agg(description, ',') from public.secrets_reveals where story_id = s.id),
       (select string_agg(description, ',') from public.timeline_events where story_id = s.id),
       (select string_agg(title, ',') from public.story_threads where story_id = s.id),
       (select string_agg(summary, ',') from public.act_rollups where story_id = s.id),
       (select string_agg(phase, ',') from public.chapter_blueprints where story_id = s.id)
     ) from public.stories s where s.id = :'story_id';`,
    { story_id: storyId },
  ).trim()
}

async function sameOwnerRace(
  container: string,
  iteration: number,
  ownerId: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:authoring-replace-same-${crypto.randomUUID()}`
  storyIds.push(storyId)
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration)
  const [a, b] = await releaseRaceBarrier(
    container,
    { story_id: storyId, owner_id: ownerId, barrier },
    { story_id: storyId, owner_id: ownerId, barrier },
  )
  check(a.stdout.includes('"status": "REPLACED"'), 'same-owner contender A must succeed')
  check(b.stdout.includes('"status": "REPLACED"'), 'same-owner contender B must succeed')

  const final = finalSnapshot(container, storyId)
  const completeA = `${ownerId}|Race snapshot A|Character A|Alias A|Register A|Fact A|1|Secret A|Event A|Thread A|Rollup A|Phase A`
  const completeB = `${ownerId}|Race snapshot B|Character B|Alias B|Register B|Fact B|1|Secret B|Event B|Thread B|Rollup B|Phase B`
  check(final === completeA || final === completeB, 'same-owner final canon must equal one complete snapshot')
}

async function differentOwnerRace(
  container: string,
  iteration: number,
  ownerA: string,
  ownerB: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:authoring-replace-owner-${crypto.randomUUID()}`
  storyIds.push(storyId)
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration + 100)
  const [a, b] = await releaseRaceBarrier(
    container,
    { story_id: storyId, owner_id: ownerA, barrier },
    { story_id: storyId, owner_id: ownerB, barrier },
  )
  const aWon = a.stdout.includes('"status": "REPLACED"')
  const bWon = b.stdout.includes('"status": "REPLACED"')
  const aMismatch = a.stdout.includes('"status": "OWNER_MISMATCH"')
  const bMismatch = b.stdout.includes('"status": "OWNER_MISMATCH"')
  check(Number(aWon) + Number(bWon) === 1, 'different-owner race must have exactly one replacement winner')
  check(Number(aMismatch) + Number(bMismatch) === 1, 'different-owner race must have exactly one OWNER_MISMATCH')

  const winner = aWon ? ownerA : ownerB
  const marker = aWon ? 'A' : 'B'
  const final = finalSnapshot(container, storyId)
  const expected = `${winner}|Race snapshot ${marker}|Character ${marker}|Alias ${marker}|Register ${marker}|Fact ${marker}|1|Secret ${marker}|Event ${marker}|Thread ${marker}|Rollup ${marker}|Phase ${marker}`
  check(final === expected, 'different-owner final shell and canon must equal winner snapshot')
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
      email_a: `authoring-bible-race-a-${ownerA}@example.invalid`,
      email_b: `authoring-bible-race-b-${ownerB}@example.invalid`,
    },
  )

  try {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await sameOwnerRace(container, iteration, ownerA, storyIds)
      await differentOwnerRace(container, iteration, ownerA, ownerB, storyIds)
    }
    console.log(`Authoring story bible races: ${ITERATIONS} same-owner + ${ITERATIONS} different-owner PASS`)
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
  console.error(error instanceof Error ? error.message : 'authoring story bible race failed')
  process.exitCode = 1
})
