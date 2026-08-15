import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import { createWorkingTreeGitReader } from '../../lib/narrative-qa/fault/e2/git-metadata'
import {
  projectTelemetryObservations,
  type TelemetryProjectionResult,
} from '../../lib/narrative-qa/reliability/server/telemetry-adapter.server'
import {
  buildReliabilityObservationFixture,
  FIXTURE_E2_CLOSURE_SHA,
  FIXTURE_SPEC_SHA,
} from '../../fixtures/m10-e/reliability-contract-fixture'
import {
  FORBIDDEN_ENVIRONMENT_AUTHORITY_VARS,
  M10_E_E3A_E4_ITERATIONS,
  M10_E_ARTIFACT_ROOT,
  M10_E_COST_REPORT_FILE,
  M10_E_NORMALIZED_ARTIFACT_FILE,
  M10_E_RAW_ARTIFACT_FILE,
  RELEASE_EVIDENCE_NOT_AUTHORIZED,
  assertNoEnvironmentAuthorityOverride,
  executeM10EE3AE4,
  type M10EE3AE4GitReader,
} from '../../scripts/m10-e-e3a-e4'

vi.mock('server-only', () => ({}))

const CLOSURE_AUTHORITY_JSON = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/m10-e/e1-e2-closure-authority.json'), 'utf8'))

function fakeGit(overrides: Partial<M10EE3AE4GitReader> = {}): M10EE3AE4GitReader & { calls: string[] } {
  const calls: string[] = []
  // The frozen closure authority binds SHAs and protected blobs; the fake
  // honors them so tests exercising later steps reach their target gate.
  const authority = CLOSURE_AUTHORITY_JSON as {
    manifestBaseSha?: unknown
    protectedPaths?: readonly Readonly<{ path?: string; blobSha?: string }>[]
  }
  const expectedBlobs = new Map<string, string>(
    (authority.protectedPaths ?? []).flatMap((entry) => entry.path !== undefined && entry.blobSha !== undefined ? [[entry.path, entry.blobSha]] : []),
  )
  return {
    calls,
    async readHeadSha() { calls.push('readHeadSha'); return 'a'.repeat(40) },
    async readWorkingTreeDirty() { calls.push('readWorkingTreeDirty'); return false },
    async readBlobSha(path: string) { calls.push('readBlobSha'); return expectedBlobs.get(path) ?? 'f'.repeat(40) },
    async readCommitExists(sha: string) {
      calls.push('readCommitExists')
      return sha === FIXTURE_SPEC_SHA || sha === FIXTURE_E2_CLOSURE_SHA || sha === authority.manifestBaseSha
    },
    async isAncestor(_base: string, _head: string) { calls.push('isAncestor'); return true },
    ...overrides,
  }
}

function fakeTelemetry() {
  return vi.fn((_request: unknown): TelemetryProjectionResult => ({
    source: 'CONTRACT_FIXTURE',
    observations: { state: 'PRESENT', value: undefined } as unknown as TelemetryProjectionResult['observations'],
    counters: { reads: 0, mutations: 0, providerCalls: 0, networkActions: 0 },
  }))
}

function baseRunnerInput(git: M10EE3AE4GitReader & { calls: string[] }) {
  return { git, telemetry: fakeTelemetry(), now: () => new Date('2026-08-15T12:00:00.000Z'), executionInstanceId: 'run-test-0001' }
}

function realGit() {
  const reader = createWorkingTreeGitReader(process.cwd(), execFileSync)
  return {
    ...reader,
    // The tree gate is asserted separately with the fake reader; full-pipeline
    // tests run against the live tree where development files are untracked.
    async readWorkingTreeDirty(): Promise<boolean> {
      return false
    },
    async readCommitExists(sha: string): Promise<boolean> {
      try {
        execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
          cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return true
      } catch {
        return false
      }
    },
    async isAncestor(base: string, head: string): Promise<boolean> {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', base, head], {
          cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return true
      } catch {
        return false
      }
    },
  }
}

async function runSuccessfully(wantsTelemetry = true) {
  // The projection must hold real, schema-valid observations for the pipeline to complete;
  // the positive path uses the real fixture through the real adapter projection and the
  // real working-tree git reader so frozen closure authorities and protected blobs bind.
  const { buildReliabilityObservationFixture } = await import('../../fixtures/m10-e/reliability-contract-fixture')
  const { projectTelemetryObservations } = await import('../../lib/narrative-qa/reliability/server/telemetry-adapter.server')
  const telemetry = wantsTelemetry ? projectTelemetryObservations : fakeTelemetry()
  return executeM10EE3AE4({
    git: realGit(),
    telemetry,
    now: () => new Date('2026-08-15T12:00:00.000Z'),
    executionInstanceId: 'run-test-0001',
    fixture: buildReliabilityObservationFixture(),
    closureAuthorityJson: CLOSURE_AUTHORITY_JSON,
  })
}

describe('M10-E E3A/E4 runner orchestration', () => {
  it('runs the full pipeline in order with a single Git identity capture and exact status output', async () => {
    const written: Array<{ directory: string; file: string }> = []
    const git = fakeGit()
    const result = await executeM10EE3AE4({
      git,
      telemetry: projectTelemetryObservations,
      now: () => new Date('2026-08-15T12:00:00.000Z'),
      executionInstanceId: 'run-test-0001',
      fixture: buildReliabilityObservationFixture(),
      closureAuthorityJson: CLOSURE_AUTHORITY_JSON,
      writeArtifacts: (directory, files) => {
        for (const file of files) written.push({ directory, file: file.path })
      },
    })
    expect(git.calls.filter((call) => call === 'readHeadSha')).toHaveLength(1)
    expect(git.calls.filter((call) => call === 'readWorkingTreeDirty')).toHaveLength(1)
    expect(git.calls[0]).toBe('readHeadSha')
    expect(git.calls[1]).toBe('readWorkingTreeDirty')
    expect(git.calls).toContain('readCommitExists')
    expect(git.calls).toContain('isAncestor')
    expect(git.calls).toContain('readBlobSha')
    expect(result.status.executionInstanceId).toBe('run-test-0001')
    expect(result.status.baseGitSha).toBe('a'.repeat(40))
    expect(result.status.workingTreeDirty).toBe(false)
    expect(result.status.stagePoolObserved).toBe(11)
    expect(result.status.stagePoolExpected).toBe(11)
    expect(result.status.chapterStageCellObserved).toBe(452)
    expect(result.status.chapterStageCellExpected).toBe(452)
    expect(result.status.generationDistributionKeysObserved).toBe(250)
    expect(result.status.judgeDistributionKeysObserved).toBe(24)
    expect(result.status.modeledIterations).toBe(M10_E_E3A_E4_ITERATIONS)
    expect(result.status.modeledChapterMeans).toBe(50)
    expect(result.status.successfulIterationCount + result.status.failedIterationCount).toBe(M10_E_E3A_E4_ITERATIONS)
    expect(result.status.startedIterationCount).toBe(M10_E_E3A_E4_ITERATIONS)
    expect(result.status.comparatorEligible).toBe(10)
    expect(result.status.comparatorIncluded).toBe(10)
    expect(result.status.comparatorExcluded).toBe(0)
    expect(result.status.e2RowsObserved).toBe(19)
    expect(result.status.duplicatePublicationCount).toBe(0)
    expect(result.status.canonicalCorruptionCount).toBe(0)
    expect(result.status.engineeringGate).toBe('PASS')
    expect(result.status.releaseReadiness).toBe('HOLD')
    expect(result.status.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    expect(result.pair.reportHash).toBe(result.status.reportHash)
    expect(result.pair.artifactSemanticHash).toBe(result.status.artifactSemanticHash)
    expect(written.map((item) => item.file)).toEqual([M10_E_RAW_ARTIFACT_FILE, M10_E_NORMALIZED_ARTIFACT_FILE, M10_E_COST_REPORT_FILE])
    expect(written[0]!.directory.replaceAll('\\', '/').endsWith('.zcode/artifacts/m10-e-e3a-e4/run-test-0001')).toBe(true)
  }, 300_000)

  it('rejects a dirty tree before any closure, environment, or telemetry work beyond Git identity', async () => {
    const git = fakeGit({ readWorkingTreeDirty: () => { git.calls.push('dirty-check'); return Promise.resolve(true) } })
    const telemetry = fakeTelemetry()
    await expect(executeM10EE3AE4({ ...baseRunnerInput(git), telemetry, closureAuthorityJson: CLOSURE_AUTHORITY_JSON })).rejects.toThrow('M10E_E3A_E4_DIRTY_TREE_STOP')
    expect(telemetry).not.toHaveBeenCalled()
    expect(git.calls).not.toContain('readCommitExists')
  })

  it('rejects a release profile before any git read, environment read, or telemetry call', async () => {
    const git = fakeGit()
    const telemetry = fakeTelemetry()
    await expect(executeM10EE3AE4({ executionProfile: 'RELEASE_EVIDENCE', git, telemetry })).rejects.toThrow(RELEASE_EVIDENCE_NOT_AUTHORIZED)
    expect(git.calls).toHaveLength(0)
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('rejects environment-supplied E0/provider/Supabase authority and ignores unrelated provider keys', () => {
    const full = { SUPABASE_URL: 'http://127.0.0.1:54321' }
    expect(() => assertNoEnvironmentAuthorityOverride(full)).toThrow(FORBIDDEN_ENVIRONMENT_AUTHORITY_VARS[0])
    const e0 = { LAKOKU_E0_AUTHORITY: 'approval' }
    expect(() => assertNoEnvironmentAuthorityOverride(e0)).toThrow('LAKOKU_E0_AUTHORITY')
    const ignored = { OPENAI_API_KEY: 'sk-test', NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:3000' }
    expect(() => assertNoEnvironmentAuthorityOverride(ignored)).not.toThrow()
    expect(() => assertNoEnvironmentAuthorityOverride({})).not.toThrow()
  })

  it('rejects environment authority override before the telemetry projection', async () => {
    const git = fakeGit()
    const telemetry = fakeTelemetry()
    await expect(executeM10EE3AE4({
      ...baseRunnerInput(git),
      telemetry,
      closureAuthorityJson: CLOSURE_AUTHORITY_JSON,
      environment: { SUPABASE_URL: 'http://127.0.0.1:54321' },
    })).rejects.toThrow('M10E_E3A_E4_ENVIRONMENT_AUTHORITY_REJECTED')
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('never writes artifacts on any failure', async () => {
    const writeArtifacts = vi.fn()
    const git = fakeGit({ readHeadSha: () => { git.calls.push('bad-head'); return Promise.reject(new Error('no git')) } })
    await expect(executeM10EE3AE4({ git, writeArtifacts, closureAuthorityJson: CLOSURE_AUTHORITY_JSON })).rejects.toThrow()
    expect(writeArtifacts).not.toHaveBeenCalled()
    const failedClosure = fakeGit({ readCommitExists: () => Promise.resolve(false) })
    await expect(executeM10EE3AE4({ git: failedClosure, writeArtifacts, closureAuthorityJson: CLOSURE_AUTHORITY_JSON })).rejects.toThrow('M10E_E3A_E4_CLOSURE_AUTHORITY_FAILED')
    expect(writeArtifacts).not.toHaveBeenCalled()
  })

  it('rejects an unsafe projection (nonzero counters, wrong source, or missing observations)', async () => {
    const git = fakeGit()
    const nonzero = vi.fn(() => ({
      source: 'CONTRACT_FIXTURE', observations: { state: 'PRESENT', value: undefined },
      counters: { reads: 1, mutations: 0, providerCalls: 0, networkActions: 0 },
    }))
    await expect(executeM10EE3AE4({ ...baseRunnerInput(git), telemetry: nonzero as never, closureAuthorityJson: CLOSURE_AUTHORITY_JSON })).rejects.toThrow('M10E_E3A_E4_UNSAFE_PROJECTION: non-zero telemetry counters')
    const wrongSource = vi.fn(() => ({
      source: 'GOVERNED_DISPOSABLE_LOCAL', observations: { state: 'PRESENT', value: undefined },
      counters: { reads: 0, mutations: 0, providerCalls: 0, networkActions: 0 },
    }))
    await expect(executeM10EE3AE4({ ...baseRunnerInput(git), telemetry: wrongSource as never, closureAuthorityJson: CLOSURE_AUTHORITY_JSON })).rejects.toThrow('M10E_E3A_E4_UNSAFE_PROJECTION: source mislabeled')
  })

  it('embeds a semantic payload whose recomputation binds every embedded hash and gate', async () => {
    const result = await runSuccessfully()
    const payload = result.pair.normalized.semantic
    const { artifactSemanticHash: _artifactSemanticHash, ...hashDagPayload } = payload
    expect(payload.artifactSemanticHash).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.artifactSemanticHash).toBe(computeSha256(stableStringify(hashDagPayload)))
    expect(payload.sourceAuthority).toBe('CONTRACT_FIXTURE')
    expect(payload.e2ClosureReference).toBe(computeSha256(FIXTURE_E2_CLOSURE_SHA))
    expect(result.pair.normalized.normalization.removedOperationalFields).toEqual([
      'startedAt', 'finishedAt', 'elapsedMilliseconds', 'artifactDirectoryPath',
    ])
    expect(result.pair.normalized.execution.executionInstanceId).toMatch(/^execution-[0-9]{4}$/)
    // artifactDirectory points under the stable E3A/E4 artifact root
    expect(result.status.artifactDirectory).toContain(M10_E_ARTIFACT_ROOT)
  }, 300_000)

  it('runs the same result twice with identical deterministic hashes', async () => {
    const first = await runSuccessfully()
    const second = await runSuccessfully()
    expect(second.pair.artifactSemanticHash).toBe(first.pair.artifactSemanticHash)
    expect(second.pair.reportHash).toBe(first.pair.reportHash)
    expect(second.reportBytes).toBe(first.reportBytes)
    expect(stableStringify(second.pair.normalized)).toBe(stableStringify(first.pair.normalized))
  }, 300_000)
})