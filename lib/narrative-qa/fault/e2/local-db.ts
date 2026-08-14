import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { E2EvidenceRow, E2ScenarioId } from './taxonomy'

export const TASK3_STORY_PREFIX = 'm10-e2-task3:'
export const TASK3_DB_SCENARIO_IDS = [
  'STALE_LEASE_RECLAMATION',
  'PUBLICATION_V2_UNCERTAINTY_RETRY',
  'PUBLICATION_V3_UNCERTAINTY_RETRY',
  'PUBLICATION_V5_UNCERTAINTY_RETRY',
  'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER',
  'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT',
  'TRANSACTION_ROLLBACK_AFTER_STATE_APPLIER_BEFORE_TERMINALIZATION',
  'STALE_CANON_REVISION',
  'COMMIT_LEDGER_PROVENANCE_MISMATCH',
  'NOTIFICATION_OUTBOX_FAILURE',
] as const satisfies readonly E2ScenarioId[]

interface SupabaseStatus {
  API_URL?: string
  DB_URL?: string
}

interface LocalProjectConfig {
  projectId: string
  apiPort: string
  dbPort: string
}

interface ContainerLabels {
  'com.docker.compose.project'?: string
  'com.supabase.cli.project'?: string
}

interface DedicatedDatabaseCounts {
  stories: number
  jobs: number
  leases: number
  checkpoints: number
  commits: number
}

interface SqlProofResult {
  rows: E2EvidenceRow[]
  environment: {
    projectRoot: string
    projectId: string
    apiPort: number
    dbPort: number
    container: string
    containerLabels: ContainerLabels
    migrationManifest: string[]
    migrationFileHashes: Record<string, string>
    rpcDefinitionHashes: Record<string, string>
    expectedRpcDefinitionHashes: Record<string, string>
  }
  safetyCounters: {
    duplicatePublicationCount: number
    canonicalCorruptionCount: number
    unboundedRetryCount: number
  }
  resetProof: {
    completed: boolean
    targets: Array<{
      target: string
      resetApplied: boolean
      cleanStateVerified: boolean
    }>
  }
}

export function assertLoopbackDatabaseUrl(value: string): void {
  let hostname: string
  try {
    hostname = new URL(value).hostname.replace(/^\[|\]$/g, '')
  } catch {
    throw new Error(`M10-E2 DB proof requires a valid loopback URL, received ${value}`)
  }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`M10-E2 DB proof requires loopback target, received ${value}`)
  }
}

function localStatus(projectRoot: string): Required<SupabaseStatus> {
  const executable = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `pnpm exec supabase status --workdir ${projectRoot} -o json`]
    : ['exec', 'supabase', 'status', '--workdir', projectRoot, '-o', 'json']
  const raw = execFileSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const parsed = JSON.parse(raw.match(/{[\s\S]*}/)?.[0] ?? raw) as SupabaseStatus
  if (!parsed.API_URL || !parsed.DB_URL) throw new Error('Local Supabase status missing API_URL or DB_URL')
  assertLoopbackDatabaseUrl(parsed.API_URL)
  assertLoopbackDatabaseUrl(parsed.DB_URL)
  return { API_URL: parsed.API_URL, DB_URL: parsed.DB_URL }
}

function localProjectConfig(projectRoot: string): LocalProjectConfig {
  const configPath = join(projectRoot, 'supabase', 'config.toml')
  const config = readFileSync(configPath, 'utf8')
  const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
  const apiBlock = config.match(/^\[api\]([\s\S]*?)(?=^\[|\z)/m)?.[1]
  const dbBlock = config.match(/^\[db\]([\s\S]*?)(?=^\[|\z)/m)?.[1]
  const apiPort = apiBlock?.match(/^port\s*=\s*(\d+)/m)?.[1]
  const dbPort = dbBlock?.match(/^port\s*=\s*(\d+)/m)?.[1]
  if (!projectId || !apiPort || !dbPort) throw new Error('Invalid local Supabase project config')
  return { projectId, apiPort, dbPort }
}

function databaseContainer(dbUrl: string, config: LocalProjectConfig): string {
  const port = new URL(dbUrl).port
  if (port !== config.dbPort) {
    throw new Error(`Local DB status port ${port} does not match config port ${config.dbPort}`)
  }
  const raw = execFileSync('docker', ['ps', '--format', '{{.Names}} {{.Ports}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const matches = raw.split(/\r?\n/).filter((line) => (
    line.startsWith('supabase_db_') && line.includes(`:${port}->5432/tcp`)
  ))
  if (matches.length !== 1) {
    throw new Error(`Expected one local Supabase DB container bound to loopback port ${port}, observed ${matches.length}`)
  }
  const container = matches[0].split(' ')[0]
  const labels = JSON.parse(execFileSync('docker', [
    'inspect', container, '--format', '{{json .Config.Labels}}',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as ContainerLabels
  if (container !== `supabase_db_${config.projectId}`
    || labels['com.docker.compose.project'] !== config.projectId
    || labels['com.supabase.cli.project'] !== config.projectId) {
    throw new Error(`Local DB container identity does not match project ${config.projectId}`)
  }
  return container
}

function runPsql(container: string, password: string, input: string, variables: string[] = []): string {
  return execFileSync('docker', [
    'exec', '-i', '-e', `PGPASSWORD=${password}`, container,
    'psql', '-X', '-A', '-t', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', ...variables,
    '-U', 'supabase_admin', '-d', 'postgres',
  ], {
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

const GOVERNED_RPCS = [
  'recover_stale_generation_jobs_v1',
  'claim_generation_job_v1',
  'publish_chapter_v2',
  'publish_chapter_state_v3',
  'publish_generation_job_chapter_v5',
] as const

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function migrationAuthority(
  container: string,
  password: string,
  projectRoot: string,
): { manifest: string[]; fileHashes: Record<string, string>; copiedSql: string[] } {
  const trackedRoot = join(process.cwd(), 'supabase', 'migrations')
  const copiedRoot = join(projectRoot, 'supabase', 'migrations')
  const names = readdirSync(trackedRoot).filter((name) => name.endsWith('.sql')).sort()
  const copiedNames = readdirSync(copiedRoot).filter((name) => name.endsWith('.sql')).sort()
  if (JSON.stringify(copiedNames) !== JSON.stringify(names)) {
    throw new Error(`Disposable migration files mismatch; expected ${JSON.stringify(names)}, observed ${JSON.stringify(copiedNames)}`)
  }
  const fileHashes: Record<string, string> = {}
  const copiedSql = names.map((name) => {
    const tracked = readFileSync(join(trackedRoot, name))
    const copied = readFileSync(join(copiedRoot, name))
    const trackedHash = sha256(tracked)
    const copiedHash = sha256(copied)
    if (copiedHash !== trackedHash) {
      throw new Error(`Disposable migration byte hash mismatch for ${name}: expected ${trackedHash}, observed ${copiedHash}`)
    }
    fileHashes[name] = trackedHash
    return copied.toString('utf8')
  })
  const manifest = names.map((name) => name.slice(0, -4))
  const output = runPsql(container, password, `
    select version || '_' || name from supabase_migrations.schema_migrations order by version;
  `)
  const applied = output.trim().split(/\r?\n/).filter(Boolean)
  if (JSON.stringify(applied) !== JSON.stringify(manifest)) {
    throw new Error(`Disposable migration ledger mismatch; expected ${JSON.stringify(manifest)}, observed ${JSON.stringify(applied)}`)
  }
  return { manifest, fileHashes, copiedSql }
}

function finalRpcDefinition(copiedSql: string[], name: string): string {
  const source = copiedSql.join('\n')
  const startPattern = new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${name}\\s*\\(`, 'ig')
  let match: RegExpExecArray | null
  let start = -1
  while ((match = startPattern.exec(source)) !== null) start = match.index
  if (start < 0) throw new Error(`Governed RPC definition missing from copied migrations: ${name}`)
  const body = source.slice(start)
  const delimiterMatch = body.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/i)
  if (!delimiterMatch || delimiterMatch.index === undefined) {
    throw new Error(`Governed RPC body delimiter missing: ${name}`)
  }
  const delimiter = delimiterMatch[1]
  const close = body.indexOf(delimiter, delimiterMatch.index + delimiterMatch[0].length)
  if (close < 0) throw new Error(`Governed RPC body close missing: ${name}`)
  const semicolon = body.indexOf(';', close + delimiter.length)
  if (semicolon < 0) throw new Error(`Governed RPC terminator missing: ${name}`)
  return body.slice(0, semicolon + 1)
}

function verifyRpcAuthority(
  container: string,
  password: string,
  copiedSql: string[],
): { installed: Record<string, string>; expected: Record<string, string> } {
  const definitions = GOVERNED_RPCS.map((name) => finalRpcDefinition(copiedSql, name).replace(
    new RegExp(`(function\\s+)public\\.${name}`, 'i'),
    `$1m10_e2_rpc_authority.${name}`,
  )).join('\n')
  const output = runPsql(container, password, `
    drop schema if exists m10_e2_rpc_authority cascade;
    create schema m10_e2_rpc_authority;
    ${definitions}
    with definitions as (
      select p.proname name, n.nspname,
        replace(pg_get_functiondef(p.oid), 'm10_e2_rpc_authority.', 'public.') canonical_definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','m10_e2_rpc_authority')
        and p.proname=any(array[${GOVERNED_RPCS.map((name) => `'${name}'`).join(',')}])
    ), hashes as (
      select name,nspname,encode(sha256(convert_to(canonical_definition,'UTF8')),'hex') hash
      from definitions
    )
    select json_build_object(
      'installed',json_object_agg(name,hash order by name) filter(where nspname='public'),
      'expected',json_object_agg(name,hash order by name) filter(where nspname='m10_e2_rpc_authority')
    ) from hashes;
    drop schema m10_e2_rpc_authority cascade;
  `)
  const hashes = JSON.parse(output.trim().split(/\r?\n/).find((line) => line.startsWith('{')) ?? '') as {
    installed: Record<string, string>
    expected: Record<string, string>
  }
  if (JSON.stringify(hashes.installed) !== JSON.stringify(hashes.expected)) {
    throw new Error(`Installed governed RPC authority mismatch; expected ${JSON.stringify(hashes.expected)}, observed ${JSON.stringify(hashes.installed)}`)
  }
  return hashes
}

function assertDedicatedCleanDatabase(container: string, password: string): void {
  const output = runPsql(container, password, `
    select json_build_object(
      'stories',(select count(*) from public.stories),
      'jobs',(select count(*) from public.generation_jobs),
      'leases',(select count(*) from public.generation_leases),
      'checkpoints',(select count(*) from public.chapter_generation_checkpoints),
      'commits',(select count(*) from public.chapter_state_commits)
    );
  `).trim()
  const counts = JSON.parse(output) as DedicatedDatabaseCounts
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new Error(`M10-E2 requires dedicated clean DB before mutation; observed ${JSON.stringify(counts)}`)
  }
}

function parseProof(stdout: string): SqlProofResult {
  const marker = 'M10_E2_TASK3_RESULT='
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(marker))
  if (!line) throw new Error(`Task 3 SQL proof returned no structured result\n${stdout}`)
  return JSON.parse(line.slice(marker.length)) as SqlProofResult
}

export async function runM10E2Task3LocalProofs(): Promise<SqlProofResult> {
  const governedProjectRoot = 'C:\\Users\\bimap\\.zcode\\tmp\\m10-e2-task3-supabase'
  const projectRoot = process.env.LAKOKU_E2_DISPOSABLE_PROJECT
  if (!projectRoot) throw new Error('LAKOKU_E2_DISPOSABLE_PROJECT is required')
  if (projectRoot.replaceAll('/', '\\').toLowerCase() !== governedProjectRoot.toLowerCase()) {
    throw new Error(`Governed disposable project root required, received ${projectRoot}`)
  }
  const status = localStatus(projectRoot)
  const config = localProjectConfig(projectRoot)
  if (config.projectId !== 'lakoku-m10-e2-task3'
    || config.apiPort !== '57321'
    || config.dbPort !== '57322') {
    throw new Error(`Governed disposable identity mismatch: ${JSON.stringify(config)}`)
  }
  const apiUrl = new URL(status.API_URL)
  if (apiUrl.port !== config.apiPort) {
    throw new Error(`Local API status port ${apiUrl.port} does not match config port ${config.apiPort}`)
  }
  const container = databaseContainer(status.DB_URL, config)
  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), 'local-db-proof.sql')
  const sql = readFileSync(sqlPath, 'utf8')
  const databaseUrl = new URL(status.DB_URL)
  const username = 'supabase_admin'
  const password = decodeURIComponent(databaseUrl.password)
  if (!password) throw new Error('Local Supabase DB_URL missing credentials')
  const authority = migrationAuthority(container, password, projectRoot)
  const rpcAuthority = verifyRpcAuthority(container, password, authority.copiedSql)
  assertDedicatedCleanDatabase(container, password)
  const runNonce = 'm10-e2-task3-run-v1'
  const variables = [
    '-v', `task3_db_user=${username}`, '-v', `task3_db_password=${password}`,
    '-v', `task3_project_id=${config.projectId}`, '-v', `task3_run_nonce=${runNonce}`,
  ]
  const cleanupPath = join(dirname(fileURLToPath(import.meta.url)), 'local-db-cleanup.sql')
  const cleanupSql = readFileSync(cleanupPath, 'utf8')
  let proofError: unknown
  try {
    const stdout = runPsql(container, password, sql, variables)
    const result = parseProof(stdout)
    const operationalIds: Partial<Record<E2ScenarioId, E2EvidenceRow['operational']>> = {
      STALE_LEASE_RECLAMATION: { jobId: 'e2040000-0000-4000-8000-000000000001', leaseId: 'e2040000-0000-4000-8000-000000000002' },
      PUBLICATION_V2_UNCERTAINTY_RETRY: { leaseId: 'e2100000-0000-4000-8000-000000000001' },
      PUBLICATION_V3_UNCERTAINTY_RETRY: { attemptId: 'e2110000-0000-4000-8000-000000000001', leaseId: 'e2110000-0000-4000-8000-000000000003' },
      PUBLICATION_V5_UNCERTAINTY_RETRY: { jobId: 'e2120000-0000-4000-8000-000000000001', leaseId: 'e2120000-0000-4000-8000-000000000002' },
      PUBLICATION_CONCURRENCY_SYNC_VS_WORKER: { jobId: 'e2130000-0000-4000-8000-000000000014', attemptId: 'e2130000-0000-4000-8000-000000000001', leaseId: 'e2130000-0000-4000-8000-000000000003' },
      TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT: { attemptId: 'e2140000-0000-4000-8000-000000000001', leaseId: 'e2140000-0000-4000-8000-000000000003' },
      TRANSACTION_ROLLBACK_AFTER_STATE_APPLIER_BEFORE_TERMINALIZATION: { jobId: 'e2150000-0000-4000-8000-000000000001', leaseId: 'e2150000-0000-4000-8000-000000000002' },
      STALE_CANON_REVISION: { jobId: 'e2160000-0000-4000-8000-000000000004', attemptId: 'e2160000-0000-4000-8000-000000000001', leaseId: 'e2160000-0000-4000-8000-000000000003' },
      COMMIT_LEDGER_PROVENANCE_MISMATCH: { jobId: 'e2170000-0000-4000-8000-000000000001', leaseId: 'e2170000-0000-4000-8000-000000000002' },
      NOTIFICATION_OUTBOX_FAILURE: { attemptId: 'e2190000-0000-4000-8000-000000000001', leaseId: 'e2190000-0000-4000-8000-000000000003' },
    }
    result.rows = result.rows.map((row) => ({
      ...row,
      operational: { ...row.operational, ...operationalIds[row.id] },
    }))
    if (result.rows.map((row) => row.id).join('|') !== TASK3_DB_SCENARIO_IDS.join('|')) {
      throw new Error('Task 3 SQL proof returned unexpected row order')
    }
    result.environment = {
      projectRoot: governedProjectRoot,
      projectId: config.projectId,
      apiPort: Number(config.apiPort),
      dbPort: Number(config.dbPort),
      container,
      containerLabels: {
        'com.docker.compose.project': config.projectId,
        'com.supabase.cli.project': config.projectId,
      },
      migrationManifest: authority.manifest,
      migrationFileHashes: authority.fileHashes,
      rpcDefinitionHashes: rpcAuthority.installed,
      expectedRpcDefinitionHashes: rpcAuthority.expected,
    }
    return result
  } catch (error) {
    proofError = error
    throw error
  } finally {
    try {
      runPsql(container, password, cleanupSql, variables)
    } catch (cleanupError) {
      if (!proofError) throw cleanupError
      throw new AggregateError([proofError, cleanupError], 'Task 3 proof and cleanup both failed')
    }
  }
}
