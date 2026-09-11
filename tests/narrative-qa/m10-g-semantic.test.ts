import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { M10_F_SEMANTIC_AUTHORITY } from '../../fixtures/m10-f/semantic-authority'
import {
  M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN,
  M10_G_PROJECTED_CASE_LIST_HASH_PIN,
  M10_G_SEMANTIC_AUTHORITY,
  assertM10GInheritedM10FPins,
  assertM10GSemanticAuthority,
  computeM10GSemanticAuthorityHash,
} from '../../fixtures/m10-g/semantic-authority'
import {
  M10GSemanticIdentitySchema,
  type M10GAssembledSemanticCase,
  type M10GSemanticAttempt,
  type M10GSemanticAuthority,
  type M10GSemanticIdentity,
  type M10GStorySurfaceManifest,
} from '../../lib/narrative-qa/contracts/m10-g-semantic-contract'
import type { SemanticRubricId } from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import { createGlobalInferenceBudget } from '../../lib/ai-gateway/global-inference-budget.contract'
import {
  M10G_SOURCE_PROVENANCE_VERIFICATION_SCOPE,
  assembleM10GSemanticCases,
  computeM10GChapterContentHash,
  computeM10GChapterSurfaceHash,
  computeM10GSourceSurfaceAuthorityHash,
  computeM10GStorySurfaceHash,
  computeM10GStructuralContextHash,
  validateM10GStorySurface,
} from '../../lib/narrative-qa/judges/m10-g-semantic-assembly'
import {
  assertM10GSemanticAttemptState,
  buildM10GSemanticArtifact,
  computeM10GSemanticArtifactHash,
  validateM10GSemanticArtifact,
} from '../../lib/narrative-qa/judges/m10-g-semantic-artifact'
import * as m10gSemanticPolicy from '../../lib/narrative-qa/judges/m10-g-semantic-policy'
import {
  executeM10GSemanticJudge,
  type M10GAuthoritativeSemanticAttempt,
} from '../../lib/narrative-qa/judges/m10-g-semantic-executor.server'
import {
  deriveM10GSemanticAggregate,
  validateM10GSemanticResponse,
  type M10GRawJudgeResponse,
} from '../../lib/narrative-qa/judges/m10-g-semantic-policy'
import { evaluateM10GSemanticSurfaceLoaderReadiness } from '../../lib/narrative-qa/judges/m10-g-semantic-readiness'
import {
  M10_G_PROMPT_TEMPLATE_VERSION,
  M10_G_RUBRIC_PROMPT_HASHES,
  assertM10GExecutablePromptHash,
  buildM10GSemanticPrompt,
  m10GSemanticPromptHash,
} from '../../lib/narrative-qa/judges/m10-g-semantic-prompts'
import { M10_F_RUBRIC_PROMPT_HASHES } from '../../lib/narrative-qa/judges/m10-f-semantic-prompts'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'

const sourceManifestPath = 'private/m10-g/manifest.json'
const sourceCapturePath = 'private/m10-g/captures.json'
const sourceManifestContentSha256 = computeSha256('manifest exact bytes')
const sourceCaptureContentSha256 = computeSha256('capture exact bytes')

const identities = {
  g1: {
    kind: 'NOVEL', profileId: 'G1', routeClass: 'HIGH_TRUST',
    storyId: 'm10c-m10g-g1-proof', runId: 'g1-run',
    correlationId: '11111111-1111-4111-8111-111111111111',
  },
  g2: {
    kind: 'NOVEL', profileId: 'G2', routeClass: 'LOW_TRUST',
    storyId: 'm10c-m10g-g2-proof', runId: 'g2-run',
    correlationId: '22222222-2222-4222-8222-222222222222',
  },
  g3: {
    kind: 'NOVEL', profileId: 'G3', routeClass: 'MIXED',
    storyId: 'm10c-m10g-g3-proof', runId: 'g3-run',
    correlationId: '33333333-3333-4333-8333-333333333333',
  },
  fork: {
    kind: 'FORK', profileId: 'FORK', storyId: 'm10c-m10g-fork-late-b',
    runId: 'fork-run', correlationId: '44444444-4444-4444-8444-444444444444',
    parentStoryId: 'm10c-m10g-g1-proof', parentStorySurfaceHash: computeSha256('parent surface'),
    forkChapterNumber: 40, branchId: 'late-b',
  },
} as const satisfies Record<string, M10GSemanticIdentity>

const observedIdentity = {
  providerId: 'openrouter',
  actualModelId: 'deepseek/deepseek-v3.2',
  actualModelResolved: true,
  fallbackIndex: 0,
  routeVersion: '2026-08-m10g-live',
}

function storySurface(identity: M10GSemanticIdentity): M10GStorySurfaceManifest {
  const chapters = Array.from({ length: 50 }, (_, index) => {
    const chapterNumber = index + 1
    const title = `Bab ${chapterNumber}`
    const paragraphs = [`Lintasan ${identity.storyId} Bab ${chapterNumber} bergerak dan membayar janji.`]
    const payload = {
      chapterNumber, title, paragraphs,
      contentHash: computeM10GChapterContentHash(title, paragraphs),
      sourceChapterContentSha256: computeSha256(`source:${identity.storyId}:${chapterNumber}`),
    }
    return { ...payload, chapterHash: computeM10GChapterSurfaceHash(payload) }
  })
  const structuralContext = {
    storyPromise: 'Janji cerita.', mainConflict: 'Konflik utama.', finalQuestion: 'Pertanyaan akhir?',
    activeThreadSummaries: [], resolvedThreadSummaries: ['Utas selesai.'],
    payoffSchedule: ['Bayar janji.'], lockedEndingKey: 'ending-jujur', actPosition: 'Novel lengkap.',
  }
  const authorityPayload = {
    schemaVersion: 1 as const,
    identity,
    sourceManifestContentSha256,
    sourceCaptureContentSha256,
    chapters: chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber, title: chapter.title,
      contentHash: chapter.contentHash, sourceChapterContentSha256: chapter.sourceChapterContentSha256,
    })),
    structuralContextHash: computeM10GStructuralContextHash(structuralContext),
  }
  const sourceSurfaceAuthority = {
    ...authorityPayload,
    authorityHash: computeM10GSourceSurfaceAuthorityHash(authorityPayload),
  }
  const payload = {
    schemaVersion: 1 as const,
    identity,
    sourceSurfaceAuthorityHash: sourceSurfaceAuthority.authorityHash,
    sourceManifestPathHash: computeSha256(resolve(sourceManifestPath)),
    sourceManifestContentSha256,
    sourceCapturePathHash: computeSha256(resolve(sourceCapturePath)),
    sourceCaptureContentSha256,
    chapters,
    structuralContext,
  }
  const raw = { ...payload, storySurfaceHash: computeM10GStorySurfaceHash(payload) }
  return validateM10GStorySurface(raw, identity, {
    sourceManifestPath, sourceManifestContentSha256,
    sourceCapturePath, sourceCaptureContentSha256, sourceSurfaceAuthority,
  })
}

function validResponse(assembled: M10GAssembledSemanticCase, score: number): M10GRawJudgeResponse {
  const first = assembled.judgeInput.segments[0]!
  const last = assembled.judgeInput.segments.at(-1)!
  const codes = {
    'D-R1': 'PACING_PRESSURE_PRESENT',
    'D-R2': 'ARC_COSTLY_CHANGE',
    'D-R3': 'CONFLICT_OPTIONS_NARROWED',
    'D-R4': 'REPETITION_NONE',
    'D-R5': 'CHAPTER_MOVES_STORY',
    'D-R6': 'PAYOFF_USES_SETUP',
    'D-R7': 'EMOTIONAL_RESOLUTION_PRESENT',
    'D-R8': 'ENDING_EARNED',
  } as const
  const evidenceSegments = assembled.caseAuthority.rubricId === 'D-R6'
    || assembled.caseAuthority.rubricId === 'D-R8'
    ? [first, last]
    : assembled.caseAuthority.rubricId === 'D-R7'
      ? [assembled.judgeInput.segments.find((segment) => segment.chapterNumber === 49)!]
      : [last]
  return {
    score,
    modelVerdict: 'FAIL',
    confidence: 0,
    evidenceMode: 'SPAN',
    findingCodes: [codes[assembled.caseAuthority.rubricId]],
    evidence: evidenceSegments.map((segment) => ({
      segmentId: segment.segmentId,
      quote: segment.content.slice(0, 30),
    })),
    rationaleSummary: 'Ringkasan diagnostik.',
  }
}

function validAttempt(
  assembled: M10GAssembledSemanticCase,
  sampleIndex: number,
  score: number,
): M10GAuthoritativeSemanticAttempt {
  const rawResponse = JSON.stringify(validResponse(assembled, score))
  return executeM10GSemanticJudge({
    assembled,
    authority: M10_G_SEMANTIC_AUTHORITY,
    sampleIndex,
    executionOptions: {
      telemetryContext: {
        userId: '99999999-9999-4999-9999-999999999999',
        storyId: assembled.identity.storyId,
        chapterNumber: null,
        generationKind: null,
        jobId: null,
        correlationId: assembled.identity.correlationId,
        attemptNumber: null,
      },
      workflowPhase: 'M10_G_SEMANTIC_JUDGE_TEST',
    },
    transport: ({ candidateId }) => ({
      rawResponse,
      capture: Object.freeze({
        runId: assembled.identity.runId,
        correlationId: assembled.identity.correlationId,
        candidateId,
        sampleIndex,
        providerId: 'openrouter',
        configuredModelId: 'deepseek/deepseek-v3.2',
        routeVersion: '2026-08-m10g-live',
        fallbackIndex: 0,
        actualModelId: 'deepseek/deepseek-v3.2',
        actualModelResolved: true,
        finishReason: 'stop',
        outcome: 'SUCCEEDED',
        errorCode: null,
      }),
    }),
  })
}

function completeArtifact(identity: M10GSemanticIdentity) {
  const surface = storySurface(identity)
  const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)
  const attempts = assembled.flatMap((semanticCase) =>
    [0, 1, 2].map((sampleIndex) => validAttempt(semanticCase, sampleIndex, 80)))
  const aggregates = assembled.map((semanticCase) => deriveM10GSemanticAggregate({
    assembled: semanticCase, authority: M10_G_SEMANTIC_AUTHORITY, attempts,
  }))
  const artifact = buildM10GSemanticArtifact({
    identity, authority: M10_G_SEMANTIC_AUTHORITY,
    sourceManifestPath, sourceCapturePath, surface, attempts, aggregates,
  })
  return { surface, assembled, attempts, artifact }
}

describe('M10-G semantic surface authority', () => {
  it('owns distinct authority while inheriting exact frozen policy and 12x3 topology', () => {
    const authority = assertM10GSemanticAuthority(M10_G_SEMANTIC_AUTHORITY)
    expect(authority.inheritedM10FAuthorityHash).toBe(M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN)
    expect(authority).toMatchObject({
      uniformThreshold: 80, sampleCountPerCase: 3, aggregation: 'MEDIAN',
      maximumConclusiveSpread: 20, requiredCaseCount: 12, requiredValidSampleCount: 36,
    })
    expect(authority.cases).toHaveLength(12)
    expect(authority.cases.length * authority.sampleCountPerCase).toBe(36)
    expect(authority.cases.every((item) => item.caseId.startsWith('m10-g-'))).toBe(true)
    expect(authority.authorityHash).not.toBe(M10_F_SEMANTIC_AUTHORITY.authorityHash)
    expect(authority.executionIdentity.routeVersion).toBe('2026-08-m10g-live')
  })

  it('pins the inherited M10-F authority independently and fails closed on live drift', () => {
    expect(M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN)
      .toBe('182bbf79485605196813372b93345e96bbbb622fc4d6fb88852c7abb9dc3b0c2')
    expect(M10_G_PROJECTED_CASE_LIST_HASH_PIN)
      .toBe('aba2b2a48da24ccdb83cad66cb434135cad331c2777754e38264e8ad7fec59a4')
    expect(M10_F_SEMANTIC_AUTHORITY.authorityHash).toBe(M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN)
    expect(computeSha256(stableStringify(M10_G_SEMANTIC_AUTHORITY.cases)))
      .toBe(M10_G_PROJECTED_CASE_LIST_HASH_PIN)

    expect(() => assertM10GInheritedM10FPins({
      liveM10FAuthorityHash: 'a'.repeat(64),
      projectedCases: M10_G_SEMANTIC_AUTHORITY.cases,
    })).toThrow('inherited M10-F authority hash drift')
    expect(() => assertM10GInheritedM10FPins({
      liveM10FAuthorityHash: M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN,
      projectedCases: M10_G_SEMANTIC_AUTHORITY.cases.slice(0, 11),
    })).toThrow('projected case list hash drift')
    expect(() => assertM10GInheritedM10FPins({
      liveM10FAuthorityHash: M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN,
      projectedCases: M10_G_SEMANTIC_AUTHORITY.cases,
    })).not.toThrow()
  })

  it('rejects a rehashed authority that rebinds a different M10-F inheritance', () => {
    const { authorityHash: _authorityHash, ...payload } = M10_G_SEMANTIC_AUTHORITY
    const rebound = { ...payload, inheritedM10FAuthorityHash: 'b'.repeat(64) }
    expect(() => assertM10GSemanticAuthority({
      ...rebound,
      authorityHash: computeM10GSemanticAuthorityHash(rebound),
    })).toThrow('inherited M10-F authority hash drift')
  })

  it.each(Object.entries(identities))('accepts explicit %s identity and rejects profile substitution', (_name, identity) => {
    expect(M10GSemanticIdentitySchema.parse(identity)).toEqual(identity)
  })

  it('rejects G profile/route/story mismatches and legacy M10-F identity', () => {
    expect(() => M10GSemanticIdentitySchema.parse({ ...identities.g1, routeClass: 'LOW_TRUST' })).toThrow()
    expect(() => M10GSemanticIdentitySchema.parse({ ...identities.g1, storyId: identities.g2.storyId })).toThrow()
    expect(() => M10GSemanticIdentitySchema.parse({
      kind: 'NOVEL', profileId: 'G1', routeClass: 'HIGH_TRUST',
      storyId: 'm10c-m10f-semantic-test', runId: 'legacy',
      correlationId: '55555555-5555-4555-8555-555555555555',
    })).toThrow()
  })

  it('assembles all four identity classes only after source-authority validation', () => {
    for (const identity of Object.values(identities)) {
      const surface = storySurface(identity)
      expect(assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)).toHaveLength(12)
      const clone = structuredClone(surface)
      expect(() => assembleM10GSemanticCases(clone, M10_G_SEMANTIC_AUTHORITY))
        .toThrow('source-authority-validated story surface')
    }
  })

  it('declares source provenance as caller-asserted content digests, not git or byte verification', () => {
    expect(M10G_SOURCE_PROVENANCE_VERIFICATION_SCOPE).toEqual({
      assertionOrigin: 'CALLER_ASSERTED_CONTENT_DIGESTS',
      verifies: [
        'DECLARED_CONTENT_DIGEST_INTERNAL_CONSISTENCY',
        'SOURCE_SURFACE_AUTHORITY_SELF_HASH',
        'CHAPTER_CONTENT_AND_SURFACE_SELF_HASH',
        'STRUCTURAL_CONTEXT_SELF_HASH',
        'STORY_SURFACE_SELF_HASH',
      ],
      doesNotVerify: [
        'SOURCE_BYTES_READ_FROM_DISK',
        'GIT_OBJECT_IDENTITY',
        'DATABASE_PROVENANCE',
        'CONTENT_DIGEST_ORIGIN',
      ],
    })
  })

  it('binds fork parent story ID and parent surface hash into surface, attempts, and artifact hash', () => {
    const { surface, artifact } = completeArtifact(identities.fork)
    expect(artifact.artifactKind).toBe('M10_G_SEMANTIC_EVIDENCE')
    expect(artifact.gate).toMatchObject({ outcome: 'PASS', observedCaseCount: 12, observedValidSampleCount: 36 })
    expect(validateM10GSemanticArtifact({
      artifact, identity: identities.fork, expectedArtifactHash: artifact.artifactHash,
      sourceManifestPath, sourceCapturePath, surface,
    })).toEqual(artifact)

    const wrongParent = { ...identities.fork, parentStorySurfaceHash: computeSha256('other parent') }
    expect(() => validateM10GSemanticArtifact({
      artifact, identity: wrongParent, sourceManifestPath, sourceCapturePath, surface,
    })).toThrow('semantic identity mismatch')
  })

  it('rejects source content digest substitution and recomputed artifact forgery', () => {
    const { surface, artifact } = completeArtifact(identities.g1)
    const substitutedSurface = { ...surface, sourceCaptureContentSha256: computeSha256('substitute') }
    expect(() => validateM10GSemanticArtifact({
      artifact, identity: identities.g1, sourceManifestPath, sourceCapturePath,
      surface: substitutedSurface,
    })).toThrow('source authority binding mismatch')

    const forged = structuredClone(artifact)
    forged.attempts[0]!.sourceCaptureContentSha256 = computeSha256('substitute')
    const { attemptId: _attemptId, ...attemptPayload } = forged.attempts[0]!
    forged.attempts[0]!.attemptId = computeSha256(stableStringify(attemptPayload))
    const { artifactHash: _artifactHash, ...artifactPayload } = forged
    forged.artifactHash = computeM10GSemanticArtifactHash(artifactPayload)
    expect(() => validateM10GSemanticArtifact({
      artifact: forged, identity: identities.g1, sourceManifestPath, sourceCapturePath, surface,
    })).toThrow('attempt binding mismatch')
  })

  it('rejects a fully rehashed attempt whose rubricId drifts from the case authority', () => {
    const { surface, assembled, artifact } = completeArtifact(identities.g1)
    const forged = structuredClone(artifact)
    const target = forged.attempts.find((attempt) => attempt.rubricId !== 'D-R5')!
    target.rubricId = 'D-R5'
    const { attemptId: _attemptId, ...attemptPayload } = target
    target.attemptId = computeSha256(stableStringify(attemptPayload))
    const targetCase = assembled.find((c) => c.caseAuthority.caseId === target.caseId)!
    const aggregateIndex = forged.aggregates.findIndex((a) => a.caseId === target.caseId)
    forged.aggregates[aggregateIndex] = deriveM10GSemanticAggregate({
      assembled: targetCase,
      authority: M10_G_SEMANTIC_AUTHORITY,
      attempts: forged.attempts.filter((a) => a.caseId === target.caseId),
    })
    const { artifactHash: _artifactHash, ...artifactPayload } = forged
    forged.artifactHash = computeM10GSemanticArtifactHash(artifactPayload)
    expect(computeM10GSemanticArtifactHash(artifactPayload)).toBe(forged.artifactHash)
    expect(() => validateM10GSemanticArtifact({
      artifact: forged, identity: identities.g1, sourceManifestPath, sourceCapturePath, surface,
    })).toThrow('attempt binding mismatch')
  })

  it('assertM10GSemanticAttemptState validates attempt rubricId and caseId match assembled case', () => {
    const { assembled } = completeArtifact(identities.g1)
    const firstCase = assembled[0]!
    const attempt = validAttempt(firstCase, 0, 80)
    expect(() => assertM10GSemanticAttemptState(attempt, M10_G_SEMANTIC_AUTHORITY, firstCase)).not.toThrow()

    const wrongRubric = { ...attempt, rubricId: 'D-R5' as const }
    expect(() => assertM10GSemanticAttemptState(wrongRubric, M10_G_SEMANTIC_AUTHORITY, firstCase))
      .toThrow('rubricId mismatch')

    const wrongCaseId = { ...attempt, caseId: 'm10-g-d-r2-wrong' }
    expect(() => assertM10GSemanticAttemptState(wrongCaseId, M10_G_SEMANTIC_AUTHORITY, firstCase))
      .toThrow('caseId mismatch')
  })

  it.each([
    ['provider identity', (attempt: M10GSemanticAttempt) => {
      attempt.observedIdentity.providerId = 'forged-provider'
    }, 'impossible VALID attempt state'],
    ['evidence quote', (attempt: M10GSemanticAttempt) => {
      attempt.evidenceRefs[0]!.quote = 'forged quote outside source prose'
      attempt.evidenceRefs[0]!.quoteHash = computeSha256(attempt.evidenceRefs[0]!.quote)
    }, 'impossible VALID attempt state'],
    ['status fields', (attempt: M10GSemanticAttempt) => {
      attempt.status = 'TRANSPORT_FAILURE'
      attempt.failureCodes = ['SEMANTIC_TRANSPORT_FAILURE']
    }, 'impossible failure attempt state'],
    ['rubricId drift', (attempt: M10GSemanticAttempt) => {
      attempt.rubricId = 'D-R5'
    }, 'attempt binding mismatch'],
    ['raw response digest', (attempt: M10GSemanticAttempt) => {
      attempt.rawResponseSha256 = computeSha256('forged raw response digest')
    }, 'impossible VALID attempt state'],
    ['assembled input digest', (attempt: M10GSemanticAttempt) => {
      attempt.assembledJudgeInputSha256 = computeSha256('forged assembled input digest')
    }, 'impossible VALID attempt state'],
    ['capture provenance', (attempt: M10GSemanticAttempt) => {
      attempt.transportCapture.candidateId = 'forged:candidate'
    }, 'impossible VALID attempt state'],
  ])('rejects forged %s after attempt, aggregate, and artifact hashes are recomputed', (_label, forge, message) => {
    const { surface, assembled, artifact } = completeArtifact(identities.g1)
    const forged = structuredClone(artifact)
    const attempt = forged.attempts[0]!
    forge(attempt)
    const { attemptId: _attemptId, ...attemptPayload } = attempt
    attempt.attemptId = computeSha256(stableStringify(attemptPayload))
    forged.aggregates[0] = deriveM10GSemanticAggregate({
      assembled: assembled[0]!,
      authority: M10_G_SEMANTIC_AUTHORITY,
      attempts: forged.attempts.filter((candidate) => candidate.caseId === assembled[0]!.caseAuthority.caseId),
    })
    const { artifactHash: _artifactHash, ...artifactPayload } = forged
    forged.artifactHash = computeM10GSemanticArtifactHash(artifactPayload)
    expect(() => validateM10GSemanticArtifact({
      artifact: forged, identity: identities.g1, sourceManifestPath, sourceCapturePath, surface,
    })).toThrow(message)
  })

  it('exposes no public constructor that mints a VALID attempt without response facts', () => {
    expect(Object.keys(m10gSemanticPolicy).sort()).toEqual([
      'deriveM10GSemanticAggregate',
      'validateM10GSemanticResponse',
    ])
  })

  it('records configured and observed model identity plus evidence facts on VALID attempts', () => {
    const { attempts } = completeArtifact(identities.g1)
    for (const attempt of attempts) {
      expect(attempt.status).toBe('VALID')
      expect(attempt.configuredExecutionIdentity).toEqual(M10_G_SEMANTIC_AUTHORITY.executionIdentity)
      expect(attempt.observedIdentity).toEqual(observedIdentity)
      expect(attempt.modelVerdict).toBe('FAIL')
      expect(attempt.confidence).toBe(0)
      expect(attempt.findingCodes.length).toBeGreaterThan(0)
      expect(attempt.evidenceMode).toBe('SPAN')
      expect(attempt.evidenceRefs.length).toBeGreaterThan(0)
      expect(attempt.rationaleSummaryHash).toBe(computeSha256('Ringkasan diagnostik.'))
      expect(attempt.failureCodes).toEqual([])
      for (const evidence of attempt.evidenceRefs) {
        expect(evidence.quoteHash).toBe(computeSha256(evidence.quote))
      }
    }
  })

  it('returns non-authoritative response facts and rejects direct facts at artifact boundary', () => {
    const surface = storySurface(identities.g2)
    const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)[0]!
    const facts = validateM10GSemanticResponse({ assembled, response: validResponse(assembled, 95) })
    expect(facts).toMatchObject({ valid: true, status: 'VALID', score: 95 })
    expect(facts).not.toHaveProperty('attemptId')
    expect(facts).not.toHaveProperty('observedIdentity')
    expectTypeOf(facts).not.toMatchTypeOf<M10GSemanticAttempt>()
    expect(() => buildM10GSemanticArtifact({
      identity: identities.g2, authority: M10_G_SEMANTIC_AUTHORITY,
      sourceManifestPath, sourceCapturePath, surface,
      attempts: [facts] as unknown as M10GAuthoritativeSemanticAttempt[], aggregates: [],
    })).toThrow('requires executor-issued authoritative attempts')

    const malformed = validateM10GSemanticResponse({
      assembled, response: { ...validResponse(assembled, 95), score: 101 },
    })
    expect(malformed).toMatchObject({ valid: false, status: 'MALFORMED_RESPONSE' })
    const fabricated = validateM10GSemanticResponse({
      assembled,
      response: {
        ...validResponse(assembled, 95),
        evidence: [{ segmentId: assembled.judgeInput.segments[0]!.segmentId, quote: 'kutipan palsu' }],
      },
    })
    expect(fabricated.failureCodes).toContain('UNVERIFIABLE_EVIDENCE')
  })

  it('rejects an artifact whose VALID attempt carries no evidence or identity proof', () => {
    const { surface, assembled, attempts, artifact } = completeArtifact(identities.g3)
    const aggregates = assembled.map((semanticCase) => deriveM10GSemanticAggregate({
      assembled: semanticCase, authority: M10_G_SEMANTIC_AUTHORITY, attempts,
    }))
    expect(aggregates).toHaveLength(12)

    const forged = structuredClone(artifact)
    const target = forged.attempts[0]!
    target.evidenceRefs = []
    target.findingCodes = []
    target.rationaleSummaryHash = null
    const { attemptId: _attemptId, ...attemptPayload } = target
    target.attemptId = computeSha256(stableStringify(attemptPayload))
    const { artifactHash: _artifactHash, ...artifactPayload } = forged
    forged.artifactHash = computeM10GSemanticArtifactHash(artifactPayload)
    expect(() => validateM10GSemanticArtifact({
      artifact: forged, identity: identities.g3, sourceManifestPath, sourceCapturePath, surface,
    })).toThrow('impossible VALID attempt state')
  })

  it('reserves semantic candidate at shared budget seam before injected transport', () => {
    const surface = storySurface(identities.g1)
    const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)[0]!
    const budget = createGlobalInferenceBudget({ runId: identities.g1.runId, hardLimit: 1 })
    const rawResponse = JSON.stringify(validResponse(assembled, 80))
    const transport = vi.fn(({ candidateId }: { candidateId: string }) => ({
      rawResponse,
      capture: {
        runId: identities.g1.runId, correlationId: identities.g1.correlationId,
        candidateId, sampleIndex: 0, providerId: 'openrouter',
        configuredModelId: 'deepseek/deepseek-v3.2', routeVersion: '2026-08-m10g-live',
        fallbackIndex: 0, actualModelId: 'deepseek/deepseek-v3.2', actualModelResolved: true,
        finishReason: 'stop', outcome: 'SUCCEEDED' as const, errorCode: null,
      },
    }))
    const execute = () => executeM10GSemanticJudge({
      assembled, authority: M10_G_SEMANTIC_AUTHORITY, sampleIndex: 0,
      executionOptions: {
        telemetryContext: {
          userId: '99999999-9999-4999-9999-999999999999', storyId: identities.g1.storyId,
          chapterNumber: null, generationKind: null, jobId: null,
          correlationId: identities.g1.correlationId, attemptNumber: null,
        },
        workflowPhase: 'M10_G_SEMANTIC_JUDGE_TEST', m10gMode: true, globalInferenceBudget: budget,
      },
      transport,
    })
    expect(execute().status).toBe('VALID')
    expect(budget.consumed).toBe(1)
    expect(() => execute()).toThrow('M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('binds deterministic injected capture and exact raw/input digests without network', () => {
    const surface = storySurface(identities.g1)
    const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)[0]!
    const attempt = validAttempt(assembled, 0, 80)
    expect(attempt).toMatchObject({
      status: 'VALID', rawResponseSha256: computeSha256(attempt.rawResponse),
      assembledJudgeInputSha256: assembled.judgeInputHash,
      transportCapture: {
        runId: identities.g1.runId, correlationId: identities.g1.correlationId,
        candidateId: `${assembled.caseAuthority.caseId}:sample-0`, sampleIndex: 0,
        finishReason: 'stop', outcome: 'SUCCEEDED', errorCode: null,
      },
    })
  })

  it('reports architecture ready while future source artifacts remain execute-time inputs', () => {
    expect(evaluateM10GSemanticSurfaceLoaderReadiness()).toEqual({
      ok: true,
      code: null,
      architectureStatus: 'ARCHITECTURE_READY',
      runInputStatus: 'RUN_INPUTS_NOT_YET_AVAILABLE',
      architectureSurfaces: [
        'FROZEN_SEMANTIC_AUTHORITY',
        'TRUSTED_PRODUCTION_EXECUTOR',
        'GLOBAL_CANDIDATE_BUDGET_SEAM',
        'TRUSTED_SOURCE_BYTE_LOADER',
        'INJECTED_DB_ROW_LOADER',
        'PRODUCTION_ISOLATED_DB_LOADER',
        'TRUSTED_CAPTURE_WRITER',
        'DETERMINISTIC_CAPTURE_VALIDATOR',
        'GUARDED_CLI',
      ],
      executeTimeBlockers: [
        'FROZEN_M10G_SOURCE_MANIFEST_NOT_YET_PROVIDED',
        'FROZEN_M10G_SOURCE_CAPTURE_NOT_YET_PROVIDED',
        'M10G_STORY_IDENTITY_NOT_YET_PROVIDED',
        'M10G_GLOBAL_BUDGET_AUTHORITY_NOT_YET_PROVIDED',
        'M10G_EXECUTION_AUTHORIZATION_NOT_YET_PROVIDED',
      ],
    })
  })

  it.each([
    [[79, 79, 79], 'FAIL'], [[80, 80, 80], 'PASS'],
    [[60, 80, 80], 'PASS'], [[59, 80, 80], 'INCONCLUSIVE'],
  ] as const)('applies frozen MEDIAN policy to %j as %s', (scores, outcome) => {
    const surface = storySurface(identities.g3)
    const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)[0]!
    const attempts = scores.map((score, sampleIndex) => validAttempt(assembled, sampleIndex, score))
    expect(deriveM10GSemanticAggregate({ assembled, authority: M10_G_SEMANTIC_AUTHORITY, attempts }).outcome)
      .toBe(outcome)
  })

  it('freezes an executable M10-G prompt template independently from M10-F', () => {
    expect(M10_G_PROMPT_TEMPLATE_VERSION).toBe('m10-g-rubric-prompts-v1')
    expect(M10_G_RUBRIC_PROMPT_HASHES).not.toEqual(M10_F_RUBRIC_PROMPT_HASHES)
    for (const [rubricId, expectedHash] of Object.entries(M10_G_RUBRIC_PROMPT_HASHES)) {
      const id = rubricId as SemanticRubricId
      expect(m10GSemanticPromptHash(id)).toBe(expectedHash)
      expect(expectedHash).toMatch(/^[a-f0-9]{64}$/)
    }
    const surface = storySurface(identities.g1)
    const assembled = assembleM10GSemanticCases(surface, M10_G_SEMANTIC_AUTHORITY)[0]!
    const prompt = buildM10GSemanticPrompt('D-R1', assembled.judgeInput)
    expect(prompt.templateHash).toBe(M10_G_RUBRIC_PROMPT_HASHES['D-R1'])
    expect(prompt.system).toContain('Anda adalah penilai mutu naratif independen')
    expect(prompt.user).toContain('RUBRIC: D-R1')
  })

  it('assertM10GExecutablePromptHash enforces configured executable prompt hash identity', () => {
    expect(() => assertM10GExecutablePromptHash('D-R1', M10_G_RUBRIC_PROMPT_HASHES['D-R1'])).not.toThrow()
    expect(() => assertM10GExecutablePromptHash('D-R1', '4'.repeat(64)))
      .toThrow(/configured prompt identity mismatch/)
    expect(() => assertM10GExecutablePromptHash('D-R1', M10_G_RUBRIC_PROMPT_HASHES['D-R2']))
      .toThrow(/configured prompt identity mismatch/)
  })

  it('assertM10GSemanticAuthority independently checks promptHash on all cases against executable prompt hashes', () => {
    const tamperedCases = M10_G_SEMANTIC_AUTHORITY.cases.map((c, i) =>
      i === 0 ? { ...c, promptHash: '4'.repeat(64) } : c,
    )
    const { authorityHash: _oldHash, ...payloadWithoutHash } = {
      ...M10_G_SEMANTIC_AUTHORITY,
      cases: tamperedCases,
    }
    const tamperedAuthority = {
      ...payloadWithoutHash,
      authorityHash: computeM10GSemanticAuthorityHash(payloadWithoutHash),
    }
    expect(() => assertM10GSemanticAuthority(tamperedAuthority))
      .toThrow(/configured prompt identity/)
  })

  it('assembleM10GSemanticCases independently asserts case authority promptHash equals executable prompt hash', () => {
    const surface = storySurface(identities.g1)
    const tamperedCases = M10_G_SEMANTIC_AUTHORITY.cases.map((c, i) =>
      i === 0 ? { ...c, promptHash: '4'.repeat(64) } : c,
    )
    const { authorityHash: _oldHash, ...payloadWithoutHash } = {
      ...M10_G_SEMANTIC_AUTHORITY,
      cases: tamperedCases,
    }
    const tamperedAuthority = {
      ...payloadWithoutHash,
      authorityHash: computeM10GSemanticAuthorityHash(payloadWithoutHash),
    }
    expect(() => assembleM10GSemanticCases(surface, tamperedAuthority as M10GSemanticAuthority))
      .toThrow(/configured prompt identity/)
  })

  it('assertM10GSemanticAttemptState independently asserts attempt promptHash equals executable prompt hash', () => {
    const { assembled } = completeArtifact(identities.g1)
    const firstCase = assembled[0]!
    const attempt = validAttempt(firstCase, 0, 80)

    const arbitraryPromptHash = '4'.repeat(64)
    const tamperedPayload = {
      ...attempt,
      promptHash: arbitraryPromptHash,
    }
    const { attemptId: _oldAttemptId, ...attemptWithoutId } = tamperedPayload
    const tamperedAttempt = {
      ...attemptWithoutId,
      attemptId: computeSha256(stableStringify(attemptWithoutId)),
    }
    expect(() => assertM10GSemanticAttemptState(tamperedAttempt, M10_G_SEMANTIC_AUTHORITY, firstCase))
      .toThrow(/configured prompt identity/)
  })

  it('rejects an artifact where arbitrary 64-hex prompt hash is consistently rehashed through case, attempt, aggregate, and artifact', () => {
    const { surface, assembled } = completeArtifact(identities.g1)
    const arbitraryPromptHash = '4'.repeat(64)
    const targetCaseId = assembled[0]!.caseAuthority.caseId

    // 1. Build tampered case list with arbitrary 64-hex promptHash
    const tamperedCases = M10_G_SEMANTIC_AUTHORITY.cases.map((c) =>
      c.caseId === targetCaseId ? { ...c, promptHash: arbitraryPromptHash } : c,
    )
    const { authorityHash: _oldHash, ...authorityPayload } = {
      ...M10_G_SEMANTIC_AUTHORITY,
      cases: tamperedCases,
    }
    const tamperedAuthorityHash = computeM10GSemanticAuthorityHash(authorityPayload)
    const tamperedAuthority = {
      ...authorityPayload,
      authorityHash: tamperedAuthorityHash,
    }

    // 2. Build tampered attempts re-hashed with the arbitrary promptHash
    const tamperedAttempts = [0, 1, 2].map((sampleIndex) => {
      const a = validAttempt(assembled[0]!, sampleIndex, 80)
      const { attemptId: _, ...payload } = {
        ...a,
        authorityHash: tamperedAuthorityHash,
        promptHash: arbitraryPromptHash,
      }
      return {
        ...payload,
        attemptId: computeSha256(stableStringify(payload)),
      }
    })

    // 3. Assemble tampered case object
    const tamperedAssembledCase: M10GAssembledSemanticCase = {
      ...assembled[0]!,
      caseAuthority: {
        ...assembled[0]!.caseAuthority,
        promptHash: arbitraryPromptHash,
      },
      promptHash: arbitraryPromptHash,
      authorityHash: tamperedAuthorityHash,
    }

    // 4. Derive tampered aggregate
    const tamperedAggregate = deriveM10GSemanticAggregate({
      assembled: tamperedAssembledCase,
      authority: tamperedAuthority as M10GSemanticAuthority,
      attempts: tamperedAttempts,
    })
    expect(tamperedAggregate.promptHash).toBe(arbitraryPromptHash)

    // 5. Build full artifact with recomputed attempts, aggregates, and artifactHash
    const allAttempts = assembled.flatMap((sc) => {
      if (sc.caseAuthority.caseId === targetCaseId) return tamperedAttempts
      return [0, 1, 2].map((sampleIndex) => {
        const a = validAttempt(sc, sampleIndex, 80)
        const { attemptId: _, ...payload } = {
          ...a,
          authorityHash: tamperedAuthorityHash,
        }
        return {
          ...payload,
          attemptId: computeSha256(stableStringify(payload)),
        }
      })
    })

    const allAggregates = assembled.map((sc) => {
      if (sc.caseAuthority.caseId === targetCaseId) return tamperedAggregate
      const matching = allAttempts.filter((a) => a.caseId === sc.caseAuthority.caseId)
      return deriveM10GSemanticAggregate({
        assembled: { ...sc, authorityHash: tamperedAuthorityHash },
        authority: tamperedAuthority as M10GSemanticAuthority,
        attempts: matching,
      })
    })

    // 5. Branded builder rejects rehashed structural copies before artifact creation.
    expect(() => buildM10GSemanticArtifact({
      identity: identities.g1,
      authority: tamperedAuthority as M10GSemanticAuthority,
      sourceManifestPath,
      sourceCapturePath,
      surface,
      attempts: allAttempts as M10GAuthoritativeSemanticAttempt[],
      aggregates: allAggregates,
    })).toThrow(/executor-issued authoritative attempts/)

    // 6. Serialized validator independently rejects same forgery.
    const valid = completeArtifact(identities.g1).artifact
    const artifact = structuredClone(valid)
    artifact.authorityHash = tamperedAuthorityHash
    artifact.executionIdentity = tamperedAuthority.executionIdentity
    artifact.attempts = allAttempts
    artifact.aggregates = allAggregates
    const { artifactHash: _artifactHash, ...artifactPayload } = artifact
    artifact.artifactHash = computeM10GSemanticArtifactHash(artifactPayload)
    expect(() => validateM10GSemanticArtifact({
      artifact,
      identity: identities.g1,
      sourceManifestPath,
      sourceCapturePath,
      surface,
      authority: tamperedAuthority as M10GSemanticAuthority,
    })).toThrow(/configured prompt identity/)
  })
})
