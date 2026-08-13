import { describe, expect, it } from 'vitest'
import {
  E1_EXECUTABLE_SCENARIO_IDS,
  evaluateE1Gate,
  normalizeE1Evidence,
  type E1Evidence,
  type E1ScenarioEvidence,
} from '../../lib/narrative-qa/fault/evidence'

function passingScenario(id: (typeof E1_EXECUTABLE_SCENARIO_IDS)[number]): E1ScenarioEvidence {
  return {
    id,
    injectedBoundary: 'test boundary',
    injectionReached: true,
    expectedDisposition: 'PUBLISHED',
    observedDisposition: 'PUBLISHED',
    recoveryExpected: false,
    recovered: true,
    harnessRecoveryInvocations: 0,
    ...(id === 'P8_PERSISTENT_DEFECT_BOUNDED'
      ? { runtimeProviderAttempts: { writeAttempts: 3, productionCeiling: 3 } }
      : {}),
    ...(id === 'W1_CRASH_AFTER_PROSE_CHECKPOINT'
      ? {
          checkpointRecovery: {
            afterFaultStatus: 'PROSE_READY',
            recoveryFromCheckpoint: true,
            faultProseGenerationCalls: 1,
            recoveryProseGenerationCalls: 0,
          },
        }
      : {}),
    invariantChecks: {
      afterFault: [{ code: 'INV_TEST', passed: true, detail: { observedId: 'db-1' } }],
      afterRecovery: null,
    },
  }
}

function passingEvidence(): E1Evidence {
  return {
    version: 'm10-e1-fault-evidence/v1',
    baseGitSha: '832f758e3e414a381983b0bf1c78a4e7049ed503',
    workingTreeDirty: true,
    seed: 'm10-e1-seed-v1',
    faultSchedule: [...E1_EXECUTABLE_SCENARIO_IDS],
    scenarios: E1_EXECUTABLE_SCENARIO_IDS.map(passingScenario),
    historicalReferences: [{
      id: 'PB4_SYNC_VS_WORKER_RACE',
      disposition: 'N/A_CURRENT_RUNTIME',
      reason: 'withGenerationSlot duplicate-target guard prevents second publication-seam entrant.',
    }],
    e2Gaps: [],
    duplicatePublicationCount: 0,
    canonicalCorruptionCount: 0,
    unboundedRetryCount: 0,
  }
}

describe('M10-E E1 evidence gate', () => {
  it('passes complete evidence and fails deliberately broken invariant evidence', () => {
    const evidence = passingEvidence()
    expect(evaluateE1Gate(evidence)).toEqual({ result: 'PASS', failures: [] })

    evidence.scenarios[0].invariantChecks.afterFault[0].passed = false
    const broken = evaluateE1Gate(evidence)
    expect(broken.result).toBe('FAIL')
    expect(broken.failures).toContain('P1_TIMEOUT_BEFORE_FIRST_BYTE: invariant INV_TEST failed after fault')
  })

  it('fails missing injection, disposition mismatch, missing recovery check, runtime retry overflow, W1 proof defects, and unbounded retry', () => {
    const evidence = passingEvidence()
    evidence.scenarios[0].injectionReached = false
    evidence.scenarios[1].observedDisposition = 'FAILED_CLOSED'
    evidence.scenarios[2].recoveryExpected = true
    evidence.scenarios[2].invariantChecks.afterRecovery = null
    evidence.unboundedRetryCount = 1
    const p8 = evidence.scenarios.find((scenario) => scenario.id === 'P8_PERSISTENT_DEFECT_BOUNDED')!
    p8.runtimeProviderAttempts = { writeAttempts: 4, productionCeiling: 3 }
    const w1 = evidence.scenarios.find((scenario) => scenario.id === 'W1_CRASH_AFTER_PROSE_CHECKPOINT')!
    w1.checkpointRecovery = {
      afterFaultStatus: null,
      recoveryFromCheckpoint: false,
      faultProseGenerationCalls: 1,
      recoveryProseGenerationCalls: 1,
    }

    const gate = evaluateE1Gate(evidence)
    expect(gate.result).toBe('FAIL')
    expect(gate.failures).toEqual(expect.arrayContaining([
      'P1_TIMEOUT_BEFORE_FIRST_BYTE: injected seam not reached',
      'P2_TIMEOUT_AFTER_PARTIAL: expected PUBLISHED, observed FAILED_CLOSED',
      'P3_RETRYABLE_429: recovery invariant check missing',
      'P8_PERSISTENT_DEFECT_BOUNDED: expected runtime provider attempts to exhaust at production ceiling 3, observed 4',
      'W1_CRASH_AFTER_PROSE_CHECKPOINT: expected PROSE_READY checkpoint after fault',
      'W1_CRASH_AFTER_PROSE_CHECKPOINT: recovery did not report fromCheckpoint',
      'W1_CRASH_AFTER_PROSE_CHECKPOINT: recovery generated prose again',
      'unbounded retry count must be 0, observed 1',
    ]))
  })

  it('excludes PB4 from executable catalog while retaining exact non-executable metadata', () => {
    const evidence = passingEvidence()
    expect(E1_EXECUTABLE_SCENARIO_IDS).not.toContain('PB4_SYNC_VS_WORKER_RACE')
    expect(evidence.scenarios).toHaveLength(13)
    expect(evidence.historicalReferences).toContainEqual(expect.objectContaining({
      id: 'PB4_SYNC_VS_WORKER_RACE',
      disposition: 'N/A_CURRENT_RUNTIME',
    }))
    expect(evaluateE1Gate(evidence)).toEqual({ result: 'PASS', failures: [] })

    evidence.historicalReferences = []
    expect(evaluateE1Gate(evidence).failures).toContain(
      'PB4_SYNC_VS_WORKER_RACE: expected exactly one N/A_CURRENT_RUNTIME metadata reference, observed 0',
    )
  })

  it('fails duplicate, extra, reordered scenarios, reordered schedule, and missing schedule entry', () => {
    const duplicate = passingEvidence()
    duplicate.scenarios.push(passingScenario('P1_TIMEOUT_BEFORE_FIRST_BYTE'))
    expect(evaluateE1Gate(duplicate).failures).toEqual(expect.arrayContaining([
      'executable scenario count must be 13, observed 14',
      'P1_TIMEOUT_BEFORE_FIRST_BYTE: executable scenario duplicated 2 times',
    ]))

    const extra = passingEvidence()
    extra.scenarios.push({ ...passingScenario('P1_TIMEOUT_BEFORE_FIRST_BYTE'), id: 'EXTRA' as E1ScenarioEvidence['id'] })
    expect(evaluateE1Gate(extra).failures).toContain('EXTRA: not an executable E1 scenario')

    const reordered = passingEvidence()
    ;[reordered.scenarios[0], reordered.scenarios[1]] = [reordered.scenarios[1], reordered.scenarios[0]]
    expect(evaluateE1Gate(reordered).failures).toContain('scenario order does not match executable E1 catalog')

    const reorderedSchedule = passingEvidence()
    ;[reorderedSchedule.faultSchedule[0], reorderedSchedule.faultSchedule[1]] = [
      reorderedSchedule.faultSchedule[1],
      reorderedSchedule.faultSchedule[0],
    ]
    expect(evaluateE1Gate(reorderedSchedule).failures).toContain(
      'fault schedule does not exactly match executable E1 catalog',
    )

    const missingSchedule = passingEvidence()
    missingSchedule.faultSchedule.pop()
    expect(evaluateE1Gate(missingSchedule).failures).toContain(
      'fault schedule does not exactly match executable E1 catalog',
    )
  })
})

describe('M10-E E1 normalization', () => {
  it('excludes raw times, latencies, UUIDs, and DB IDs from normalized evidence', () => {
    const first = passingEvidence()
    first.runMetadata = {
      startedAt: '2026-08-13T01:00:00.000Z',
      finishedAt: '2026-08-13T01:00:01.000Z',
      rawAttemptIds: ['11111111-1111-4111-8111-111111111111'],
      latenciesMs: [10],
    }
    const second = passingEvidence()
    second.runMetadata = {
      startedAt: '2026-08-13T02:00:00.000Z',
      finishedAt: '2026-08-13T02:00:09.000Z',
      rawAttemptIds: ['22222222-2222-4222-8222-222222222222'],
      latenciesMs: [9000],
    }
    first.scenarios[0].invariantChecks.afterFault[0].detail = { observedId: 'db-row-a' }
    second.scenarios[0].invariantChecks.afterFault[0].detail = { observedId: 'db-row-b' }
    first.workingTreeDirty = true
    second.workingTreeDirty = false

    expect(normalizeE1Evidence(first)).toEqual(normalizeE1Evidence(second))
    expect(normalizeE1Evidence(first)).not.toHaveProperty('workingTreeDirty')
  })
})
