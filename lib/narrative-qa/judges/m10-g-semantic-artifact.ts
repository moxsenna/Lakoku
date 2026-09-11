import { resolve } from 'node:path'
import type {
  M10GSemanticAggregate,
  M10GSemanticArtifact,
  M10GSemanticAttempt,
  M10GSemanticAuthority,
  M10GSemanticIdentity,
  M10GStorySurfaceManifest,
} from '../contracts/m10-g-semantic-contract'
import type { M10GAssembledSemanticCase } from '../contracts/m10-g-semantic-contract'
import { M10GSemanticArtifactSchema } from '../contracts/m10-g-semantic-contract'
import { SEMANTIC_FINDING_CODES } from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import { assembleM10GSemanticCases } from './m10-g-semantic-assembly'
import { deriveM10GSemanticAggregate, validateM10GSemanticResponse } from './m10-g-semantic-policy'
import {
  assertM10GAuthoritativeSemanticAttempt,
  type M10GAuthoritativeSemanticAttempt,
} from './m10-g-semantic-executor.server'
import {
  assertM10GExecutablePromptHash,
  m10GSemanticPromptHash,
} from './m10-g-semantic-prompts'
import { M10_G_SEMANTIC_AUTHORITY, assertM10GSemanticAuthority } from '../../../fixtures/m10-g/semantic-authority'

export function computeM10GSemanticArtifactHash(
  artifact: Omit<M10GSemanticArtifact, 'artifactHash'>,
): string {
  return computeSha256(stableStringify(artifact))
}

export function buildM10GSemanticArtifact(input: {
  identity: M10GSemanticIdentity
  authority: M10GSemanticAuthority
  sourceManifestPath: string
  sourceCapturePath: string
  surface: M10GStorySurfaceManifest
  attempts: M10GAuthoritativeSemanticAttempt[]
  aggregates: M10GSemanticAggregate[]
}): M10GSemanticArtifact {
  input.attempts.forEach(assertM10GAuthoritativeSemanticAttempt)
  const serializedAttempts: M10GSemanticAttempt[] = input.attempts.map((attempt) => ({ ...attempt }))
  const observedValidSampleCount = input.attempts.filter((attempt) => attempt.status === 'VALID').length
  const everyRequiredCasePassed = input.aggregates.length === input.authority.requiredCaseCount
    && input.aggregates.every((aggregate) => aggregate.outcome === 'PASS')
  const failureCodes: string[] = []
  if (input.aggregates.length !== input.authority.requiredCaseCount) failureCodes.push('REQUIRED_CASE_COUNT_MISMATCH')
  if (observedValidSampleCount !== input.authority.requiredValidSampleCount) failureCodes.push('REQUIRED_VALID_SAMPLE_COUNT_MISMATCH')
  if (!everyRequiredCasePassed) failureCodes.push('EVERY_REQUIRED_CASE_MUST_PASS')
  const payload = {
    schemaVersion: 1 as const,
    artifactKind: 'M10_G_SEMANTIC_EVIDENCE' as const,
    identity: input.identity,
    authorityHash: input.authority.authorityHash,
    sourceSurfaceAuthorityHash: input.surface.sourceSurfaceAuthorityHash,
    sourceManifestPathHash: computeSha256(resolve(input.sourceManifestPath)),
    sourceManifestContentSha256: input.surface.sourceManifestContentSha256,
    sourceCapturePathHash: computeSha256(resolve(input.sourceCapturePath)),
    sourceCaptureContentSha256: input.surface.sourceCaptureContentSha256,
    storySurfaceHash: input.surface.storySurfaceHash,
    executionIdentity: input.authority.executionIdentity,
    attempts: serializedAttempts,
    aggregates: input.aggregates,
    gate: {
      outcome: failureCodes.length === 0 ? 'PASS' as const
        : input.aggregates.some((aggregate) => aggregate.outcome === 'INCONCLUSIVE')
          ? 'INCONCLUSIVE' as const : 'FAIL' as const,
      requiredCaseCount: 12 as const,
      observedCaseCount: input.aggregates.length,
      requiredValidSampleCount: 36 as const,
      observedValidSampleCount,
      everyRequiredCasePassed,
      failureCodes,
    },
  }
  return M10GSemanticArtifactSchema.parse({
    ...payload,
    artifactHash: computeM10GSemanticArtifactHash(payload),
  })
}

/**
 * Independent re-validation of one recorded attempt. The artifact is untrusted
 * input, so this never delegates to the policy constructor: it re-derives the
 * same VALID/failure invariants directly from the attempt payload and the
 * assembled case.
 */
export function assertM10GSemanticAttemptState(
  attempt: M10GSemanticAttempt,
  authority: M10GSemanticAuthority,
  assembled: M10GAssembledSemanticCase,
): void {
  if (attempt.caseId !== assembled.caseAuthority.caseId) {
    throw new Error(`M10-G semantic attempt caseId mismatch: ${attempt.caseId} !== ${assembled.caseAuthority.caseId}`)
  }
  if (attempt.rubricId !== assembled.caseAuthority.rubricId) {
    throw new Error(`M10-G semantic attempt rubricId mismatch: ${attempt.rubricId} !== ${assembled.caseAuthority.rubricId}`)
  }
  assertM10GExecutablePromptHash(attempt.rubricId, attempt.promptHash)
  const capture = attempt.transportCapture
  const exactIdentity = attempt.observedIdentity.providerId === authority.executionIdentity.providerId
    && attempt.observedIdentity.actualModelId === authority.executionIdentity.expectedActualModelId
    && attempt.observedIdentity.actualModelResolved
    && attempt.observedIdentity.fallbackIndex === authority.executionIdentity.primaryIndex
    && attempt.observedIdentity.routeVersion === authority.executionIdentity.routeVersion
    && capture.providerId === authority.executionIdentity.providerId
    && capture.configuredModelId === authority.executionIdentity.configuredModelId
    && capture.actualModelId === authority.executionIdentity.expectedActualModelId
    && capture.actualModelResolved
    && capture.fallbackIndex === authority.executionIdentity.primaryIndex
    && capture.routeVersion === authority.executionIdentity.routeVersion
  const captureBound = capture.runId === assembled.identity.runId
    && capture.correlationId === assembled.identity.correlationId
    && capture.candidateId === `${assembled.caseAuthority.caseId}:sample-${attempt.sampleIndex}`
    && capture.sampleIndex === attempt.sampleIndex
    && stableStringify(attempt.observedIdentity) === stableStringify({
      providerId: capture.providerId,
      actualModelId: capture.actualModelId,
      actualModelResolved: capture.actualModelResolved,
      fallbackIndex: capture.fallbackIndex,
      routeVersion: capture.routeVersion,
    })
    && attempt.rawResponseSha256 === computeSha256(attempt.rawResponse)
    && attempt.assembledJudgeInputSha256 === computeSha256(stableStringify(assembled.judgeInput))
  const allowedCodes = SEMANTIC_FINDING_CODES[assembled.caseAuthority.rubricId] as readonly string[]
  const complete = attempt.score !== null && attempt.modelVerdict !== null && attempt.confidence !== null
    && attempt.evidenceMode !== null && attempt.findingCodes.length > 0
    && attempt.findingCodes.every((code) => allowedCodes.includes(code))
    && attempt.rationaleSummaryHash !== null
    && (attempt.evidenceRefs.length > 0 || attempt.evidenceMode === 'FULL_HORIZON_ABSENCE')
  if (stableStringify(attempt.configuredExecutionIdentity) !== stableStringify(authority.executionIdentity)) {
    throw new Error(`M10-G semantic configured identity mismatch: ${attempt.caseId}/${attempt.sampleIndex}`)
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
        evidenceRulesValid = evidenceRulesValid
          && new Set(attempt.evidenceRefs.map((evidence) => evidence.segmentId)).size >= 2
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
    let parsedResponse: unknown
    try {
      parsedResponse = JSON.parse(attempt.rawResponse)
    } catch {
      parsedResponse = null
    }
    const responseFacts = parsedResponse && typeof parsedResponse === 'object'
      ? validateM10GSemanticResponse({ assembled, response: parsedResponse as Parameters<typeof validateM10GSemanticResponse>[0]['response'] })
      : null
    const responseBound = responseFacts?.valid === true
      && responseFacts.score === attempt.score
      && responseFacts.modelVerdict === attempt.modelVerdict
      && responseFacts.confidence === attempt.confidence
      && stableStringify(responseFacts.findingCodes) === stableStringify(attempt.findingCodes)
      && responseFacts.evidenceMode === attempt.evidenceMode
      && stableStringify(responseFacts.evidence) === stableStringify(attempt.evidenceRefs.map(({ segmentId, quote }) => ({ segmentId, quote })))
      && computeSha256(responseFacts.rationaleSummary!) === attempt.rationaleSummaryHash
    if (!exactIdentity || !captureBound || capture.outcome !== 'SUCCEEDED' || capture.errorCode !== null
      || capture.finishReason === null || !complete || attempt.failureCodes.length > 0
      || !evidenceRulesValid || !responseBound) {
      throw new Error(`M10-G semantic impossible VALID attempt state: ${attempt.caseId}/${attempt.sampleIndex}`)
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
    if (!captureBound || !failurePayloadEmpty || !statusConsistent) {
      throw new Error(`M10-G semantic impossible failure attempt state: ${attempt.caseId}/${attempt.sampleIndex}`)
    }
  }
}

const assertAttemptState = assertM10GSemanticAttemptState

export function validateM10GSemanticArtifact(input: {
  artifact: unknown
  identity: M10GSemanticIdentity
  expectedArtifactHash?: string
  sourceManifestPath: string
  sourceCapturePath: string
  surface: M10GStorySurfaceManifest
  authority?: M10GSemanticAuthority
}): M10GSemanticArtifact {
  const authority = assertM10GSemanticAuthority(input.authority ?? M10_G_SEMANTIC_AUTHORITY)
  const parsed = M10GSemanticArtifactSchema.parse(input.artifact)
  const { artifactHash, ...payload } = parsed
  if (computeM10GSemanticArtifactHash(payload) !== artifactHash) throw new Error('M10-G semantic artifact hash mismatch')
  if (input.expectedArtifactHash && input.expectedArtifactHash !== artifactHash) throw new Error('M10-G semantic artifact expected hash mismatch')
  if (stableStringify(parsed.identity) !== stableStringify(input.identity)) throw new Error('M10-G semantic identity mismatch')
  if (parsed.authorityHash !== authority.authorityHash) throw new Error('M10-G semantic authority binding mismatch')
  if (stableStringify(parsed.executionIdentity) !== stableStringify(authority.executionIdentity)) throw new Error('M10-G semantic execution identity mismatch')
  const bindings = [
    [parsed.sourceSurfaceAuthorityHash, input.surface.sourceSurfaceAuthorityHash],
    [parsed.sourceManifestPathHash, computeSha256(resolve(input.sourceManifestPath))],
    [parsed.sourceManifestContentSha256, input.surface.sourceManifestContentSha256],
    [parsed.sourceCapturePathHash, computeSha256(resolve(input.sourceCapturePath))],
    [parsed.sourceCaptureContentSha256, input.surface.sourceCaptureContentSha256],
    [parsed.storySurfaceHash, input.surface.storySurfaceHash],
  ]
  if (bindings.some(([observed, expected]) => observed !== expected)) {
    throw new Error('M10-G semantic source authority binding mismatch')
  }
  if (input.identity.kind === 'FORK'
    && parsed.identity.kind === 'FORK'
    && (parsed.identity.parentStoryId !== input.identity.parentStoryId
      || parsed.identity.parentStorySurfaceHash !== input.identity.parentStorySurfaceHash)) {
    throw new Error('M10-G semantic fork parent binding mismatch')
  }
  const assembled = assembleM10GSemanticCases(input.surface, authority)
  const authorizedCaseIds = new Set(assembled.map((semanticCase) => semanticCase.caseAuthority.caseId))
  if (parsed.attempts.some((attempt) => !authorizedCaseIds.has(attempt.caseId))) {
    throw new Error('M10-G semantic attempt references unauthorized case')
  }
  if (parsed.aggregates.length !== 12 || new Set(parsed.aggregates.map((aggregate) => aggregate.caseId)).size !== 12) {
    throw new Error('M10-G semantic artifact requires 12 distinct aggregates')
  }
  for (const semanticCase of assembled) {
    const executablePromptHash = m10GSemanticPromptHash(semanticCase.caseAuthority.rubricId)
    if (semanticCase.promptHash !== executablePromptHash) {
      throw new Error(`M10-G semantic assembled prompt identity mismatch: ${semanticCase.caseAuthority.caseId}`)
    }
    assertM10GExecutablePromptHash(semanticCase.caseAuthority.rubricId, semanticCase.caseAuthority.promptHash)
    const attempts = parsed.attempts.filter((attempt) => attempt.caseId === semanticCase.caseAuthority.caseId)
    if (attempts.length !== 3 || new Set(attempts.map((attempt) => attempt.sampleIndex)).size !== 3) {
      throw new Error(`M10-G semantic attempt topology mismatch: ${semanticCase.caseAuthority.caseId}`)
    }
    for (const attempt of attempts) {
      const { attemptId, ...attemptPayload } = attempt
      if (computeSha256(stableStringify(attemptPayload)) !== attemptId
        || stableStringify(attempt.identity) !== stableStringify(input.identity)
        || attempt.authorityHash !== authority.authorityHash
        || attempt.sourceSurfaceAuthorityHash !== input.surface.sourceSurfaceAuthorityHash
        || attempt.sourceManifestContentSha256 !== input.surface.sourceManifestContentSha256
        || attempt.sourceCaptureContentSha256 !== input.surface.sourceCaptureContentSha256
        || attempt.storySurfaceHash !== input.surface.storySurfaceHash
        || attempt.rubricId !== semanticCase.caseAuthority.rubricId
        || attempt.judgeInputHash !== semanticCase.judgeInputHash
        || attempt.promptHash !== semanticCase.promptHash) {
        throw new Error(`M10-G semantic attempt binding mismatch: ${semanticCase.caseAuthority.caseId}`)
      }
      assertM10GExecutablePromptHash(attempt.rubricId, attempt.promptHash)
      assertAttemptState(attempt, authority, semanticCase)
    }
    const aggregate = parsed.aggregates.find((candidate) => candidate.caseId === semanticCase.caseAuthority.caseId)
    if (!aggregate) {
      throw new Error(`M10-G semantic aggregate missing: ${semanticCase.caseAuthority.caseId}`)
    }
    assertM10GExecutablePromptHash(aggregate.rubricId, aggregate.promptHash)
    const expected = deriveM10GSemanticAggregate({ assembled: semanticCase, authority, attempts })
    if (!aggregate || stableStringify(aggregate) !== stableStringify(expected)) {
      throw new Error(`M10-G semantic aggregate derivation mismatch: ${semanticCase.caseAuthority.caseId}`)
    }
  }
  const validCount = parsed.attempts.filter((attempt) => attempt.status === 'VALID').length
  const everyPass = parsed.aggregates.every((aggregate) => aggregate.outcome === 'PASS')
  const expectedFailureCodes: string[] = []
  if (validCount !== 36) expectedFailureCodes.push('REQUIRED_VALID_SAMPLE_COUNT_MISMATCH')
  if (!everyPass) expectedFailureCodes.push('EVERY_REQUIRED_CASE_MUST_PASS')
  const expectedOutcome = expectedFailureCodes.length === 0 ? 'PASS'
    : parsed.aggregates.some((aggregate) => aggregate.outcome === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'FAIL'
  if (parsed.gate.observedCaseCount !== 12 || parsed.gate.observedValidSampleCount !== validCount
    || parsed.gate.everyRequiredCasePassed !== everyPass
    || stableStringify(parsed.gate.failureCodes) !== stableStringify(expectedFailureCodes)
    || parsed.gate.outcome !== expectedOutcome) {
    throw new Error('M10-G semantic gate derivation mismatch')
  }
  return parsed
}
