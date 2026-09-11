import type { LongHorizonFindingV1, M10ArtifactManifestV1 } from '../contracts/evaluator-contract'
import type { ChapterCaptureV1 } from './capture'
import {
  computeSha256,
  sortFindings,
  stableStringify,
} from '../scoring/canonical-serializer'

export type M10FEvidenceCaptureMode = 'LIVE_CHAPTER_LOCAL' | 'POST_HORIZON'

export function isE5ReviewRequiredEvent(
  event: { type: string; payload: unknown },
): boolean {
  if (event.type !== 'GENERATION_ATTEMPT') return false
  if (!event.payload || typeof event.payload !== 'object') return false
  return (event.payload as Record<string, unknown>).outcome === 'REVIEW_REQUIRED'
}

export function evidenceCaptureChapterNumbers(
  mode: M10FEvidenceCaptureMode,
  totalChapters: number,
): number[] {
  if (!Number.isInteger(totalChapters) || totalChapters < 1) {
    throw new Error('totalChapters must be a positive integer')
  }
  if (mode === 'POST_HORIZON') return [totalChapters]
  return Array.from({ length: totalChapters }, (_, index) => index + 1)
}

export interface M10FPilotRunIdentity {
  storyId: string
  runId: string
  correlationId: string
}

export interface M10FLiveChapterCaptureRecord extends M10FPilotRunIdentity {
  captureMode: 'LIVE_CHAPTER_LOCAL'
  /** Canonical title + paragraphs hash frozen immediately after publication. */
  contentHash: string
  capture: ChapterCaptureV1
  findings: LongHorizonFindingV1[]
}

/** Bind canonical live envelope; captureHash excludes only itself. */
export function computeM10FLiveCaptureHash(record: M10FLiveChapterCaptureRecord): string {
  const { captureHash: _captureHash, ...capturePayload } = record.capture
  return computeSha256(stableStringify({
    captureMode: record.captureMode,
    storyId: record.storyId,
    runId: record.runId,
    correlationId: record.correlationId,
    contentHash: record.contentHash,
    capture: capturePayload,
    findings: sortFindings(record.findings),
  }))
}

export function validateM10FLiveChapterCaptures(
  records: M10FLiveChapterCaptureRecord[],
  expected: M10FPilotRunIdentity,
  totalChapters: number,
): void {
  const expectedChapters = evidenceCaptureChapterNumbers('LIVE_CHAPTER_LOCAL', totalChapters)
  if (records.length !== expectedChapters.length) {
    throw new Error(`Expected ${expectedChapters.length} live chapter captures; observed ${records.length}`)
  }
  records.forEach((record, index) => {
    const expectedChapter = expectedChapters[index]
    if (record.captureMode !== 'LIVE_CHAPTER_LOCAL') {
      throw new Error(`Capture ${index + 1} is not LIVE_CHAPTER_LOCAL`)
    }
    if (!/^[a-f0-9]{64}$/.test(record.contentHash)) {
      throw new Error(`Live capture ${index + 1} contentHash invalid`)
    }
    for (const key of ['storyId', 'runId', 'correlationId'] as const) {
      if (record[key] !== expected[key]) {
        throw new Error(`Live capture ${index + 1} ${key} mismatch`)
      }
    }
    const recomputedHash = computeM10FLiveCaptureHash(record)
    if (record.capture.captureHash !== recomputedHash) {
      throw new Error(`Live capture ${index + 1} captureHash mismatch`)
    }
    if (record.capture.chapterNumber !== expectedChapter) {
      throw new Error(
        `Expected live capture Bab ${expectedChapter}; observed Bab ${record.capture.chapterNumber}`,
      )
    }
    const crossStoryFinding = record.findings.find((finding) => finding.storyId !== expected.storyId)
    if (crossStoryFinding) {
      throw new Error(`Live capture contains cross-story finding ${crossStoryFinding.code}`)
    }
  })
}

export interface M10FTelemetryIdentityRow {
  story_id: string
  correlation_id: string
  chapter_number: number | null
}

export interface M10FTelemetryScope {
  storyId: string
  correlationId: string
  expectedChapterNumbers?: number[]
  rejectUnscopedRows?: boolean
}

/** Pure telemetry identity/horizon gate. Query callers still filter at source. */
export function scopeM10FTelemetryRows<T extends M10FTelemetryIdentityRow>(
  rows: T[],
  scope: M10FTelemetryScope,
): T[] {
  const scoped = rows.filter(
    (row) => row.story_id === scope.storyId && row.correlation_id === scope.correlationId,
  )
  if (scope.rejectUnscopedRows && scoped.length !== rows.length) {
    throw new Error('Telemetry contains rows outside expected pilot identity')
  }
  if (scoped.length === 0) throw new Error('No telemetry rows for expected pilot identity')

  if (scope.expectedChapterNumbers) {
    if (scoped.some((row) => !Number.isInteger(row.chapter_number))) {
      throw new Error('Telemetry row has ambiguous chapter_number')
    }
    const observed = [...new Set(scoped.map((row) => row.chapter_number as number))].sort((a, b) => a - b)
    const expected = [...new Set(scope.expectedChapterNumbers)].sort((a, b) => a - b)
    if (stableStringify(observed) !== stableStringify(expected)) {
      throw new Error(
        `Telemetry chapter horizon mismatch: expected ${stableStringify(expected)}; observed ${stableStringify(observed)}`,
      )
    }
  }
  return scoped
}

export interface M10FEvidenceGateInput {
  findings: LongHorizonFindingV1[]
  completionAuditsPassed: boolean
  actBoundaryGatePassed: boolean
  endingGatePassed: boolean
  repetitionGatePassed: boolean
  liveChapterCapturesPassed: boolean
  e5CoveragePassed: boolean
  semanticEvidence: {
    gate: {
      outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
      observedCaseCount: number
      observedValidSampleCount: number
      everyRequiredCasePassed: boolean
    }
  } | null
  totalBudgetPassed: boolean
  meanBudgetPassed: boolean
}

export interface M10FEvidenceGateResult {
  result: M10ArtifactManifestV1['result']
  failedGates: string[]
  blockerOrHighFindingCount: number
}

/** Pure fail-closed result logic for post-run M10-F evidence. */
export function deriveM10FEvidenceResult(input: M10FEvidenceGateInput): M10FEvidenceGateResult {
  const blockerOrHighFindingCount = input.findings.filter(
    (finding) => finding.severity === 'BLOCKER' || finding.severity === 'HIGH',
  ).length
  const failedGates: string[] = []

  if (blockerOrHighFindingCount > 0) failedGates.push('DETERMINISTIC_BLOCKER_HIGH_ZERO')
  if (!input.completionAuditsPassed) failedGates.push('COMPLETION_AUDITS')
  if (!input.actBoundaryGatePassed) failedGates.push('ACT_BOUNDARY')
  if (!input.endingGatePassed) failedGates.push('ENDING')
  if (!input.repetitionGatePassed) failedGates.push('REPETITION')
  if (!input.liveChapterCapturesPassed) failedGates.push('LIVE_CHAPTER_CAPTURES')
  if (!input.e5CoveragePassed) failedGates.push('E5_REVIEW_ENQUEUE_COVERAGE')
  const semanticGatePassed = input.semanticEvidence?.gate.outcome === 'PASS'
    && input.semanticEvidence.gate.observedCaseCount === 12
    && input.semanticEvidence.gate.observedValidSampleCount === 36
    && input.semanticEvidence.gate.everyRequiredCasePassed
  if (!semanticGatePassed) failedGates.push('SEMANTIC_D_R1_R8')
  if (!input.totalBudgetPassed) failedGates.push('TOTAL_BUDGET')
  if (!input.meanBudgetPassed) failedGates.push('MEAN_BUDGET')

  return {
    result: failedGates.length === 0 ? 'PASS' : 'FAIL',
    failedGates,
    blockerOrHighFindingCount,
  }
}
