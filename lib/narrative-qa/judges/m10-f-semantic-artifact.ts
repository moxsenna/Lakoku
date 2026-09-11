import { resolve } from 'node:path'
import type {
  M10FPilotIdentity,
  M10FSemanticAggregate,
  M10FSemanticArtifact,
  M10FSemanticAttempt,
  M10FSemanticAuthority,
  M10FStorySurfaceManifest,
} from '../contracts/m10-f-semantic-contract'
import { M10FSemanticArtifactSchema } from '../contracts/m10-f-semantic-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import { assembleM10FSemanticCases } from './m10-f-semantic-assembly'
import { SEMANTIC_FINDING_CODES } from '../contracts/semantic-judge-contract'
import { m10FSemanticPromptHash } from './m10-f-semantic-prompts'
import { deriveM10FSemanticAggregate } from './m10-f-semantic-policy'
import {
  M10_F_SEMANTIC_AUTHORITY,
  assertM10FSemanticAuthority,
} from '../../../fixtures/m10-f/semantic-authority'

export function computeM10FSemanticArtifactHash(artifact: Omit<M10FSemanticArtifact, 'artifactHash'>): string {
  return computeSha256(stableStringify(artifact))
}

export function buildM10FSemanticArtifact(input: {
  pilotIdentity: M10FPilotIdentity
  authority: M10FSemanticAuthority
  sourceEvidenceManifestPath: string
  sourceCaptureArtifactPath: string
  liveCaptureArtifactPath: string
  surface: M10FStorySurfaceManifest
  attempts: M10FSemanticAttempt[]
  aggregates: M10FSemanticAggregate[]
}): M10FSemanticArtifact {
  const observedValidSampleCount = input.attempts.filter((attempt) => attempt.status === 'VALID').length
  const everyRequiredCasePassed = input.aggregates.length === input.authority.requiredCaseCount
    && input.aggregates.every((aggregate) => aggregate.outcome === 'PASS')
  const failureCodes: string[] = []
  if (input.aggregates.length !== input.authority.requiredCaseCount) failureCodes.push('REQUIRED_CASE_COUNT_MISMATCH')
  if (observedValidSampleCount !== input.authority.requiredValidSampleCount) failureCodes.push('REQUIRED_VALID_SAMPLE_COUNT_MISMATCH')
  if (!everyRequiredCasePassed) failureCodes.push('EVERY_REQUIRED_CASE_MUST_PASS')
  const payload = {
    schemaVersion: 1 as const,
    artifactKind: 'M10_F_SEMANTIC_EVIDENCE' as const,
    pilotIdentity: input.pilotIdentity,
    authorityHash: input.authority.authorityHash,
    sourceEvidenceManifestPathHash: computeSha256(resolve(input.sourceEvidenceManifestPath)),
    sourceEvidenceManifestHash: input.surface.sourceEvidenceManifestHash,
    sourceCaptureArtifactPathHash: computeSha256(resolve(input.sourceCaptureArtifactPath)),
    sourceCaptureArtifactHash: input.surface.sourceCaptureArtifactHash,
    liveCaptureArtifactPathHash: computeSha256(resolve(input.liveCaptureArtifactPath)),
    liveCaptureArtifactHash: input.surface.liveCaptureArtifactHash,
    storySurfaceHash: input.surface.storySurfaceHash,
    executionIdentity: input.authority.executionIdentity,
    attempts: input.attempts,
    aggregates: input.aggregates,
    gate: {
      outcome: failureCodes.length === 0 ? 'PASS' as const : input.aggregates.some((aggregate) => aggregate.outcome === 'INCONCLUSIVE') ? 'INCONCLUSIVE' as const : 'FAIL' as const,
      requiredCaseCount: 12 as const,
      observedCaseCount: input.aggregates.length,
      requiredValidSampleCount: 36 as const,
      observedValidSampleCount,
      everyRequiredCasePassed,
      failureCodes,
    },
  }
  return M10FSemanticArtifactSchema.parse({ ...payload, artifactHash: computeM10FSemanticArtifactHash(payload) })
}

function assertAttemptState(
  attempt: M10FSemanticAttempt,
  authority: M10FSemanticAuthority,
  assembled: ReturnType<typeof assembleM10FSemanticCases>[number],
): void {
  const exactIdentity = attempt.observedIdentity.providerId === 'openrouter'
    && attempt.observedIdentity.actualModelId === 'deepseek/deepseek-v3.2'
    && attempt.observedIdentity.actualModelResolved
    && attempt.observedIdentity.fallbackIndex === 0
    && attempt.observedIdentity.routeVersion === '2026-08-m10f-live'
  const allowedCodes = SEMANTIC_FINDING_CODES[assembled.caseAuthority.rubricId] as readonly string[]
  const complete = attempt.score !== null && attempt.modelVerdict !== null && attempt.confidence !== null
    && attempt.evidenceMode !== null && attempt.findingCodes.length > 0
    && attempt.findingCodes.every((code) => allowedCodes.includes(code))
    && attempt.rationaleSummaryHash !== null
    && (attempt.evidenceRefs.length > 0 || attempt.evidenceMode === 'FULL_HORIZON_ABSENCE')
  if (stableStringify(attempt.configuredExecutionIdentity) !== stableStringify(authority.executionIdentity)) {
    throw new Error(`M10-F semantic configured identity mismatch: ${attempt.caseId}/${attempt.sampleIndex}`)
  }
  if (attempt.status === 'VALID') {
    const segments = new Map(assembled.judgeInput.segments.map((segment) => [segment.segmentId, segment]))
    const exactEvidence = attempt.evidenceRefs.every((evidence) => {
      const segment = segments.get(evidence.segmentId)
      return evidence.quoteHash === computeSha256(evidence.quote)
        && segment?.content.includes(evidence.quote) === true
    })
    const evidenceChapters = attempt.evidenceRefs.flatMap((evidence) => {
      const segment = segments.get(evidence.segmentId)
      return segment ? [segment.chapterNumber] : []
    })
    let evidenceRulesValid = exactEvidence
    if (attempt.evidenceMode === 'SPAN') {
      evidenceRulesValid = evidenceRulesValid && attempt.evidenceRefs.length > 0
      if (attempt.rubricId === 'D-R4' && attempt.findingCodes.includes('REPETITION_SEMANTIC_DUPLICATE')) {
        evidenceRulesValid = evidenceRulesValid && new Set(attempt.evidenceRefs.map((evidence) => evidence.segmentId)).size >= 2
      }
      if (attempt.rubricId === 'D-R6') {
        evidenceRulesValid = evidenceRulesValid && evidenceChapters.length >= 2
          && Math.min(...evidenceChapters) < Math.max(...evidenceChapters)
      }
      if (attempt.rubricId === 'D-R7') evidenceRulesValid = evidenceRulesValid && evidenceChapters.includes(49)
      if (attempt.rubricId === 'D-R8') {
        evidenceRulesValid = evidenceRulesValid && evidenceChapters.includes(50)
          && evidenceChapters.some((chapter) => chapter >= 41 && chapter <= 49)
      }
    } else {
      evidenceRulesValid = evidenceRulesValid && attempt.rubricId === 'D-R7'
        && attempt.findingCodes.includes('EMOTIONAL_RESOLUTION_ABSENT')
        && attempt.evidenceRefs.length === 0
        && assembled.judgeInput.segments.some((segment) => segment.chapterNumber === 49 && segment.content.length > 0)
    }
    if (!exactIdentity || !complete || attempt.failureCodes.length > 0 || !evidenceRulesValid) {
      throw new Error(`M10-F semantic impossible VALID attempt state: ${attempt.caseId}/${attempt.sampleIndex}`)
    }
  } else {
    const failurePayloadEmpty = attempt.score === null && attempt.modelVerdict === null
      && attempt.confidence === null && attempt.findingCodes.length === 0
      && attempt.evidenceMode === null && attempt.evidenceRefs.length === 0
      && attempt.rationaleSummaryHash === null && attempt.failureCodes.length > 0
    const statusConsistent = attempt.status === 'MODEL_IDENTITY_FAILURE'
      ? !exactIdentity && stableStringify(attempt.failureCodes) === stableStringify(['MODEL_IDENTITY_MISMATCH'])
      : attempt.status === 'TRANSPORT_FAILURE'
        ? stableStringify(attempt.failureCodes) === stableStringify(['SEMANTIC_TRANSPORT_FAILURE'])
        : attempt.status === 'MALFORMED_RESPONSE'
          ? attempt.failureCodes.every((code) => ['MALFORMED_RESPONSE', 'PROMPT_HASH_MISMATCH'].includes(code))
          : attempt.status === 'EVIDENCE_FAILURE'
            ? exactIdentity && attempt.failureCodes.every((code) => [
              'D_R4_DISTINCT_EVIDENCE_REQUIRED', 'D_R6_SETUP_PAYOFF_EVIDENCE_REQUIRED',
              'D_R7_BAB49_EVIDENCE_REQUIRED', 'D_R8_RUNWAY_AND_BAB50_EVIDENCE_REQUIRED',
              'INVALID_FINDING_CODES', 'INVALID_FULL_HORIZON_ABSENCE',
              'MISSING_SPAN_EVIDENCE', 'UNVERIFIABLE_EVIDENCE',
            ].includes(code))
            : false
    if (!failurePayloadEmpty || !statusConsistent) {
      throw new Error(`M10-F semantic impossible failure attempt state: ${attempt.caseId}/${attempt.sampleIndex}`)
    }
  }
}

interface M10FSemanticArtifactValidationInput {
  artifact: unknown
  pilotIdentity: M10FPilotIdentity
  expectedArtifactHash?: string
  sourceEvidenceManifestPath: string
  sourceCaptureArtifactPath: string
  liveCaptureArtifactPath: string
  surface: M10FStorySurfaceManifest
}

/** Pure injection seam for negative tests; production callers must use frozen authority wrapper. */
export function validateM10FSemanticArtifactWithTestAuthority(input: M10FSemanticArtifactValidationInput & {
  authority: M10FSemanticAuthority
}): M10FSemanticArtifact {
  const authority = assertM10FSemanticAuthority(input.authority)
  const parsed = M10FSemanticArtifactSchema.parse(input.artifact)
  const { artifactHash, ...payload } = parsed
  if (computeM10FSemanticArtifactHash(payload) !== artifactHash) throw new Error('M10-F semantic artifact hash mismatch')
  if (input.expectedArtifactHash && input.expectedArtifactHash !== artifactHash) throw new Error('M10-F semantic artifact expected hash mismatch')
  if (parsed.authorityHash !== authority.authorityHash) throw new Error('M10-F semantic authority binding mismatch')
  if (stableStringify(parsed.executionIdentity) !== stableStringify(authority.executionIdentity)) throw new Error('M10-F semantic execution identity mismatch')
  if (stableStringify(parsed.pilotIdentity) !== stableStringify(input.pilotIdentity)) throw new Error('M10-F semantic pilot identity mismatch')
  const sourceBindings = [
    [parsed.sourceEvidenceManifestPathHash, computeSha256(resolve(input.sourceEvidenceManifestPath))],
    [parsed.sourceEvidenceManifestHash, input.surface.sourceEvidenceManifestHash],
    [parsed.sourceCaptureArtifactPathHash, computeSha256(resolve(input.sourceCaptureArtifactPath))],
    [parsed.sourceCaptureArtifactHash, input.surface.sourceCaptureArtifactHash],
    [parsed.liveCaptureArtifactPathHash, computeSha256(resolve(input.liveCaptureArtifactPath))],
    [parsed.liveCaptureArtifactHash, input.surface.liveCaptureArtifactHash],
    [parsed.storySurfaceHash, input.surface.storySurfaceHash],
  ]
  if (sourceBindings.some(([observed, expected]) => observed !== expected)) throw new Error('M10-F semantic source authority binding mismatch')

  const assembledCases = assembleM10FSemanticCases(input.surface, authority)
  const authorizedCaseIds = new Set(assembledCases.map((assembled) => assembled.caseAuthority.caseId))
  if (parsed.attempts.some((attempt) => !authorizedCaseIds.has(attempt.caseId))) {
    throw new Error('M10-F semantic attempt references unauthorized case')
  }
  if (parsed.aggregates.length !== 12 || new Set(parsed.aggregates.map((aggregate) => aggregate.caseId)).size !== 12) {
    throw new Error('M10-F semantic artifact requires 12 distinct aggregates')
  }
  for (const assembled of assembledCases) {
    const caseId = assembled.caseAuthority.caseId
    const aggregate = parsed.aggregates.find((candidate) => candidate.caseId === caseId)
    if (assembled.promptHash !== m10FSemanticPromptHash(assembled.caseAuthority.rubricId)) {
      throw new Error(`M10-F semantic configured prompt identity mismatch: ${caseId}`)
    }
    if (!aggregate || aggregate.rubricId !== assembled.caseAuthority.rubricId
      || aggregate.authorityHash !== authority.authorityHash
      || aggregate.judgeInputHash !== assembled.judgeInputHash
      || aggregate.promptHash !== assembled.promptHash) {
      throw new Error(`M10-F semantic case binding mismatch: ${caseId}`)
    }
    const attempts = parsed.attempts.filter((attempt) => attempt.caseId === caseId)
    if (attempts.length !== authority.sampleCountPerCase
      || new Set(attempts.map((attempt) => attempt.sampleIndex)).size !== authority.sampleCountPerCase
      || attempts.some((attempt) => attempt.sampleIndex >= authority.sampleCountPerCase)) {
      throw new Error(`M10-F semantic attempt topology mismatch: ${caseId}`)
    }
    for (const attempt of attempts) {
      const { attemptId, ...attemptPayload } = attempt
      if (computeSha256(stableStringify(attemptPayload)) !== attemptId) throw new Error(`M10-F semantic attempt hash mismatch: ${caseId}/${attempt.sampleIndex}`)
      if (stableStringify(attempt.pilotIdentity) !== stableStringify(input.pilotIdentity)
        || attempt.authorityHash !== authority.authorityHash
        || attempt.sourceEvidenceManifestHash !== input.surface.sourceEvidenceManifestHash
        || attempt.sourceCaptureArtifactHash !== input.surface.sourceCaptureArtifactHash
        || attempt.liveCaptureArtifactHash !== input.surface.liveCaptureArtifactHash
        || attempt.storySurfaceHash !== input.surface.storySurfaceHash
        || attempt.rubricId !== assembled.caseAuthority.rubricId
        || attempt.judgeInputHash !== assembled.judgeInputHash
        || attempt.promptHash !== assembled.promptHash) {
        throw new Error(`M10-F semantic attempt binding mismatch: ${caseId}`)
      }
      assertAttemptState(attempt, authority, assembled)
    }
    const expectedAggregate = deriveM10FSemanticAggregate({ assembled, authority, attempts })
    if (stableStringify(aggregate) !== stableStringify(expectedAggregate)) throw new Error(`M10-F semantic aggregate derivation mismatch: ${caseId}`)
  }
  const validCount = parsed.attempts.filter((attempt) => attempt.status === 'VALID').length
  const everyPass = parsed.aggregates.length === authority.requiredCaseCount && parsed.aggregates.every((aggregate) => aggregate.outcome === 'PASS')
  const expectedFailureCodes: string[] = []
  if (parsed.aggregates.length !== authority.requiredCaseCount) expectedFailureCodes.push('REQUIRED_CASE_COUNT_MISMATCH')
  if (validCount !== authority.requiredValidSampleCount) expectedFailureCodes.push('REQUIRED_VALID_SAMPLE_COUNT_MISMATCH')
  if (!everyPass) expectedFailureCodes.push('EVERY_REQUIRED_CASE_MUST_PASS')
  const expectedOutcome = expectedFailureCodes.length === 0 ? 'PASS' : parsed.aggregates.some((aggregate) => aggregate.outcome === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'FAIL'
  if (parsed.gate.observedCaseCount !== parsed.aggregates.length || parsed.gate.observedValidSampleCount !== validCount
    || parsed.gate.everyRequiredCasePassed !== everyPass || stableStringify(parsed.gate.failureCodes) !== stableStringify(expectedFailureCodes)
    || parsed.gate.outcome !== expectedOutcome) throw new Error('M10-F semantic gate derivation mismatch')
  return parsed
}

/** Production validation pins artifact to committed PM authority root. */
export function validateM10FSemanticArtifact(
  input: M10FSemanticArtifactValidationInput,
): M10FSemanticArtifact {
  const frozenAuthority = assertM10FSemanticAuthority(M10_F_SEMANTIC_AUTHORITY)
  return validateM10FSemanticArtifactWithTestAuthority({
    ...input,
    authority: frozenAuthority,
  })
}

export function deriveM10FSemanticGateEvidence(artifact: M10FSemanticArtifact | null) {
  if (!artifact) return { passed: false, outcome: 'INCONCLUSIVE' as const, requiredCaseCount: 12 as const, observedCaseCount: 0, requiredValidSampleCount: 36 as const, observedValidSampleCount: 0, everyRequiredCasePassed: false, failureCodes: ['SEMANTIC_ARTIFACT_MISSING'] }
  return { passed: artifact.gate.outcome === 'PASS', ...artifact.gate }
}
