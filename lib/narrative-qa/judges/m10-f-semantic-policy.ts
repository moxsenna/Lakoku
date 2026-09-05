import type {
  M10FAssembledSemanticCase,
  M10FExactExecutionIdentity,
  M10FSemanticAggregate,
  M10FSemanticAttempt,
  M10FSemanticAuthority,
} from '../contracts/m10-f-semantic-contract'
import {
  M10FSemanticAggregateSchema,
  M10FSemanticAttemptSchema,
} from '../contracts/m10-f-semantic-contract'
import { SEMANTIC_FINDING_CODES } from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

export interface M10FRawJudgeResponse {
  score: number
  modelVerdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  confidence: number
  evidenceMode: 'SPAN' | 'FULL_HORIZON_ABSENCE'
  findingCodes: string[]
  evidence: Array<{ segmentId: string; quote: string }>
  absenceCode?: string
  rationaleSummary: string
}

export interface M10FObservedIdentity {
  providerId: string | null
  actualModelId: string | null
  actualModelResolved: boolean
  fallbackIndex: number
  routeVersion: string | null
}

function exactIdentityValid(
  expected: M10FExactExecutionIdentity,
  observed: M10FObservedIdentity,
): boolean {
  return observed.providerId === expected.providerId
    && observed.actualModelId === expected.expectedActualModelId
    && observed.actualModelResolved
    && observed.fallbackIndex === expected.primaryIndex
    && observed.routeVersion === expected.routeVersion
}

function failureAttempt(input: {
  assembled: M10FAssembledSemanticCase
  authority: M10FSemanticAuthority
  sampleIndex: number
  observedIdentity?: M10FObservedIdentity
  status: Exclude<M10FSemanticAttempt['status'], 'VALID'>
  failureCodes: string[]
}): M10FSemanticAttempt {
  const observedIdentity = input.observedIdentity ?? {
    providerId: null,
    actualModelId: null,
    actualModelResolved: false,
    fallbackIndex: 0,
    routeVersion: null,
  }
  const payload = {
    schemaVersion: 1 as const,
    pilotIdentity: input.assembled.pilotIdentity,
    authorityHash: input.authority.authorityHash,
    sourceEvidenceManifestHash: input.assembled.sourceEvidenceManifestHash,
    sourceCaptureArtifactHash: input.assembled.sourceCaptureArtifactHash,
    liveCaptureArtifactHash: input.assembled.liveCaptureArtifactHash,
    storySurfaceHash: input.assembled.storySurfaceHash,
    caseId: input.assembled.caseAuthority.caseId,
    rubricId: input.assembled.caseAuthority.rubricId,
    sampleIndex: input.sampleIndex,
    judgeInputHash: input.assembled.judgeInputHash,
    promptHash: input.assembled.promptHash,
    configuredExecutionIdentity: input.authority.executionIdentity,
    observedIdentity,
    status: input.status,
    score: null,
    modelVerdict: null,
    confidence: null,
    findingCodes: [],
    evidenceMode: null,
    evidenceRefs: [],
    rationaleSummaryHash: null,
    failureCodes: [...new Set(input.failureCodes)].sort(),
  }
  return M10FSemanticAttemptSchema.parse({
    ...payload,
    attemptId: computeSha256(stableStringify(payload)),
  })
}

export function makeM10FSemanticFailureAttempt(input: Parameters<typeof failureAttempt>[0]): M10FSemanticAttempt {
  return failureAttempt(input)
}

export function validateM10FSemanticResponse(input: {
  assembled: M10FAssembledSemanticCase
  authority: M10FSemanticAuthority
  sampleIndex: number
  observedIdentity: M10FObservedIdentity
  response: M10FRawJudgeResponse
}): M10FSemanticAttempt {
  const { assembled, authority, response } = input
  if (!exactIdentityValid(authority.executionIdentity, input.observedIdentity)) {
    return failureAttempt({ ...input, status: 'MODEL_IDENTITY_FAILURE', failureCodes: ['MODEL_IDENTITY_MISMATCH'] })
  }
  if (!Number.isInteger(response.score) || response.score < 0 || response.score > 100
    || !Number.isInteger(response.confidence) || response.confidence < 0 || response.confidence > 100
    || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(response.modelVerdict)
    || !['SPAN', 'FULL_HORIZON_ABSENCE'].includes(response.evidenceMode)
    || typeof response.rationaleSummary !== 'string' || response.rationaleSummary.length < 1
    || response.rationaleSummary.length > 1_000) {
    return failureAttempt({ ...input, status: 'MALFORMED_RESPONSE', failureCodes: ['MALFORMED_RESPONSE'] })
  }
  const allowed = SEMANTIC_FINDING_CODES[assembled.caseAuthority.rubricId] as readonly string[]
  const errors: string[] = []
  if (response.findingCodes.length < 1 || response.findingCodes.some((code) => !allowed.includes(code))) {
    errors.push('INVALID_FINDING_CODES')
  }
  const segments = new Map(assembled.judgeInput.segments.map((segment) => [segment.segmentId, segment]))
  if (response.evidenceMode === 'SPAN') {
    if (response.evidence.length < 1) errors.push('MISSING_SPAN_EVIDENCE')
    for (const evidence of response.evidence) {
      const segment = segments.get(evidence.segmentId)
      if (!segment || !segment.content.includes(evidence.quote)) errors.push('UNVERIFIABLE_EVIDENCE')
    }
    if (assembled.caseAuthority.rubricId === 'D-R4'
      && response.findingCodes.includes('REPETITION_SEMANTIC_DUPLICATE')
      && new Set(response.evidence.map((evidence) => evidence.segmentId)).size < 2) {
      errors.push('D_R4_DISTINCT_EVIDENCE_REQUIRED')
    }
    if (assembled.caseAuthority.rubricId === 'D-R6') {
      const evidenceChapters = response.evidence.flatMap((evidence) => {
        const segment = segments.get(evidence.segmentId)
        return segment ? [segment.chapterNumber] : []
      })
      if (evidenceChapters.length < 2 || Math.min(...evidenceChapters) >= Math.max(...evidenceChapters)) {
        errors.push('D_R6_SETUP_PAYOFF_EVIDENCE_REQUIRED')
      }
    }
    if (assembled.caseAuthority.rubricId === 'D-R7'
      && !response.evidence.some((evidence) => segments.get(evidence.segmentId)?.chapterNumber === 49)) {
      errors.push('D_R7_BAB49_EVIDENCE_REQUIRED')
    }
    if (assembled.caseAuthority.rubricId === 'D-R8') {
      const evidenceChapters = response.evidence.flatMap((evidence) => {
        const segment = segments.get(evidence.segmentId)
        return segment ? [segment.chapterNumber] : []
      })
      if (!evidenceChapters.includes(50) || !evidenceChapters.some((chapter) => chapter >= 41 && chapter <= 49)) {
        errors.push('D_R8_RUNWAY_AND_BAB50_EVIDENCE_REQUIRED')
      }
    }
  } else if (assembled.caseAuthority.rubricId !== 'D-R7'
    || response.absenceCode !== 'EMOTIONAL_RESOLUTION_ABSENT'
    || !response.findingCodes.includes('EMOTIONAL_RESOLUTION_ABSENT')
    || response.evidence.length !== 0
    || !assembled.judgeInput.segments.some((segment) => segment.chapterNumber === 49 && segment.content.length > 0)) {
    errors.push('INVALID_FULL_HORIZON_ABSENCE')
  }
  if (errors.length > 0) {
    return failureAttempt({ ...input, status: 'EVIDENCE_FAILURE', failureCodes: errors })
  }

  const payload = {
    schemaVersion: 1 as const,
    pilotIdentity: assembled.pilotIdentity,
    authorityHash: authority.authorityHash,
    sourceEvidenceManifestHash: assembled.sourceEvidenceManifestHash,
    sourceCaptureArtifactHash: assembled.sourceCaptureArtifactHash,
    liveCaptureArtifactHash: assembled.liveCaptureArtifactHash,
    storySurfaceHash: assembled.storySurfaceHash,
    caseId: assembled.caseAuthority.caseId,
    rubricId: assembled.caseAuthority.rubricId,
    sampleIndex: input.sampleIndex,
    judgeInputHash: assembled.judgeInputHash,
    promptHash: assembled.promptHash,
    configuredExecutionIdentity: authority.executionIdentity,
    observedIdentity: input.observedIdentity,
    status: 'VALID' as const,
    score: response.score,
    modelVerdict: response.modelVerdict,
    confidence: response.confidence,
    findingCodes: response.findingCodes,
    evidenceMode: response.evidenceMode,
    evidenceRefs: response.evidence.map((evidence) => ({
      segmentId: evidence.segmentId,
      quote: evidence.quote,
      quoteHash: computeSha256(evidence.quote),
    })),
    rationaleSummaryHash: computeSha256(response.rationaleSummary),
    failureCodes: [],
  }
  return M10FSemanticAttemptSchema.parse({
    ...payload,
    attemptId: computeSha256(stableStringify(payload)),
  })
}

export function deriveM10FSemanticAggregate(input: {
  assembled: M10FAssembledSemanticCase
  authority: M10FSemanticAuthority
  attempts: M10FSemanticAttempt[]
}): M10FSemanticAggregate {
  const matching = input.attempts.filter((attempt) => attempt.caseId === input.assembled.caseAuthority.caseId)
  const valid = matching.filter((attempt) => attempt.status === 'VALID' && attempt.score !== null)
  const scores = valid.map((attempt) => attempt.score as number).sort((left, right) => left - right)
  const failureCodes = matching.flatMap((attempt) => attempt.failureCodes)
  if (matching.length !== 3) failureCodes.push('REQUIRED_ATTEMPTS_MISSING')
  if (new Set(matching.map((attempt) => attempt.sampleIndex)).size !== matching.length) {
    failureCodes.push('DUPLICATE_SAMPLE_INDEX')
  }
  if (valid.length < 3) failureCodes.push('VALID_SAMPLE_COUNT_BELOW_3')
  const medianScore = scores.length === 3 ? scores[1]! : null
  const scoreSpread = scores.length === 3 ? scores[2]! - scores[0]! : null
  if (scoreSpread !== null && scoreSpread > input.authority.maximumConclusiveSpread) {
    failureCodes.push('SCORE_SPREAD_EXCEEDS_20')
  }
  const conclusive = failureCodes.length === 0 && medianScore !== null
  return M10FSemanticAggregateSchema.parse({
    schemaVersion: 1,
    caseId: input.assembled.caseAuthority.caseId,
    rubricId: input.assembled.caseAuthority.rubricId,
    authorityHash: input.authority.authorityHash,
    judgeInputHash: input.assembled.judgeInputHash,
    promptHash: input.assembled.promptHash,
    attemptRefs: matching.map((attempt) => attempt.attemptId),
    validSampleRefs: valid.map((attempt) => attempt.attemptId),
    validSampleCount: valid.length,
    scores,
    medianScore,
    scoreSpread,
    outcome: conclusive
      ? medianScore >= input.authority.uniformThreshold ? 'PASS' : 'FAIL'
      : 'INCONCLUSIVE',
    failureCodes: [...new Set(failureCodes)].sort(),
  })
}
