import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { E2_SCENARIO_IDS } from '../../lib/narrative-qa/fault/e2/catalog'
import { createWorkingTreeGitReader } from '../../lib/narrative-qa/fault/e2/git-metadata'
import { FIXTURE_E2_CLOSURE_REFERENCE, FIXTURE_E2_CLOSURE_SHA, FIXTURE_SPEC_SHA } from '../../fixtures/m10-e/reliability-contract-fixture'

import closureAuthorityJson from '../../fixtures/m10-e/e1-e2-closure-authority.json'

interface ClosureRow {
  readonly id: string
  readonly disposition: string
}

interface ClosureManifestEntry {
  readonly path: string
  readonly blobSha: string
}

interface ClosureAuthority {
  readonly authorityVersion: string
  readonly approvedSpecSha: string
  readonly e2ClosureSha: string
  readonly manifestBaseSha: string
  readonly e2Rows: readonly ClosureRow[]
  readonly protectedPaths: readonly ClosureManifestEntry[]
  readonly expectedFocusedTests: readonly string[]
  readonly faultFrequencyProhibition: string
  readonly replacementSemantics: string
}

const EXPECTED_PROTECTED_PATHS = Object.freeze([
  'lib/narrative-qa/fault/deps.ts',
  'lib/narrative-qa/fault/e2-bindings.ts',
  'lib/narrative-qa/fault/evidence.ts',
  'lib/narrative-qa/fault/index.ts',
  'lib/narrative-qa/fault/invariants.ts',
  'lib/narrative-qa/fault/provider.ts',
  'lib/narrative-qa/fault/scenarios.ts',
  'lib/narrative-qa/fault/e2/analytics-observability.ts',
  'lib/narrative-qa/fault/e2/artifacts.ts',
  'lib/narrative-qa/fault/e2/assembler.ts',
  'lib/narrative-qa/fault/e2/catalog.ts',
  'lib/narrative-qa/fault/e2/external-call-guard.ts',
  'lib/narrative-qa/fault/e2/gate.ts',
  'lib/narrative-qa/fault/e2/git-metadata.ts',
  'lib/narrative-qa/fault/e2/local-db-cleanup.sql',
  'lib/narrative-qa/fault/e2/local-db-proof.sql',
  'lib/narrative-qa/fault/e2/local-db.ts',
  'lib/narrative-qa/fault/e2/non-db.ts',
  'lib/narrative-qa/fault/e2/normalization.ts',
  'lib/narrative-qa/fault/e2/rows-1-9.ts',
  'lib/narrative-qa/fault/e2/taxonomy.ts',
  'scripts/m10-e-reliability.ts',
  'scripts/m10-e-reliability-cli.ts',
  'scripts/m10-e-reliability-e2-cli.ts',
  'tests/narrative-qa/m10-e1-fault-evidence.test.ts',
  'tests/narrative-qa/m10-e2-bindings.test.ts',
  'tests/narrative-qa/m10-e2-evidence.test.ts',
  'tests/narrative-qa/m10-e2-external-call-guard.test.ts',
  'tests/narrative-qa/m10-e2-reset-cleanup.test.ts',
  'tests/narrative-qa/m10-e2-rows-1-9.test.ts',
  'tests/narrative-qa/m10-e2-runner.test.ts',
  'tests/narrative-qa/m10-e2-telemetry-reference.test.ts',
  'tests/db/m10-e1-disposable-cleanup-auth-regression.test.ts',
  'tests/db/m10-e2-task3-local-proof.test.ts',
])

const PROVEN_REFERENCE_ROWS = Object.freeze([
  'CHECKPOINT_SCHEMA_MISMATCH', 'CHECKPOINT_STATE_DELTA_HASH_MISMATCH', 'ANALYTICS_OBSERVABILITY_INJECTED',
])

function gitObjectExists(sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Closure verification used by the regression test. Mirrors the authority's
 * replacement semantics: any byte difference between a current protected blob
 * and the approved manifest is a FAIL; no semantic-compatibility substitute and
 * no dynamically accepted current-HEAD additions are permitted.
 */
function verifyClosureManifest(authority: ClosureAuthority): Promise<readonly string[]> {
  const git = createWorkingTreeGitReader()
  return (async () => {
    const failures: string[] = []
    if (!/^[0-9a-f]{40}$/.test(authority.manifestBaseSha)) failures.push('manifest base SHA must be a full 40-hex Git object id')
    if (new Set(authority.protectedPaths.map((entry) => entry.path)).size !== authority.protectedPaths.length) {
      failures.push('manifest contains duplicate protected paths')
    }
    const manifestPaths = new Set(authority.protectedPaths.map((entry) => entry.path))
    if (manifestPaths.size !== EXPECTED_PROTECTED_PATHS.length
      || EXPECTED_PROTECTED_PATHS.some((path) => !manifestPaths.has(path))) {
      failures.push('manifest protected path set must equal the frozen protected path set exactly')
    }
    const exercised = new Set<string>()
    for (const entry of authority.protectedPaths) {
      if (!/^[0-9a-f]{40}$/.test(entry.blobSha)) failures.push(`manifest blob SHA invalid for ${entry.path}`)
      if (exercised.has(entry.path)) failures.push(`duplicate manifest entry ${entry.path}`)
      exercised.add(entry.path)
      const current = await git.readBlobSha(entry.path, 'HEAD')
      let base: string
      try {
        base = await git.readBlobSha(entry.path, authority.manifestBaseSha)
      } catch {
        base = ''
      }
      if (current !== entry.blobSha || base !== entry.blobSha) {
        failures.push(`protected blob ${entry.path} differs from approved manifest blob`)
      }
    }
    if (authority.e2Rows.length !== E2_SCENARIO_IDS.length
      || authority.e2Rows.some((row, index) => row.id !== E2_SCENARIO_IDS[index])) {
      failures.push('E2 row catalog id/order must match the frozen E2 scenario order')
    }
    const dispositions = new Map(authority.e2Rows.map((row) => [row.id, row.disposition] as const))
    const executed = authority.e2Rows.filter((row) => row.disposition === 'EXECUTED').length
    const proven = authority.e2Rows.filter((row) => row.disposition === 'PROVEN_REFERENCE').length
    if (executed !== 16 || proven !== 3) failures.push('E2 dispositions must be exactly 16 EXECUTED and 3 PROVEN_REFERENCE')
    for (const id of PROVEN_REFERENCE_ROWS) {
      if (dispositions.get(id) !== 'PROVEN_REFERENCE') failures.push(`row ${id} must carry PROVEN_REFERENCE disposition`)
    }
    if (authority.expectedFocusedTests.length !== 10) failures.push('expected focused E1/E2 test list must contain exactly 10 entries')
    for (const testPath of authority.expectedFocusedTests) {
      if (!manifestPaths.has(testPath)) failures.push(`focused test ${testPath} missing from protected manifest`)
    }
    const protectedTestPaths = authority.protectedPaths.map((entry) => entry.path).filter((path) => path.startsWith('tests/'))
    if (protectedTestPaths.length !== 10
      || protectedTestPaths.some((path) => !authority.expectedFocusedTests.includes(path))) {
      failures.push('every protected test path must appear in the expected focused test list')
    }
    const faultPaths = authority.protectedPaths.map((entry) => entry.path).filter((path) => path.startsWith('lib/narrative-qa/fault/'))
    if (faultPaths.length !== 21) failures.push('protected fault paths must cover all 21 frozen E1/E2 fault files')
    return failures
  })()
}

describe('M10-E E1/E2 closure authority regression', () => {
  const authority = closureAuthorityJson as unknown as ClosureAuthority

  it('freezes spec and E2 closure SHAs that resolve as real Git commits', () => {
    expect(authority.authorityVersion).toBe('M10_E_E1_E2_CLOSURE_AUTHORITY_V1')
    expect(authority.approvedSpecSha).toBe(FIXTURE_SPEC_SHA)
    expect(authority.approvedSpecSha).toBe('af28b45dcd62544f12415476aa62bd3a09fd8f7e')
    expect(authority.e2ClosureSha).toBe(FIXTURE_E2_CLOSURE_SHA)
    expect(authority.e2ClosureSha).toBe('914cf30f42d4e7f293df79e0d66c014331a696ba')
    expect(FIXTURE_E2_CLOSURE_REFERENCE).toMatch(/^[0-9a-f]{64}$/)
    expect(gitObjectExists(authority.approvedSpecSha)).toBe(true)
    expect(gitObjectExists(authority.e2ClosureSha)).toBe(true)
    expect(gitObjectExists(authority.manifestBaseSha)).toBe(true)
  })

  it('binds every frozen protected E1/E2 blob through the manifest base with no current-HEAD additions', async () => {
    const failures = await verifyClosureManifest(authority)
    expect(failures).toEqual([])
    const raw = readFileSync(resolve(process.cwd(), 'fixtures/m10-e/e1-e2-closure-authority.json'), 'utf8')
    expect(raw).toContain('FAIL and STOP')
    expect(raw).toContain('old blob')
    expect(raw).toContain('new blob')
    expect(raw).toContain('replacement SHA')
  })

  it('rejects any manifest deviation as FAIL with no semantic-compatibility substitute', async () => {
    type Mutable<T> = { -readonly [K in keyof T]: T[K] }
    const mutateClone = (mutator: (authority: Mutable<ClosureAuthority>) => void): Mutable<ClosureAuthority> => {
      const copy = JSON.parse(JSON.stringify(closureAuthorityJson)) as unknown as Mutable<ClosureAuthority>
      mutator(copy)
      return copy
    }
    const changedBlob = mutateClone((copy) => {
      copy.protectedPaths = copy.protectedPaths.map((entry) => entry.path === 'lib/narrative-qa/fault/e2/catalog.ts'
        ? { ...entry, blobSha: 'f'.repeat(40) }
        : entry)
    })
    expect((await verifyClosureManifest(changedBlob))[0]).toContain('differs from approved manifest blob')
    const missingPath = mutateClone((copy) => {
      copy.protectedPaths = copy.protectedPaths.filter((entry) => entry.path !== 'scripts/m10-e-reliability-e2-cli.ts')
    })
    expect((await verifyClosureManifest(missingPath))[0]).toContain('protected path set')
    const extraPath = mutateClone((copy) => {
      copy.protectedPaths = [...copy.protectedPaths, { path: 'lib/narrative-qa/scoring/canonical-serializer.ts', blobSha: '1'.repeat(40) }]
    })
    expect((await verifyClosureManifest(extraPath)).some((failure) => failure.includes('protected path set'))).toBe(true)
    const reorderedRows = mutateClone((copy) => {
      copy.e2Rows = [...copy.e2Rows.slice(1), copy.e2Rows[0]!]
    })
    expect((await verifyClosureManifest(reorderedRows))[0]).toContain('id/order')
    const wrongDisposition = mutateClone((copy) => {
      copy.e2Rows = copy.e2Rows.map((row) => row.id === 'CHECKPOINT_SCHEMA_MISMATCH' ? { ...row, disposition: 'EXECUTED' } : row)
    })
    expect((await verifyClosureManifest(wrongDisposition))[0]).toContain('PROVEN_REFERENCE')
    const addedFocusedTest = mutateClone((copy) => {
      copy.expectedFocusedTests = [...copy.expectedFocusedTests, 'tests/narrative-qa/m10-e-reliability-fixture.test.ts']
    })
    expect((await verifyClosureManifest(addedFocusedTest))[0]).toContain('exactly 10')
    const omittedFocusedTest = mutateClone((copy) => {
      copy.expectedFocusedTests = copy.expectedFocusedTests.filter((path) => path !== 'tests/db/m10-e2-task3-local-proof.test.ts')
    })
    expect((await verifyClosureManifest(omittedFocusedTest))[0]).toContain('exactly 10')
  }, 300_000)

  it('keeps both governed DB regressions manifest-bound to the exact disposable target', async () => {
    const dbTests = ['tests/db/m10-e1-disposable-cleanup-auth-regression.test.ts', 'tests/db/m10-e2-task3-local-proof.test.ts']
    const manifestPaths = new Map(authority.protectedPaths.map((entry) => [entry.path, entry.blobSha] as const))
    for (const dbTest of dbTests) {
      expect(manifestPaths.has(dbTest)).toBe(true)
      expect(authority.expectedFocusedTests).toContain(dbTest)
    }
    const git = createWorkingTreeGitReader()
    const task3Content = await git.readBlobContent('tests/db/m10-e2-task3-local-proof.test.ts', 'HEAD')
    expect(task3Content).toContain('m10-e2-task3-supabase')
    expect(task3Content).toContain('assertM10E2DisposableCleanDatabase')
  })
})