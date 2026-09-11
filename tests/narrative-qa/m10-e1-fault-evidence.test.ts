import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ReaderStateInternalMirrorSchema } from '../../lib/narrative-qa/fault/deps'
import {
  E1_EXECUTABLE_SCENARIO_IDS,
  evaluateE1Gate,
  normalizeE1Evidence,
  type E1Evidence,
  type E1ScenarioEvidence,
} from '../../lib/narrative-qa/fault/evidence'
import {
  E1_E2_GAPS,
  E1_HISTORICAL_REFERENCES,
} from '../../scripts/m10-e-reliability'

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
    workingTreeDirty: false,
    seed: 'm10-e1-seed-v1',
    faultSchedule: [...E1_EXECUTABLE_SCENARIO_IDS],
    scenarios: E1_EXECUTABLE_SCENARIO_IDS.map(passingScenario),
    historicalReferences: E1_HISTORICAL_REFERENCES,
    e2Gaps: E1_E2_GAPS,
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

  it('fails evidence produced from a dirty working tree', () => {
    const evidence = passingEvidence()
    evidence.workingTreeDirty = true

    expect(evaluateE1Gate(evidence).failures).toContain('working tree must be clean')
  })

  it('binds PB4 to one E1 non-executable reference and an exact open E2 concurrency gap', () => {
    const evidence = passingEvidence()
    expect(E1_EXECUTABLE_SCENARIO_IDS).not.toContain('PB4_SYNC_VS_WORKER_RACE')
    expect(evidence.scenarios).toHaveLength(13)
    expect(evidence.historicalReferences).toContainEqual(expect.objectContaining({
      id: 'PB4_SYNC_VS_WORKER_RACE',
      disposition: 'NOT_EXECUTABLE_E1',
    }))
    expect(evidence.e2Gaps).toContainEqual(expect.objectContaining({
      id: 'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER',
      disposition: 'OPEN_E2',
    }))
    expect(evaluateE1Gate(evidence)).toEqual({ result: 'PASS', failures: [] })

    evidence.historicalReferences = []
    expect(evaluateE1Gate(evidence).failures).toContain(
      'PB4_SYNC_VS_WORKER_RACE: expected exactly one NOT_EXECUTABLE_E1 metadata reference, observed 0',
    )

    const missingGap = passingEvidence()
    missingGap.e2Gaps = missingGap.e2Gaps.filter((gap) => gap.id !== 'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER')
    expect(evaluateE1Gate(missingGap).failures).toContain(
      'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER: expected exactly one OPEN_E2 gap, observed 0',
    )
  })

  it('requires exact open E2 gaps for PB2 transaction rollback and provider fallback', () => {
    const evidence = passingEvidence()
    expect(evidence.e2Gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT',
        disposition: 'OPEN_E2',
      }),
      expect.objectContaining({ id: 'PROVIDER_FALLBACK_SUCCEEDS', disposition: 'OPEN_E2' }),
    ]))
    expect(evidence.e2Gaps.find((gap) => gap.id === 'PROVIDER_FALLBACK_SUCCEEDS')?.reason)
      .toContain('deterministic E2 fault seam required without real provider call')
    expect(evidence.e2Gaps.find((gap) => gap.id === 'PROVIDER_FALLBACK_SUCCEEDS')?.reason)
      .not.toContain('M10-F')

    evidence.e2Gaps = evidence.e2Gaps.filter(
      (gap) => gap.id !== 'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT',
    )
    expect(evaluateE1Gate(evidence).failures).toContain(
      'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT: expected exactly one OPEN_E2 gap, observed 0',
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

describe('M10-E E1 reader-state mirror', () => {
  const validReaderState = {
    user_id: '11111111-1111-4111-8111-111111111111',
    story_id: 'story-1',
    status: 'BERJALAN' as const,
    current_chapter: 1,
    ending_name: null,
    route_state: {},
    locked_ending_key: null,
    updated_at: '2026-08-13T00:00:00.000Z',
  }

  it('matches production defaults and nullable fields', () => {
    expect(ReaderStateInternalMirrorSchema.parse(validReaderState)).toEqual({
      ...validReaderState,
      jejak: [],
      route_state: {
        truth: 0,
        risk: 0,
        secrecy: 0,
        empathy: 0,
        trust: {},
        evidence: [],
        flags: {},
        endingBias: {},
      },
      choice_history: [],
    })
  })

  it('rejects unknown fields, non-positive chapters, malformed route state, and malformed choice history', () => {
    expect(() => ReaderStateInternalMirrorSchema.parse({ ...validReaderState, extra: true })).toThrow()
    expect(() => ReaderStateInternalMirrorSchema.parse({ ...validReaderState, current_chapter: 0 })).toThrow()
    expect(() => ReaderStateInternalMirrorSchema.parse({
      ...validReaderState,
      route_state: { unknown: true },
    })).toThrow()
    expect(() => ReaderStateInternalMirrorSchema.parse({
      ...validReaderState,
      choice_history: [{ chapterNumber: 50 }],
    })).toThrow()
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
