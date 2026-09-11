import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { assembleE2Evidence, assembleE2Rows } from '../../lib/narrative-qa/fault/e2/assembler'
import { E2_SCENARIO_IDS } from '../../lib/narrative-qa/fault/e2/catalog'
import { createGitMetadataReader } from '../../lib/narrative-qa/fault/e2/git-metadata'
import { hashNormalizedE2Evidence, normalizeE2Evidence } from '../../lib/narrative-qa/fault/e2/normalization'
import type { E2EvidenceRow, E2ScenarioId } from '../../lib/narrative-qa/fault/e2/taxonomy'
import {
  executeM10E2,
  runM10E1Cli,
  validateE2ArtifactPair,
  type E1ExecutionResult,
} from '../../scripts/m10-e-reliability'
import { runFaultMatrixWithCleanup } from '../../lib/narrative-qa/fault/scenarios'

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
function row(id: E2ScenarioId): E2EvidenceRow {
  return { id, proof: { disposition: 'N/A_PROVEN', callPathProof: { entrypoint: 'proof', exactCallPath: ['proof'], inspectedCurrentSources: ['source.ts'], terminalFinding: 'not applicable' } } }
}
function e1(result: 'PASS' | 'FAIL' = 'PASS', sha = SHA): E1ExecutionResult {
  return {
    evidence: { baseGitSha: sha } as E1ExecutionResult['evidence'],
    gate: { result, failures: [] },
    normalized: {} as E1ExecutionResult['normalized'],
    normalizedHash: 'hash',
    resetProof: { completed: true, targets: [{ target: 'e1-db', resetApplied: true, cleanStateVerified: true }] },
  }
}
function deps(overrides: Partial<Parameters<typeof executeM10E2>[0]> = {}) {
  const calls: string[] = []
  return { calls, value: {
    git: { readHeadSha: vi.fn(async () => { calls.push('head'); return SHA }), readWorkingTreeDirty: vi.fn(async () => { calls.push('dirty'); return false }) },
    executeE1: vi.fn(async (sha: string) => { calls.push(`e1:${sha}`); return e1() }),
    prepareDisposableEnvironment: vi.fn(async () => { calls.push('disposable-env') }),
    runNonDbProofs: vi.fn(async () => { calls.push('non-db'); return { rows: E2_SCENARIO_IDS.slice(0, 9).map(row) } }),
    runTask3Proofs: vi.fn(async () => { calls.push('task3'); return { rows: E2_SCENARIO_IDS.slice(9).map(row), safetyCounters: { duplicatePublicationCount: 0, canonicalCorruptionCount: 0, unboundedRetryCount: 0 }, resetProof: { completed: true, targets: [{ target: 'db', resetApplied: true, cleanStateVerified: true }] } } }),
    now: () => new Date('2026-08-13T00:00:00.000Z'), ...overrides,
  } }
}

describe('M10-E1 governed CLI', () => {
  it('prepares governed disposable and proves clean DB before E1 mutation', async () => {
    const calls: string[] = []
    const code = await runM10E1Cli({
      prepareDisposableEnvironment: () => { calls.push('prepare') },
      assertCleanDatabase: () => { calls.push('clean') },
      execute: async () => {
        calls.push('execute')
        return { ...e1(), evidence: { ...e1().evidence, scenarios: [] } }
      },
      writeArtifacts: false,
    })
    expect(code).toBe(0)
    expect(calls).toEqual(['prepare', 'clean', 'execute'])
  })

  it('stops before mutation when disposable clean preflight fails', async () => {
    const execute = vi.fn(async () => e1())
    await expect(runM10E1Cli({
      prepareDisposableEnvironment: () => undefined,
      assertCleanDatabase: () => { throw new Error('dirty disposable') },
      execute,
      writeArtifacts: false,
    })).rejects.toThrow('dirty disposable')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('M10-E1 matrix cleanup lifecycle', () => {
  const result = () => ({
    scenarios: [], uncovered: [], cleanLatenciesMs: [],
    resetProof: { completed: true, targets: [] },
  })

  it('always cleans after success and attaches final reset proof', async () => {
    const cleanup = vi.fn(async () => ({ completed: true, targets: [{ target: 'db', resetApplied: true, cleanStateVerified: true }] }))
    const observed = await runFaultMatrixWithCleanup({ runMutable: async () => result(), cleanup })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(observed.resetProof.targets[0]?.target).toBe('db')
  })

  it('cleans after primary failure and preserves primary error', async () => {
    const cleanup = vi.fn(async () => ({ completed: true, targets: [] }))
    await expect(runFaultMatrixWithCleanup({
      runMutable: async () => { throw new Error('primary failed') }, cleanup,
    })).rejects.toThrow('primary failed')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('propagates cleanup failure and aggregates dual failures', async () => {
    await expect(runFaultMatrixWithCleanup({
      runMutable: async () => result(), cleanup: async () => { throw new Error('cleanup failed') },
    })).rejects.toThrow('cleanup failed')
    const dual = runFaultMatrixWithCleanup({
      runMutable: async () => { throw new Error('primary failed') },
      cleanup: async () => { throw new Error('cleanup failed') },
    })
    await expect(dual).rejects.toBeInstanceOf(AggregateError)
    await expect(dual).rejects.toThrow('M10-E1 matrix and cleanup failed')
  })
})

describe('M10-E2 strict assembler', () => {
  it('assembles by ID in normative order and preserves producer safety/reset observations', () => {
    const reversed = [...E2_SCENARIO_IDS].reverse().map(row)
    expect(assembleE2Rows([{ rows: reversed }]).map((item) => item.id)).toEqual(E2_SCENARIO_IDS)
    const evidence = assembleE2Evidence({ baseGitSha: SHA, workingTreeDirty: false, producers: [
      { rows: reversed, safetyCounters: { duplicatePublicationCount: 2, canonicalCorruptionCount: 3, unboundedRetryCount: 4 }, resetProof: { completed: true, targets: [{ target: 'db', resetApplied: false, cleanStateVerified: false }] } },
      { rows: [], resetProof: { completed: true, targets: [{ target: 'e1-db', resetApplied: true, cleanStateVerified: true }] } },
    ], e1Regression: { baseGitSha: SHA, result: 'FAIL' } })
    expect(evidence.safetyCounters).toEqual({ duplicatePublicationCount: 2, canonicalCorruptionCount: 3, unboundedRetryCount: 4 })
    expect(evidence.resetProof.targets[0]).toEqual({ target: 'db', resetApplied: false, cleanStateVerified: false })
    expect(evidence.e1Regression.result).toBe('FAIL')
  })
  it('rejects duplicate, missing, unknown, and producer overlap', () => {
    expect(() => assembleE2Rows([{ rows: [row(E2_SCENARIO_IDS[0]), row(E2_SCENARIO_IDS[0])] }])).toThrow('DUPLICATE')
    expect(() => assembleE2Rows([{ rows: E2_SCENARIO_IDS.slice(1).map(row) }])).toThrow('MISSING')
    expect(() => assembleE2Rows([{ rows: [{ ...row(E2_SCENARIO_IDS[0]), id: 'UNKNOWN' as E2ScenarioId }] }])).toThrow('UNKNOWN')
    expect(() => assembleE2Rows([{ rows: [row(E2_SCENARIO_IDS[0])] }, { rows: [row(E2_SCENARIO_IDS[0])] }])).toThrow('OVERLAP')
  })
})

describe('M10-E2 Git metadata', () => {
  it('uses exact rev-parse commands and requires full SHA', async () => {
    const command = vi.fn(() => SHA.toUpperCase())
    const reader = createGitMetadataReader(command)
    expect(await reader.readHeadSha()).toBe(SHA)
    expect(await reader.readBlobSha('source.ts', 'HEAD')).toBe(SHA)
    expect(command.mock.calls).toEqual([[['rev-parse', 'HEAD']], [['rev-parse', 'HEAD:source.ts']]])
    await expect(createGitMetadataReader(() => 'abc').readHeadSha()).rejects.toThrow('E2_GIT_INVALID_SHA')
  })
})

describe('M10-E2 orchestrator and artifact pair', () => {
  it('captures Git once, binds E1 SHA, orders proof execution, combines reset targets, and emits stable exact matrix', async () => {
    const input = deps()
    const first = await executeM10E2(input.value)
    expect(input.calls).toEqual(['head', 'dirty', 'disposable-env', `e1:${SHA}`, 'non-db', 'task3'])
    expect(input.value.git.readHeadSha).toHaveBeenCalledOnce()
    expect(first.raw.evidence.rows).toHaveLength(19)
    expect(first.raw.evidence.rows.map((item) => item.id)).toEqual(E2_SCENARIO_IDS)
    expect(first.raw.evidence.e1Regression.baseGitSha).toBe(SHA)
    expect(first.raw.evidence.resetProof.targets.map((target) => target.target)).toEqual(['e1-db', 'db'])
    expect(first.normalized.normalizedHash).toBe(hashNormalizedE2Evidence(first.raw.evidence))
    const second = await executeM10E2(deps().value)
    expect(second.normalized.normalizedHash).toBe(first.normalized.normalizedHash)
  })
  it('does not treat Task3 reset alone as complete E2 reset proof', async () => {
    const withoutE1Reset = deps({ executeE1: vi.fn(async () => ({ ...e1(), resetProof: { completed: false, targets: [] } })) })
    const pair = await executeM10E2(withoutE1Reset.value)
    expect(pair.raw.evidence.resetProof.completed).toBe(false)
    expect(pair.raw.evidence.resetProof.targets.map((target) => target.target)).toEqual(['db'])
    expect(pair.normalized.gate.failures).toContain('reset proof must be complete')
  })
  it('rejects E1 evidence bound to another SHA before non-DB and Task3 proofs', async () => {
    const input = deps({ executeE1: vi.fn(async () => e1('PASS', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) })
    await expect(executeM10E2(input.value)).rejects.toThrow('E2_E1_BASE_SHA_MISMATCH')
    expect(input.value.runNonDbProofs).not.toHaveBeenCalled()
    expect(input.value.runTask3Proofs).not.toHaveBeenCalled()
  })
  it('fails dirty tree before E1 or mutable proof', async () => {
    const input = deps({ git: { readHeadSha: vi.fn(async () => SHA), readWorkingTreeDirty: vi.fn(async () => true) } })
    await expect(executeM10E2(input.value)).rejects.toThrow('E2_DIRTY_TREE_BEFORE_MUTABLE_PROOF')
    expect(input.value.prepareDisposableEnvironment).not.toHaveBeenCalled()
    expect(input.value.executeE1).not.toHaveBeenCalled()
    expect(input.value.runTask3Proofs).not.toHaveBeenCalled()
  })
  it('does not fabricate E1 PASS', async () => {
    const input = deps({ executeE1: vi.fn(async () => e1('FAIL')) })
    const failed = await executeM10E2(input.value)
    expect(failed.raw.evidence.e1Regression.result).toBe('FAIL')
    expect(failed.normalized.gate.result).toBe('FAIL')
  })
  it('validates strict raw/normalized pairing, gate, hash, IDs, and count', async () => {
    const pair = await executeM10E2(deps().value)
    expect(validateE2ArtifactPair(pair.raw, pair.normalized).normalized.evidence)
      .toEqual(normalizeE2Evidence(pair.raw.evidence))
    expect(() => validateE2ArtifactPair(pair.raw, { ...pair.normalized, normalizedHash: '0'.repeat(64) }))
      .toThrow('E2_ARTIFACT_PAIR_MISMATCH')
    expect(() => validateE2ArtifactPair({ ...pair.raw, extra: true }, pair.normalized)).toThrow()
    expect(() => validateE2ArtifactPair({ ...pair.raw, evidence: null }, pair.normalized)).toThrow()
    expect(() => validateE2ArtifactPair(pair.raw, { ...pair.normalized, gate: { result: 'PASS', failures: ['mismatch'] } })).toThrow('E2_ARTIFACT_PAIR_MISMATCH')
    expect(() => validateE2ArtifactPair(pair.raw, { ...pair.normalized, extra: true })).toThrow()
  })
})
