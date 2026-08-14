// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertLoopbackDatabaseUrl,
  runM10E2Task3LocalProofs,
  TASK3_DB_SCENARIO_IDS,
} from '../../lib/narrative-qa/fault/e2/local-db'

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
})
