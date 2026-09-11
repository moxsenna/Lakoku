import type {
  M10GAssembledSemanticCase,
  M10GSemanticAggregate,
  M10GSemanticAttempt,
  M10GSemanticAuthority,
} from '../contracts/m10-g-semantic-contract'
import { M10GSemanticAggregateSchema } from '../contracts/m10-g-semantic-contract'
import { SEMANTIC_FINDING_CODES } from '../contracts/semantic-judge-contract'
import { deriveSemanticSampleAggregation } from './semantic-sample-aggregation'

export interface M10GRawJudgeResponse {
  score: number
  modelVerdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  confidence: number
  evidenceMode: 'SPAN' | 'FULL_HORIZON_ABSENCE'
  findingCodes: string[]
  evidence: Array<{ segmentId: string; quote: string }>
  absenceCode?: string
  rationaleSummary: string
}

export type M10GResponseValidationFacts = Readonly<{
  valid: boolean
  status: 'VALID' | 'MALFORMED_RESPONSE' | 'EVIDENCE_FAILURE'
  failureCodes: readonly string[]
  score: number | null
  modelVerdict: M10GRawJudgeResponse['modelVerdict'] | null
  confidence: number | null
  findingCodes: readonly string[]
  evidenceMode: M10GRawJudgeResponse['evidenceMode'] | null
  evidence: readonly Readonly<{ segmentId: string; quote: string }>[]
  absenceCode: string | null
  rationaleSummary: string | null
}>

/** Pure response analysis only. Never constructs authoritative execution attempts. */
export function validateM10GSemanticResponse(input: {
  assembled: M10GAssembledSemanticCase
  response: M10GRawJudgeResponse
}): M10GResponseValidationFacts {
  const { assembled, response } = input
  if (!Number.isInteger(response.score) || response.score < 0 || response.score > 100
    || !Number.isInteger(response.confidence) || response.confidence < 0 || response.confidence > 100
    || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(response.modelVerdict)
    || !['SPAN', 'FULL_HORIZON_ABSENCE'].includes(response.evidenceMode)
    || typeof response.rationaleSummary !== 'string' || response.rationaleSummary.length < 1
    || response.rationaleSummary.length > 1_000
    || !Array.isArray(response.findingCodes) || !Array.isArray(response.evidence)) {
    return Object.freeze({
      valid: false, status: 'MALFORMED_RESPONSE', failureCodes: ['MALFORMED_RESPONSE'],
      score: null, modelVerdict: null, confidence: null, findingCodes: [], evidenceMode: null,
      evidence: [], absenceCode: null, rationaleSummary: null,
    })
  }

  const allowed = SEMANTIC_FINDING_CODES[assembled.caseAuthority.rubricId] as readonly string[]
  const errors: string[] = []
  if (response.findingCodes.length < 1 || response.findingCodes.length > 8
    || response.findingCodes.some((code) => !allowed.includes(code))) {
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
      const chapters = response.evidence.flatMap((evidence) => {
        const segment = segments.get(evidence.segmentId)
        return segment ? [segment.chapterNumber] : []
      })
      if (chapters.length < 2 || Math.min(...chapters) >= Math.max(...chapters)) {
        errors.push('D_R6_SETUP_PAYOFF_EVIDENCE_REQUIRED')
      }
    }
    if (assembled.caseAuthority.rubricId === 'D-R7'
      && !response.evidence.some((evidence) => segments.get(evidence.segmentId)?.chapterNumber === 49)) {
      errors.push('D_R7_BAB49_EVIDENCE_REQUIRED')
    }
    if (assembled.caseAuthority.rubricId === 'D-R8') {
      const chapters = response.evidence.flatMap((evidence) => {
        const segment = segments.get(evidence.segmentId)
        return segment ? [segment.chapterNumber] : []
      })
      if (!chapters.includes(50) || !chapters.some((chapter) => chapter >= 41 && chapter <= 49)) {
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
    return Object.freeze({
      valid: false, status: 'EVIDENCE_FAILURE', failureCodes: [...new Set(errors)].sort(),
      score: null, modelVerdict: null, confidence: null, findingCodes: [], evidenceMode: null,
      evidence: [], absenceCode: null, rationaleSummary: null,
    })
  }
  return Object.freeze({
    valid: true, status: 'VALID', failureCodes: [], score: response.score,
    modelVerdict: response.modelVerdict, confidence: response.confidence,
    findingCodes: Object.freeze([...response.findingCodes]), evidenceMode: response.evidenceMode,
    evidence: Object.freeze(response.evidence.map((item) => Object.freeze({ ...item }))),
    absenceCode: response.absenceCode ?? null, rationaleSummary: response.rationaleSummary,
  })
}

export function deriveM10GSemanticAggregate(input: {
  assembled: M10GAssembledSemanticCase
  authority: M10GSemanticAuthority
  attempts: M10GSemanticAttempt[]
}): M10GSemanticAggregate {
  const matching = input.attempts.filter((attempt) => attempt.caseId === input.assembled.caseAuthority.caseId)
  const derived = deriveSemanticSampleAggregation({
    attempts: matching,
    requiredSampleCount: input.authority.sampleCountPerCase,
    threshold: input.authority.uniformThreshold,
    maximumConclusiveSpread: input.authority.maximumConclusiveSpread,
  })
  return M10GSemanticAggregateSchema.parse({
    schemaVersion: 1,
    caseId: input.assembled.caseAuthority.caseId,
    rubricId: input.assembled.caseAuthority.rubricId,
    authorityHash: input.authority.authorityHash,
    judgeInputHash: input.assembled.judgeInputHash,
    promptHash: input.assembled.promptHash,
    ...derived,
  })
}
