import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
  type ExecFileSyncOptionsWithStringEncoding,
} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { assertLoopbackSupabaseUrl } from './personalized-db-safety'

const READY_TIMEOUT_MS = 10_000
const RACE_PROCESS_EXIT_TIMEOUT_MS = 15_000
const PROCESS_EXIT_TIMEOUT_MS = 750
const BACKEND_EXIT_TIMEOUT_MS = 5_000
const LOCAL_STATUS_TIMEOUT_MS = 15_000
const LOCAL_INSPECT_TIMEOUT_MS = 5_000
const LOCAL_PSQL_TIMEOUT_MS = 15_000
const CLEANUP_QUERY_TIMEOUT_MS = 2_000
const POLL_MS = 25

export interface RaceTarget {
  container: string
  context: string
  applicationPrefix: string
}

type ExecFile = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding,
) => string

export interface LocalRaceVerificationDependencies {
  cwd: string
  readConfig: (configPath: string) => string
  readStatus: (context: string) => Record<string, unknown>
  inspectContainerProject: (container: string, context: string) => string
  readPersistentMarker: (target: RaceTarget) => string
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

export interface CleanupRaceResourcesHooks {
  beforeSessionCleanup?: () => void | Promise<void>
  onStepAttempt?: (label: string) => void
}

export function checkRace(value: unknown, context: string, message: string): asserts value {
  if (!value) throw new Error(`${context}: ${message}`)
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; signal?: unknown; killed?: unknown }
  return value.code === 'ETIMEDOUT' || value.signal === 'SIGTERM' || value.killed === true
}

function localStatus(context: string): Record<string, unknown> {
  try {
    const output = process.platform === 'win32'
      ? execFileSync(
          'cmd.exe',
          ['/d', '/s', '/c', 'pnpm exec supabase status -o json'],
          {
            cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
            timeout: LOCAL_STATUS_TIMEOUT_MS,
          },
        )
      : execFileSync(
          'pnpm',
          ['exec', 'supabase', 'status', '-o', 'json'],
          {
            cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
            timeout: LOCAL_STATUS_TIMEOUT_MS,
          },
        )
    return JSON.parse(output) as Record<string, unknown>
  } catch (error) {
    const reason = isTimeoutError(error) ? 'timed out' : 'unavailable'
    throw new Error(`${context}: local Supabase status ${reason}`)
  }
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

function localMarkerPrelude(): string {
  return `do $$
begin
  if current_setting('lakoku.test_target', true) <> 'local-cli' then
    raise exception 'local test target marker unavailable';
  end if;
end
$$;
`
}

export function execLocalPsql(
  target: Pick<RaceTarget, 'container' | 'context'>,
  sql: string,
  variables: Record<string, string> = {},
  timeoutMs = LOCAL_PSQL_TIMEOUT_MS,
  execFile: ExecFile = execFileSync,
): string {
  try {
    return execFile('docker', psqlArgs(target.container, variables), {
      input: `${localMarkerPrelude()}${sql}`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    }) as string
  } catch (error) {
    const reason = isTimeoutError(error) ? 'timed out' : 'failed'
    throw new Error(`${target.context}: local PostgreSQL command ${reason}`)
  }
}

export function parseSupabaseProjectId(config: string): string {
  const projectLines = config
    .split(/\r?\n/)
    .filter((line) => /^\s*project_id\s*=/.test(line))
  checkRace(projectLines.length === 1, 'local Supabase config', 'expected exactly one project_id')
  const match = projectLines[0].match(/^\s*project_id\s*=\s*"([^"]*)"\s*(?:#.*)?$/)
  checkRace(match && /^[a-zA-Z0-9_-]+$/.test(match[1]), 'local Supabase config', 'unsafe project_id')
  return match[1]
}

function inspectContainerProject(container: string, context: string): string {
  try {
    return execFileSync(
      'docker',
      ['inspect', '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}', container],
      {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: LOCAL_INSPECT_TIMEOUT_MS,
      },
    ).trim()
  } catch (error) {
    const reason = isTimeoutError(error) ? 'timed out' : 'unavailable'
    throw new Error(`${context}: local Supabase database container ${reason}`)
  }
}

const defaultLocalRaceVerificationDependencies: LocalRaceVerificationDependencies = {
  cwd: process.cwd(),
  readConfig: (configPath) => fs.readFileSync(configPath, 'utf8'),
  readStatus: localStatus,
  inspectContainerProject,
  readPersistentMarker: (target) => execLocalPsql(target, "select current_setting('lakoku.test_target', true);"),
}

function localSupabaseProjectId(
  context: string,
  dependencies: LocalRaceVerificationDependencies,
): string {
  const configPath = path.join(dependencies.cwd, 'supabase', 'config.toml')
  let config = ''
  try {
    config = dependencies.readConfig(configPath)
  } catch {
    throw new Error(`${context}: tracked Supabase config unavailable`)
  }
  try {
    return parseSupabaseProjectId(config)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid project_id'
    throw new Error(`${context}: ${message}`)
  }
}

export function verifyLocalRaceContainer(
  context: string,
  dependencies: LocalRaceVerificationDependencies = defaultLocalRaceVerificationDependencies,
): RaceTarget {
  const status = dependencies.readStatus(context)
  checkRace(typeof status.API_URL === 'string', context, 'local Supabase API URL unavailable')
  checkRace(typeof status.DB_URL === 'string', context, 'local Supabase DB URL unavailable')
  assertLoopbackSupabaseUrl(status.API_URL)
  assertLoopbackSupabaseUrl(status.DB_URL)

  const project = localSupabaseProjectId(context, dependencies)
  const container = `supabase_db_${project}`
  const label = dependencies.inspectContainerProject(container, context)
  checkRace(label === project, context, 'database container is not current local Supabase project')

  return {
    container,
    context,
    applicationPrefix: `lakoku-${safeLabel(context)}`,
  }
}

export function verifyLocalRaceTarget(
  context: string,
  dependencies: LocalRaceVerificationDependencies = defaultLocalRaceVerificationDependencies,
): RaceTarget {
  const target = verifyLocalRaceContainer(context, dependencies)
  const marker = dependencies.readPersistentMarker(target).trim()
  checkRace(marker === 'local-cli', context, 'lakoku.test_target must equal local-cli')
  return target
}

function sessionPrelude(): string {
  return `${localMarkerPrelude()}set application_name = :'race_application_name';
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

async function awaitProcessExit(
  running: RunningRacePsql,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<ProcessExit> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      running.exit,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function waitForRaceSuccess(running: RunningRacePsql): Promise<void> {
  const result = await awaitProcessExit(
    running,
    RACE_PROCESS_EXIT_TIMEOUT_MS,
    'authoring race session: local PostgreSQL process exit timed out',
  )
  checkRace(!result.startFailed, 'authoring race session', 'cannot start local PostgreSQL session')
  checkRace(result.code === 0, 'authoring race session', 'local PostgreSQL session failed')
}

async function waitForProcessExit(running: RunningRacePsql, timeoutMs: number): Promise<boolean> {
  if (running.child.exitCode !== null) return true
  try {
    await awaitProcessExit(running, timeoutMs, 'local PostgreSQL process exit timed out')
    return true
  } catch {
    return false
  }
}

export async function signalRaceProcess(
  running: RunningRacePsql,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  let signalFailed = false
  try {
    signalFailed = !running.child.kill(signal)
  } catch {
    signalFailed = true
  }
  const exited = await waitForProcessExit(running, timeoutMs)
  if (signalFailed && !exited) throw new Error(`local PostgreSQL process ${signal} failed`)
  return exited
}

function backendSelector(running: RunningRacePsql): {
  sql: string
  variables: Record<string, string>
} {
  checkRace(
    running.applicationName.startsWith('lakoku-') && running.applicationName.length <= 63,
    'authoring race session',
    'unsafe PostgreSQL application name',
  )
  if (running.backendPid === null) {
    return {
      sql: "application_name = :'application_name'",
      variables: { application_name: running.applicationName },
    }
  }
  return {
    sql: "pid = :'pid'::integer and application_name = :'application_name'",
    variables: { pid: String(running.backendPid), application_name: running.applicationName },
  }
}

function backendExists(target: RaceTarget, running: RunningRacePsql): boolean {
  const selector = backendSelector(running)
  const output = execLocalPsql(
    target,
    `select count(*) from pg_stat_activity where ${selector.sql};`,
    selector.variables,
    CLEANUP_QUERY_TIMEOUT_MS,
  ).trim()
  return output !== '0'
}

function terminateMatchingBackend(target: RaceTarget, running: RunningRacePsql): void {
  const selector = backendSelector(running)
  execLocalPsql(
    target,
    `select coalesce((
       select pg_terminate_backend(pid)::text from pg_stat_activity
       where ${selector.sql}
     ), 'absent');`,
    selector.variables,
    CLEANUP_QUERY_TIMEOUT_MS,
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
  const failures: string[] = []
  let exited = false
  try {
    if (!running.child.stdin.destroyed && !running.child.stdin.writableEnded) running.child.stdin.end()
    exited = await waitForProcessExit(running, PROCESS_EXIT_TIMEOUT_MS)
    let backendPresent: boolean | undefined
    try {
      backendPresent = backendExists(target, running)
    } catch {
      failures.push('backend probe')
    }
    if (backendPresent !== false) {
      try {
        terminateMatchingBackend(target, running)
      } catch {
        failures.push('backend termination')
      }
      try {
        await waitForBackendExit(target, running)
      } catch {
        failures.push('backend reap')
      }
    }
  } finally {
    if (!exited) {
      try {
        exited = await signalRaceProcess(running, 'SIGTERM', PROCESS_EXIT_TIMEOUT_MS)
      } catch {
        failures.push('process SIGTERM')
      }
    }
    if (!exited) {
      try {
        exited = await signalRaceProcess(running, 'SIGKILL', PROCESS_EXIT_TIMEOUT_MS)
      } catch {
        failures.push('process SIGKILL')
      }
    }
    if (!exited) failures.push('process reap')
  }
  if (failures.length > 0) {
    throw new Error(`${target.context}: session cleanup failed (${failures.join(', ')})`)
  }
}

function capturedSessions(
  sessions: RunningRacePsql[],
): Array<RunningRacePsql & { backendPid: number }> {
  return sessions.filter(
    (session): session is RunningRacePsql & { backendPid: number } => session.backendPid !== null,
  )
}

function assertSessionActivityGone(
  target: RaceTarget,
  session: RunningRacePsql,
): void {
  const selector = backendSelector(session)
  const activity = execLocalPsql(
    target,
    `select count(*) from pg_stat_activity where ${selector.sql};`,
    selector.variables,
    CLEANUP_QUERY_TIMEOUT_MS,
  ).trim()
  checkRace(activity === '0', target.context, 'matching PostgreSQL activity remains')
}

function assertAdvisoryLocksGone(
  target: RaceTarget,
  sessions: Array<RunningRacePsql & { backendPid: number }>,
): void {
  if (sessions.length === 0) return
  const pids = sessions.map((session) => session.backendPid).join(',')
  const locks = execLocalPsql(
    target,
    `select count(*) from pg_locks
     where locktype = 'advisory' and granted and pid in (${pids});`,
    {},
    CLEANUP_QUERY_TIMEOUT_MS,
  ).trim()
  checkRace(locks === '0', target.context, 'PostgreSQL advisory lock remains')
}

export function assertRaceSessionsGone(target: RaceTarget, sessions: RunningRacePsql[]): void {
  for (const session of sessions) assertSessionActivityGone(target, session)
  assertAdvisoryLocksGone(target, capturedSessions(sessions))
}

async function collectCleanupFailures(
  steps: CleanupStep[],
  onStepAttempt?: (label: string) => void,
): Promise<string[]> {
  const failures: string[] = []
  for (const step of steps) {
    try {
      onStepAttempt?.(step.label)
      await step.run()
    } catch {
      failures.push(step.label)
    }
  }
  return failures
}

function throwCleanupFailures(context: string, failures: string[]): void {
  if (failures.length > 0) {
    throw new Error(`${context}: cleanup failed (${failures.join(', ')})`)
  }
}

export async function runCleanupSteps(context: string, steps: CleanupStep[]): Promise<void> {
  throwCleanupFailures(context, await collectCleanupFailures(steps))
}

function raceSessionCleanupSteps(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  beforeSessionCleanup?: () => void | Promise<void>,
): CleanupStep[] {
  return [
    ...(beforeSessionCleanup
      ? [{ label: 'injected session cleanup', run: beforeSessionCleanup }]
      : []),
    ...sessions.map((session, index) => ({
      label: `session ${index + 1}`,
      run: () => cleanupRaceSession(target, session),
    })),
  ]
}

function raceSessionVerificationSteps(
  target: RaceTarget,
  sessions: RunningRacePsql[],
): CleanupStep[] {
  const captured = capturedSessions(sessions)
  return [
    ...sessions.map((session, index) => ({
      label: `session activity verification ${index + 1}`,
      run: () => assertSessionActivityGone(target, session),
    })),
    { label: 'session verification', run: () => assertAdvisoryLocksGone(target, captured) },
  ]
}

export async function cleanupRaceSessions(
  target: RaceTarget,
  sessions: RunningRacePsql[],
): Promise<void> {
  const failures = [
    ...await collectCleanupFailures(raceSessionCleanupSteps(target, sessions)),
    ...await collectCleanupFailures(raceSessionVerificationSteps(target, sessions)),
  ]
  throwCleanupFailures(target.context, failures)
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

function assertStoriesGone(target: RaceTarget, storyIds: string[]): void {
  if (storyIds.length === 0) return
  const stories = variableList('story', storyIds)
  const count = execLocalPsql(
    target,
    `select count(*) from public.stories where id in (${stories.sql});`,
    stories.variables,
    CLEANUP_QUERY_TIMEOUT_MS,
  ).trim()
  checkRace(count === '0', target.context, 'fixture stories remain')
}

function assertAuthUsersGone(target: RaceTarget, userIds: string[]): void {
  if (userIds.length === 0) return
  const users = variableList('user', userIds)
  const count = execLocalPsql(
    target,
    `select count(*) from auth.users where id in (${users.sql});`,
    users.variables,
    CLEANUP_QUERY_TIMEOUT_MS,
  ).trim()
  checkRace(count === '0', target.context, 'fixture auth users remain')
}

export function assertFixtureRowsGone(
  target: RaceTarget,
  storyIds: string[],
  userIds: string[],
): void {
  assertStoriesGone(target, storyIds)
  assertAuthUsersGone(target, userIds)
}

function fixtureCleanupSteps(
  target: RaceTarget,
  storyIds: string[],
  userIds: string[],
): CleanupStep[] {
  const stories = variableList('story', storyIds)
  const users = variableList('user', userIds)
  return [
    {
      label: 'stories',
      run: () => {
        if (storyIds.length > 0) {
          execLocalPsql(
            target,
            `delete from public.stories where id in (${stories.sql});`,
            stories.variables,
            CLEANUP_QUERY_TIMEOUT_MS,
          )
        }
      },
    },
    {
      label: 'auth users',
      run: () => {
        if (userIds.length > 0) {
          execLocalPsql(
            target,
            `delete from auth.users where id in (${users.sql});`,
            users.variables,
            CLEANUP_QUERY_TIMEOUT_MS,
          )
        }
      },
    },
  ]
}

function fixtureVerificationSteps(
  target: RaceTarget,
  storyIds: string[],
  userIds: string[],
): CleanupStep[] {
  return [
    { label: 'story verification', run: () => assertStoriesGone(target, storyIds) },
    { label: 'fixture verification', run: () => assertAuthUsersGone(target, userIds) },
  ]
}

export async function cleanupFixtureRows(
  target: RaceTarget,
  storyIds: string[],
  userIds: string[],
): Promise<void> {
  const failures = [
    ...await collectCleanupFailures(fixtureCleanupSteps(target, storyIds, userIds)),
    ...await collectCleanupFailures(fixtureVerificationSteps(target, storyIds, userIds)),
  ]
  throwCleanupFailures(target.context, failures)
}

export async function verifyRaceResources(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  storyIds: string[],
  userIds: string[],
  onStepAttempt?: (label: string) => void,
): Promise<void> {
  const failures = [
    ...await collectCleanupFailures(raceSessionVerificationSteps(target, sessions), onStepAttempt),
    ...await collectCleanupFailures(fixtureVerificationSteps(target, storyIds, userIds), onStepAttempt),
  ]
  throwCleanupFailures(target.context, failures)
}

export async function cleanupRaceResources(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  storyIds: string[],
  userIds: string[],
  hooks: CleanupRaceResourcesHooks = {},
): Promise<void> {
  const failures = [
    ...await collectCleanupFailures(
      raceSessionCleanupSteps(target, sessions, hooks.beforeSessionCleanup),
      hooks.onStepAttempt,
    ),
    ...await collectCleanupFailures(
      fixtureCleanupSteps(target, storyIds, userIds),
      hooks.onStepAttempt,
    ),
    ...await collectCleanupFailures(
      raceSessionVerificationSteps(target, sessions),
      hooks.onStepAttempt,
    ),
    ...await collectCleanupFailures(
      fixtureVerificationSteps(target, storyIds, userIds),
      hooks.onStepAttempt,
    ),
  ]
  throwCleanupFailures(target.context, failures)
}
