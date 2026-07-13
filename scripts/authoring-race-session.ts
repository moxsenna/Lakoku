import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { assertLoopbackSupabaseUrl } from './personalized-db-safety'

const READY_TIMEOUT_MS = 10_000
const PROCESS_EXIT_TIMEOUT_MS = 750
const BACKEND_EXIT_TIMEOUT_MS = 5_000
const POLL_MS = 25

export interface RaceTarget {
  container: string
  context: string
  applicationPrefix: string
}

type ProcessExit = {
  code: number | null
  signal: NodeJS.Signals | null
  startFailed: boolean
}

export interface RunningRacePsql {
  child: ChildProcessWithoutNullStreams
  stdout: string
  applicationName: string
  backendPid: number | null
  exit: Promise<ProcessExit>
}

export interface CleanupStep {
  label: string
  run: () => void | Promise<void>
}

export function checkRace(value: unknown, context: string, message: string): asserts value {
  if (!value) throw new Error(`${context}: ${message}`)
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

function safeLabel(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe.slice(0, 20) || 'session'
}

function psqlArgs(container: string, variables: Record<string, string>): string[] {
  const args = [
    'exec', '-i', container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ]
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`)
  return args
}

export function execLocalPsql(
  target: Pick<RaceTarget, 'container' | 'context'>,
  sql: string,
  variables: Record<string, string> = {},
): string {
  try {
    return execFileSync('docker', psqlArgs(target.container, variables), {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(`${target.context}: local PostgreSQL command failed`)
  }
}

export function verifyLocalRaceTarget(context: string): RaceTarget {
  let status: Record<string, unknown>
  try {
    status = localStatus()
  } catch {
    throw new Error(`${context}: local Supabase status unavailable`)
  }
  checkRace(typeof status.API_URL === 'string', context, 'local Supabase API URL unavailable')
  checkRace(typeof status.DB_URL === 'string', context, 'local Supabase DB URL unavailable')
  assertLoopbackSupabaseUrl(status.API_URL)
  assertLoopbackSupabaseUrl(status.DB_URL)

  const project = path.basename(process.cwd())
  checkRace(/^[a-zA-Z0-9_-]+$/.test(project), context, 'unsafe local project name')
  const container = `supabase_db_${project}`
  let label = ''
  try {
    label = execFileSync(
      'docker',
      ['inspect', '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}', container],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    throw new Error(`${context}: local Supabase database container unavailable`)
  }
  checkRace(label === project, context, 'database container is not current local Supabase project')

  const target: RaceTarget = {
    container,
    context,
    applicationPrefix: `lakoku-${safeLabel(context)}`,
  }
  const marker = execLocalPsql(target, "select current_setting('lakoku.test_target', true);").trim()
  checkRace(marker === 'local-cli', context, 'lakoku.test_target must equal local-cli')
  return target
}

function sessionPrelude(): string {
  return `set application_name = :'race_application_name';
set statement_timeout = '10s';
set lock_timeout = '3s';
set idle_in_transaction_session_timeout = '5s';
select 'RACE_SESSION|' || pg_backend_pid();
`
}

export function startRacePsql(
  target: RaceTarget,
  label: string,
  variables: Record<string, string> = {},
): RunningRacePsql {
  const applicationName = `${target.applicationPrefix}-${safeLabel(label)}-${crypto.randomUUID()}`.slice(0, 63)
  const child = spawn(
    'docker',
    psqlArgs(target.container, { ...variables, race_application_name: applicationName }),
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const running: RunningRacePsql = {
    child,
    stdout: '',
    applicationName,
    backendPid: null,
    exit: Promise.resolve({ code: null, signal: null, startFailed: false }),
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { running.stdout += chunk })
  child.stderr.resume()
  running.exit = new Promise<ProcessExit>((resolve) => {
    let settled = false
    child.once('error', () => {
      if (!settled) {
        settled = true
        resolve({ code: null, signal: null, startFailed: true })
      }
    })
    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true
        resolve({ code, signal, startFailed: false })
      }
    })
  })
  child.stdin.write(sessionPrelude())
  return running
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function waitForRaceToken(
  running: RunningRacePsql,
  token: string,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const started = Date.now()
  while (!running.stdout.includes(token)) {
    checkRace(running.child.exitCode === null, 'authoring race session', 'PostgreSQL session exited before race barrier')
    checkRace(Date.now() - started < timeoutMs, 'authoring race session', 'PostgreSQL race barrier timed out')
    await delay(10)
  }
}

export async function waitForRaceSession(
  running: RunningRacePsql,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<number> {
  await waitForRaceToken(running, 'RACE_SESSION|', timeoutMs)
  const match = running.stdout.match(/(?:^|\r?\n)RACE_SESSION\|(\d+)(?:\r?\n|$)/)
  checkRace(match, 'authoring race session', 'PostgreSQL backend PID unavailable')
  const pid = Number(match[1])
  checkRace(Number.isSafeInteger(pid) && pid > 0, 'authoring race session', 'invalid PostgreSQL backend PID')
  running.backendPid = pid
  return pid
}

export async function waitForRaceSuccess(running: RunningRacePsql): Promise<void> {
  const result = await running.exit
  checkRace(!result.startFailed, 'authoring race session', 'cannot start local PostgreSQL session')
  checkRace(result.code === 0, 'authoring race session', 'local PostgreSQL session failed')
}

async function waitForProcessExit(running: RunningRacePsql, timeoutMs: number): Promise<boolean> {
  if (running.child.exitCode !== null) return true
  return Promise.race([
    running.exit.then(() => true),
    delay(timeoutMs).then(() => false),
  ])
}

function backendExists(target: RaceTarget, running: RunningRacePsql): boolean {
  if (running.backendPid === null) return false
  const output = execLocalPsql(
    target,
    `select count(*) from pg_stat_activity
     where pid = :'pid'::integer and application_name = :'application_name';`,
    { pid: String(running.backendPid), application_name: running.applicationName },
  ).trim()
  return output !== '0'
}

function terminateMatchingBackend(target: RaceTarget, running: RunningRacePsql): void {
  if (running.backendPid === null) return
  execLocalPsql(
    target,
    `select coalesce((
       select pg_terminate_backend(pid)::text from pg_stat_activity
       where pid = :'pid'::integer and application_name = :'application_name'
     ), 'absent');`,
    { pid: String(running.backendPid), application_name: running.applicationName },
  )
}

async function waitForBackendExit(target: RaceTarget, running: RunningRacePsql): Promise<void> {
  const started = Date.now()
  while (backendExists(target, running)) {
    checkRace(Date.now() - started < BACKEND_EXIT_TIMEOUT_MS, target.context, 'PostgreSQL backend termination timed out')
    await delay(POLL_MS)
  }
}

async function cleanupRaceSession(target: RaceTarget, running: RunningRacePsql): Promise<void> {
  if (!running.child.stdin.destroyed && !running.child.stdin.writableEnded) running.child.stdin.end()
  let exited = await waitForProcessExit(running, PROCESS_EXIT_TIMEOUT_MS)
  if (!exited) {
    running.child.kill('SIGTERM')
    exited = await waitForProcessExit(running, PROCESS_EXIT_TIMEOUT_MS)
  }

  if (running.backendPid !== null && backendExists(target, running)) {
    terminateMatchingBackend(target, running)
    await waitForBackendExit(target, running)
  }

  if (!exited) {
    running.child.kill('SIGKILL')
    exited = await waitForProcessExit(running, PROCESS_EXIT_TIMEOUT_MS)
  }
  checkRace(exited, target.context, 'local PostgreSQL process did not exit')
}

export function assertRaceSessionsGone(target: RaceTarget, sessions: RunningRacePsql[]): void {
  const captured = sessions.filter(
    (session): session is RunningRacePsql & { backendPid: number } => session.backendPid !== null,
  )
  for (const session of captured) {
    const activity = execLocalPsql(
      target,
      `select count(*) from pg_stat_activity
       where pid = :'pid'::integer and application_name = :'application_name';`,
      { pid: String(session.backendPid), application_name: session.applicationName },
    ).trim()
    checkRace(activity === '0', target.context, 'matching PostgreSQL activity remains')
  }
  if (captured.length > 0) {
    const pids = captured.map((session) => session.backendPid).join(',')
    const locks = execLocalPsql(
      target,
      `select count(*) from pg_locks
       where locktype = 'advisory' and granted and pid in (${pids});`,
    ).trim()
    checkRace(locks === '0', target.context, 'PostgreSQL advisory lock remains')
  }
}

export async function runCleanupSteps(context: string, steps: CleanupStep[]): Promise<void> {
  const failures: string[] = []
  for (const step of steps) {
    try {
      await step.run()
    } catch {
      failures.push(step.label)
    }
  }
  if (failures.length > 0) {
    throw new Error(`${context}: cleanup failed (${failures.join(', ')})`)
  }
}

export async function cleanupRaceSessions(
  target: RaceTarget,
  sessions: RunningRacePsql[],
): Promise<void> {
  const steps: CleanupStep[] = sessions.map((session, index) => ({
    label: `session ${index + 1}`,
    run: () => cleanupRaceSession(target, session),
  }))
  steps.push({ label: 'session verification', run: () => assertRaceSessionsGone(target, sessions) })
  await runCleanupSteps(target.context, steps)
}

function variableList(prefix: string, values: string[]): { sql: string; variables: Record<string, string> } {
  const variables: Record<string, string> = {}
  const sql = values.map((value, index) => {
    const key = `${prefix}_${index}`
    variables[key] = value
    return `:'${key}'`
  }).join(', ')
  return { sql, variables }
}

export function assertFixtureRowsGone(
  target: RaceTarget,
  storyIds: string[],
  userIds: string[],
): void {
  if (storyIds.length > 0) {
    const stories = variableList('story', storyIds)
    const count = execLocalPsql(
      target,
      `select count(*) from public.stories where id in (${stories.sql});`,
      stories.variables,
    ).trim()
    checkRace(count === '0', target.context, 'fixture stories remain')
  }
  if (userIds.length > 0) {
    const users = variableList('user', userIds)
    const count = execLocalPsql(
      target,
      `select count(*) from auth.users where id in (${users.sql});`,
      users.variables,
    ).trim()
    checkRace(count === '0', target.context, 'fixture auth users remain')
  }
}

export async function cleanupFixtureRows(
  target: RaceTarget,
  storyIds: string[],
  userIds: string[],
): Promise<void> {
  const stories = variableList('story', storyIds)
  const users = variableList('user', userIds)
  await runCleanupSteps(target.context, [
    {
      label: 'stories',
      run: () => {
        if (storyIds.length > 0) {
          execLocalPsql(target, `delete from public.stories where id in (${stories.sql});`, stories.variables)
        }
      },
    },
    {
      label: 'auth users',
      run: () => {
        if (userIds.length > 0) {
          execLocalPsql(target, `delete from auth.users where id in (${users.sql});`, users.variables)
        }
      },
    },
    {
      label: 'fixture verification',
      run: () => assertFixtureRowsGone(target, storyIds, userIds),
    },
  ])
}
