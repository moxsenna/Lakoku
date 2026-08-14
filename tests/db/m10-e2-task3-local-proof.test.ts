// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertLoopbackDatabaseUrl,
  assertM10E2DisposableCleanDatabase,
  runM10E2Task3LocalProofs,
  TASK3_DB_SCENARIO_IDS,
} from '../../lib/narrative-qa/fault/e2/local-db'
import { E2_SCENARIO_IDS } from '../../lib/narrative-qa/fault/e2/catalog'
import { evaluateE2Gate } from '../../lib/narrative-qa/fault/e2/gate'
import type { E2EvidenceRow } from '../../lib/narrative-qa/fault/e2/taxonomy'

describe('M10-E2 Task 3 local DB proof guard', () => {
  test.each([
    'postgresql://postgres:postgres@db.example.com:5432/postgres',
    'postgresql://postgres:postgres@10.0.0.2:5432/postgres',
    'https://project.supabase.co',
  ])('rejects non-loopback target before mutation: %s', (url) => {
    expect(() => assertLoopbackDatabaseUrl(url)).toThrow(/loopback/i)
  })

  test.each([
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
    'postgresql://postgres:postgres@localhost:55322/postgres',
  ])('accepts loopback target: %s', (url) => {
    expect(() => assertLoopbackDatabaseUrl(url)).not.toThrow()
  })
})

function expectedMigrationHashes(): Record<string, string> {
  const root = join(process.cwd(), 'supabase', 'migrations')
  return Object.fromEntries(readdirSync(root).filter((name) => name.endsWith('.sql')).sort().map((name) => [
    name,
    createHash('sha256').update(readFileSync(join(root, name))).digest('hex'),
  ]))
}

function dblinkPresent(): boolean {
  return execFileSync('docker', [
    'exec', '-e', 'PGPASSWORD=postgres', 'supabase_db_lakoku-m10-e2-task3',
    'psql', '-X', '-A', '-t', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres',
    '-c', "select exists(select 1 from pg_extension where extname='dblink')",
  ], { encoding: 'utf8' }).trim() === 't'
}

function setDblink(present: boolean): void {
  execFileSync('docker', [
    'exec', '-e', 'PGPASSWORD=postgres', 'supabase_db_lakoku-m10-e2-task3',
    'psql', '-X', '-A', '-t', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', present
      ? 'create extension if not exists dblink with schema extensions'
      : 'drop extension if exists dblink',
  ])
}

function runDisposableSql(input: string, variables: string[] = []): string {
  return execFileSync('docker', [
    'exec', '-i', '-e', 'PGPASSWORD=postgres', 'supabase_db_lakoku-m10-e2-task3',
    'psql', '-X', '-A', '-t', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', ...variables,
  ], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

describe.skipIf(process.env.LAKOKU_LOCAL_DB_TEST !== '1')('M10-E2 Task 3 local DB proofs', () => {
  test('executes rows 4, 10-17, and 19 with complete reset proof', async () => {
    const result = await runM10E2Task3LocalProofs()

    expect(result.rows.map((row) => row.id)).toEqual(TASK3_DB_SCENARIO_IDS)
    expect(result.rows.every((row) => row.proof.disposition === 'EXECUTED')).toBe(true)
    expect(result.environment).toMatchObject({
      projectRoot: 'C:\\Users\\bimap\\.zcode\\tmp\\m10-e2-task3-supabase',
      projectId: 'lakoku-m10-e2-task3',
      apiPort: 57321,
      dbPort: 57322,
      container: 'supabase_db_lakoku-m10-e2-task3',
      containerLabels: {
        'com.docker.compose.project': 'lakoku-m10-e2-task3',
        'com.supabase.cli.project': 'lakoku-m10-e2-task3',
      },
    })
    const expectedFileHashes = expectedMigrationHashes()
    expect(result.environment.migrationFileHashes).toEqual(expectedFileHashes)
    expect(result.environment.migrationManifest).toEqual(
      Object.keys(expectedFileHashes).map((name) => name.slice(0, -4)),
    )
    expect(Object.keys(result.environment.rpcDefinitionHashes).sort()).toEqual([
      'claim_generation_job_v1',
      'publish_chapter_state_v3',
      'publish_chapter_v2',
      'publish_generation_job_chapter_v5',
      'recover_stale_generation_jobs_v1',
    ])
    expect(result.environment.rpcDefinitionHashes).toEqual(
      result.environment.expectedRpcDefinitionHashes,
    )
    const observations = new Set<string>()
    const measurements = new Set<string>()
    for (const row of result.rows) {
      expect(row.operational?.observedAt).toSatisfy((value: string) => !Number.isNaN(Date.parse(value)))
      expect(row.operational?.latencyMs).toBeGreaterThanOrEqual(0)
      observations.add(row.operational?.observedAt ?? '')
      measurements.add(`${row.operational?.observedAt}:${row.operational?.latencyMs}`)
      expect(row.proof, row.id).toMatchObject({
        disposition: 'EXECUTED',
        injectionReached: true,
        recovered: true,
      })
      if (row.proof.disposition === 'EXECUTED') {
        expect(row.proof.observedOutcome, row.id).toBe(row.proof.expectedOutcome)
        expect(
          row.proof.immediateInvariants.every((invariant) => invariant.passed),
          row.id,
        ).toBe(true)
        expect(
          row.proof.recoveryInvariants?.every((invariant) => invariant.passed),
          row.id,
        ).toBe(true)
      }
    }
    expect(observations.size).toBe(TASK3_DB_SCENARIO_IDS.length)
    expect(measurements.size).toBe(TASK3_DB_SCENARIO_IDS.length)
    expect(result.rows.every((row) => Boolean(
      row.operational?.jobId || row.operational?.attemptId || row.operational?.leaseId,
    ))).toBe(true)
    expect(result.rows.find((row) => row.id === 'STALE_LEASE_RECLAMATION')?.operational).toMatchObject({
      jobId: 'e2040000-0000-4000-8000-000000000001',
      leaseId: 'e2040000-0000-4000-8000-000000000002',
    })
    expect(result.rows.find((row) => row.id === 'NOTIFICATION_OUTBOX_FAILURE')?.operational).toMatchObject({
      attemptId: 'e2190000-0000-4000-8000-000000000001',
      leaseId: 'e2190000-0000-4000-8000-000000000003',
    })
    expect(result.resetProof).toEqual({
      completed: true,
      targets: [{
        target: 'm10-e2-task3-local-db',
        resetApplied: true,
        cleanStateVerified: true,
      }],
    })
    expect(result.safetyCounters).toEqual({
      duplicatePublicationCount: 0,
      canonicalCorruptionCount: 0,
      unboundedRetryCount: 0,
    })

    const mutatedRows = result.rows.map((row, index): E2EvidenceRow => index === 0 && row.proof.disposition === 'EXECUTED'
      ? { ...row, proof: { ...row.proof, observedOutcome: 'OBSERVED_INVARIANT_FAILURE' } }
      : row)
    const mutatedSha = 'b'.repeat(40)
    const mutatedIds = new Set(mutatedRows.map((row) => row.id))
    const mutatedFixtures = E2_SCENARIO_IDS.filter((id) => !mutatedIds.has(id)).map((id): E2EvidenceRow => ({
      id,
      proof: { disposition: 'N/A_PROVEN', callPathProof: {
        entrypoint: 'fixture', exactCallPath: ['fixture'], inspectedCurrentSources: ['fixture'], terminalFinding: 'fixture',
      } },
    }))
    expect(evaluateE2Gate({
      version: 'm10-e2-fault-evidence/v1', baseGitSha: mutatedSha, workingTreeDirty: false,
      seed: 'm10-e2-seed-v1', faultSchedule: [...E2_SCENARIO_IDS], rows: [...mutatedFixtures, ...mutatedRows]
        .sort((a, b) => E2_SCENARIO_IDS.indexOf(a.id) - E2_SCENARIO_IDS.indexOf(b.id)),
      safetyCounters: result.safetyCounters, resetProof: result.resetProof,
      e1Regression: { baseGitSha: mutatedSha, result: 'PASS' },
    }).failures).toContain('STALE_LEASE_RECLAMATION: EXECUTED expected and observed outcomes differ')

    const task3Ids = new Set(result.rows.map((row) => row.id))
    const fixtureRows = E2_SCENARIO_IDS.filter((id) => !task3Ids.has(id)).map((id): E2EvidenceRow => ({
      id,
      proof: {
        disposition: 'N/A_PROVEN',
        callPathProof: {
          entrypoint: 'fixture', exactCallPath: ['fixture'], inspectedCurrentSources: ['fixture'], terminalFinding: 'fixture',
        },
      },
    }))
    const sha = 'a'.repeat(40)
    const partialGate = evaluateE2Gate({
      version: 'm10-e2-fault-evidence/v1', baseGitSha: sha, workingTreeDirty: false,
      seed: 'm10-e2-seed-v1', faultSchedule: [...E2_SCENARIO_IDS], rows: [...fixtureRows, ...result.rows]
        .sort((a, b) => E2_SCENARIO_IDS.indexOf(a.id) - E2_SCENARIO_IDS.indexOf(b.id)),
      safetyCounters: result.safetyCounters, resetProof: result.resetProof,
      e1Regression: { baseGitSha: sha, result: 'PASS' },
    })
    expect(partialGate.result).toBe('FAIL')
    expect(partialGate.failures).toContain(
      'MALFORMED_CHOICES_OUTPUT: disposition must be EXECUTED, observed N/A_PROVEN',
    )
  }, 120_000)

  test.each([true, false])('restores exact dblink pre-state after fresh cleanup: %s', async (initiallyPresent) => {
    const original = dblinkPresent()
    try {
      setDblink(initiallyPresent)
      expect(dblinkPresent()).toBe(initiallyPresent)
      await runM10E2Task3LocalProofs()
      expect(dblinkPresent()).toBe(initiallyPresent)
    } finally {
      setDblink(original)
    }
  }, 120_000)

  test('rejects unexpected same-prefix trigger without deleting it', async () => {
    assertM10E2DisposableCleanDatabase()
    const triggerName = 'm10_e2_task3_unowned_mutation'
    const cleanupSql = readFileSync(join(
      process.cwd(), 'lib', 'narrative-qa', 'fault', 'e2', 'local-db-cleanup.sql',
    ), 'utf8')
    const variables = [
      '-v', 'task3_run_nonce=m10-e2-task3-run-v1',
      '-v', 'task3_project_id=lakoku-m10-e2-task3',
    ]
    try {
      runDisposableSql(`
        create function public.${triggerName}() returns trigger language plpgsql as $$
        begin return new; end
        $$;
        create trigger ${triggerName} before insert on public.outbox
        for each row execute function public.${triggerName}();
      `)
      expect(() => runDisposableSql(cleanupSql, variables)).toThrow(/M10_E2_TASK3_UNEXPECTED_PREFIX_TRIGGER/)
      expect(runDisposableSql(`
        select exists(
          select 1 from pg_trigger t
          join pg_class c on c.oid=t.tgrelid
          join pg_namespace n on n.oid=c.relnamespace
          where not t.tgisinternal and t.tgname='${triggerName}'
            and n.nspname='public' and c.relname='outbox'
        )
      `).trim()).toBe('t')
    } finally {
      runDisposableSql(`
        drop trigger if exists ${triggerName} on public.outbox;
        drop function if exists public.${triggerName}();
      `)
      assertM10E2DisposableCleanDatabase()
    }
  }, 120_000)
})
