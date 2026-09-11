import { describe, expect, it } from 'vitest'
import type { LongHorizonFindingV1 } from '../../lib/narrative-qa/contracts/evaluator-contract'
import {
  computeM10FLiveCaptureHash,
  deriveM10FEvidenceResult,
  evidenceCaptureChapterNumbers,
  isE5ReviewRequiredEvent,
  scopeM10FTelemetryRows,
  validateM10FLiveChapterCaptures,
  type M10FLiveChapterCaptureRecord,
} from '../../lib/narrative-qa/harness/m10-f-evidence-summary'

function finding(severity: LongHorizonFindingV1['severity']): LongHorizonFindingV1 {
  return {
    schemaVersion: 1,
    code: `TEST_${severity}`,
    severity,
    domain: 'test',
    storyId: 'm10c-m10f-test',
    chapterNumber: 1,
    evidence: [],
    message: 'test',
    remediationClass: 'runtime',
  }
}

const passing = {
  findings: [] as LongHorizonFindingV1[],
  completionAuditsPassed: true,
  actBoundaryGatePassed: true,
  endingGatePassed: true,
  repetitionGatePassed: true,
  liveChapterCapturesPassed: true,
  e5CoveragePassed: true,
  semanticEvidence: {
    gate: {
      outcome: 'PASS' as const,
      observedCaseCount: 12,
      observedValidSampleCount: 36,
      everyRequiredCasePassed: true,
    },
  },
  totalBudgetPassed: true,
  meanBudgetPassed: true,
}

describe('isE5ReviewRequiredEvent', () => {
  it('maps only explicit review-required generation attempts', () => {
    expect(isE5ReviewRequiredEvent({
      type: 'GENERATION_ATTEMPT',
      payload: { outcome: 'REVIEW_REQUIRED' },
    })).toBe(true)
    expect(isE5ReviewRequiredEvent({
      type: 'GENERATION_RUNTIME_FAILED',
      payload: { error_code: 'PROVIDER_ERROR' },
    })).toBe(false)
    expect(isE5ReviewRequiredEvent({
      type: 'GENERATION_ATTEMPT',
      payload: { outcome: 'PUBLISHED' },
    })).toBe(false)
  })
})

describe('evidenceCaptureChapterNumbers', () => {
  it('captures every chapter during live publication', () => {
    expect(evidenceCaptureChapterNumbers('LIVE_CHAPTER_LOCAL', 50)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
  })

  it('evaluates only the completed horizon when replaying final state', () => {
    expect(evidenceCaptureChapterNumbers('POST_HORIZON', 50)).toEqual([50])
  })
})

const STORY_ID = 'm10c-m10f-test'
const RUN_ID = 'run-test'
const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'

function liveCapture(chapterNumber: number): M10FLiveChapterCaptureRecord {
  const record: M10FLiveChapterCaptureRecord = {
    captureMode: 'LIVE_CHAPTER_LOCAL',
    storyId: STORY_ID,
    runId: RUN_ID,
    correlationId: CORRELATION_ID,
    contentHash: 'b'.repeat(64),
    capture: {
      chapterNumber,
      canonRevision: chapterNumber,
      stateDeltaHash: 'a'.repeat(64),
      baseCanonRevision: chapterNumber - 1,
      checkpointSchemaVersion: 3,
      checkpointStatus: 'PUBLISHED',
      publishedTitle: `Bab ${chapterNumber}`,
      choiceIds: chapterNumber < 50 ? ['choice-a', 'choice-b'] : [],
      acceptedChoiceId: chapterNumber < 50 ? 'choice-a' : null,
      contextBudget: chapterNumber === 1 ? 'NO_RETRIEVAL_AT_STORY_START' : {
        targetChapter: chapterNumber,
        includedCount: 1,
        excludedCount: 0,
        budgetReport: {},
      },
      captureHash: '',
    },
    findings: [],
  }
  record.capture.captureHash = computeM10FLiveCaptureHash(record)
  return record
}

describe('validateM10FLiveChapterCaptures', () => {
  it('accepts exact live chapter-local sequence', () => {
    const records = Array.from({ length: 50 }, (_, index) => liveCapture(index + 1))
    expect(() => validateM10FLiveChapterCaptures(
      records,
      { storyId: STORY_ID, runId: RUN_ID, correlationId: CORRELATION_ID },
      50,
    )).not.toThrow()
  })

  it('rejects missing or out-of-order live captures', () => {
    const missing = Array.from({ length: 49 }, (_, index) => liveCapture(index + 1))
    const identity = { storyId: STORY_ID, runId: RUN_ID, correlationId: CORRELATION_ID }
    expect(() => validateM10FLiveChapterCaptures(missing, identity, 50))
      .toThrow('Expected 50 live chapter captures; observed 49')

    const outOfOrder = Array.from({ length: 50 }, (_, index) => liveCapture(index + 1))
    outOfOrder[20] = liveCapture(22)
    expect(() => validateM10FLiveChapterCaptures(outOfOrder, identity, 50))
      .toThrow('Expected live capture Bab 21; observed Bab 22')
  })

  it('rejects capture records bound to another story or run', () => {
    const crossStory = [liveCapture(1)]
    crossStory[0] = { ...crossStory[0]!, storyId: 'm10c-m10f-other' }
    expect(() => validateM10FLiveChapterCaptures(
      crossStory,
      { storyId: STORY_ID, runId: RUN_ID, correlationId: CORRELATION_ID },
      1,
    )).toThrow('Live capture 1 storyId mismatch')

    const crossRunId = [liveCapture(1)]
    crossRunId[0] = { ...crossRunId[0]!, runId: 'run-other' }
    expect(() => validateM10FLiveChapterCaptures(
      crossRunId,
      { storyId: STORY_ID, runId: RUN_ID, correlationId: CORRELATION_ID },
      1,
    )).toThrow('Live capture 1 runId mismatch')

    const crossCorrelation = [liveCapture(1)]
    crossCorrelation[0] = {
      ...crossCorrelation[0]!,
      correlationId: '22222222-2222-4222-8222-222222222222',
    }
    expect(() => validateM10FLiveChapterCaptures(
      crossCorrelation,
      { storyId: STORY_ID, runId: RUN_ID, correlationId: CORRELATION_ID },
      1,
    )).toThrow('Live capture 1 correlationId mismatch')
  })

  it('rejects tampered canonical capture payload even when stored hash is unchanged', () => {
    const record = liveCapture(1)
    record.capture.publishedTitle = 'Judul diubah'

    expect(() => validateM10FLiveChapterCaptures(
      [record],
      { storyId: STORY_ID, runId: RUN_ID, correlationId: CORRELATION_ID },
      1,
    )).toThrow('Live capture 1 captureHash mismatch')
  })

  it.each(['storyId', 'runId', 'correlationId'] as const)(
    'binds %s identity into capture hash',
    (key) => {
      const record = liveCapture(1)
      record[key] = `${record[key]}-tampered`
      expect(computeM10FLiveCaptureHash(record)).not.toBe(record.capture.captureHash)
    },
  )

  it('binds deterministic findings into capture hash independent of input order', () => {
    const first = liveCapture(1)
    const findingA = finding('MEDIUM')
    const findingB = { ...finding('LOW'), code: 'TEST_LOW_B' }
    first.findings = [findingA, findingB]
    first.capture.captureHash = computeM10FLiveCaptureHash(first)

    const reordered = structuredClone(first)
    reordered.findings.reverse()
    expect(computeM10FLiveCaptureHash(reordered)).toBe(first.capture.captureHash)

    reordered.findings[0]!.code = 'TAMPERED_FINDING'
    expect(computeM10FLiveCaptureHash(reordered)).not.toBe(first.capture.captureHash)
  })
})

describe('scopeM10FTelemetryRows', () => {
  const rows = [
    { story_id: STORY_ID, correlation_id: CORRELATION_ID, chapter_number: 1 },
    { story_id: STORY_ID, correlation_id: CORRELATION_ID, chapter_number: 2 },
    { story_id: STORY_ID, correlation_id: '22222222-2222-4222-8222-222222222222', chapter_number: 1 },
  ]

  it('keeps only exact story and correlation identity and proves horizon coverage', () => {
    expect(scopeM10FTelemetryRows(rows, {
      storyId: STORY_ID,
      correlationId: CORRELATION_ID,
      expectedChapterNumbers: [1, 2],
    })).toEqual(rows.slice(0, 2))
  })

  it('rejects unrelated input rows and incomplete or ambiguous chapter coverage', () => {
    expect(() => scopeM10FTelemetryRows(rows, {
      storyId: STORY_ID,
      correlationId: CORRELATION_ID,
      expectedChapterNumbers: [1, 2],
      rejectUnscopedRows: true,
    })).toThrow('Telemetry contains rows outside expected pilot identity')

    expect(() => scopeM10FTelemetryRows(rows.slice(0, 1), {
      storyId: STORY_ID,
      correlationId: CORRELATION_ID,
      expectedChapterNumbers: [1, 2],
    })).toThrow('Telemetry chapter horizon mismatch')

    expect(() => scopeM10FTelemetryRows([
      ...rows.slice(0, 2),
      { story_id: STORY_ID, correlation_id: CORRELATION_ID, chapter_number: null },
    ], {
      storyId: STORY_ID,
      correlationId: CORRELATION_ID,
      expectedChapterNumbers: [1, 2],
    })).toThrow('Telemetry row has ambiguous chapter_number')
  })
})

describe('deriveM10FEvidenceResult', () => {
  it('passes only when every required gate passes', () => {
    expect(deriveM10FEvidenceResult(passing)).toEqual({
      result: 'PASS',
      failedGates: [],
      blockerOrHighFindingCount: 0,
    })
  })

  it('fails when any runtime review event lacks E5 queue mapping', () => {
    expect(deriveM10FEvidenceResult({
      ...passing,
      e5CoveragePassed: false,
    })).toEqual({
      result: 'FAIL',
      failedGates: ['E5_REVIEW_ENQUEUE_COVERAGE'],
      blockerOrHighFindingCount: 0,
    })
  })

  it('fails closed when semantic D-R1..D-R8 evidence is unavailable', () => {
    expect(deriveM10FEvidenceResult({
      ...passing,
      semanticEvidence: null,
    })).toEqual({
      result: 'FAIL',
      failedGates: ['SEMANTIC_D_R1_R8'],
      blockerOrHighFindingCount: 0,
    })
  })

  it.each(['BLOCKER', 'HIGH'] as const)('fails for %s deterministic findings', (severity) => {
    const result = deriveM10FEvidenceResult({ ...passing, findings: [finding(severity)] })

    expect(result.result).toBe('FAIL')
    expect(result.blockerOrHighFindingCount).toBe(1)
    expect(result.failedGates).toContain('DETERMINISTIC_BLOCKER_HIGH_ZERO')
  })

  it('does not fail solely for MEDIUM findings', () => {
    expect(deriveM10FEvidenceResult({ ...passing, findings: [finding('MEDIUM')] }).result).toBe('PASS')
  })

  it('reports every failed completion, evaluator, and budget gate', () => {
    const result = deriveM10FEvidenceResult({
      ...passing,
      completionAuditsPassed: false,
      actBoundaryGatePassed: false,
      endingGatePassed: false,
      repetitionGatePassed: false,
      liveChapterCapturesPassed: false,
      e5CoveragePassed: false,
      semanticEvidence: null,
      totalBudgetPassed: false,
      meanBudgetPassed: false,
    })

    expect(result).toEqual({
      result: 'FAIL',
      failedGates: [
        'COMPLETION_AUDITS',
        'ACT_BOUNDARY',
        'ENDING',
        'REPETITION',
        'LIVE_CHAPTER_CAPTURES',
        'E5_REVIEW_ENQUEUE_COVERAGE',
        'SEMANTIC_D_R1_R8',
        'TOTAL_BUDGET',
        'MEAN_BUDGET',
      ],
      blockerOrHighFindingCount: 0,
    })
  })
})
