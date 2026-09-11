import { z } from 'zod'
import {
  SemanticCoverageSchema,
  SemanticFindingCodeSchema,
  SemanticHorizonKindSchema,
  SemanticJudgeInputSchema,
  SemanticJudgeViewSchema,
  SemanticModelVerdictSchema,
  SemanticRubricIdSchema,
} from './semantic-judge-contract'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const CorrelationIdSchema = z.string().uuid()
const RunIdSchema = z.string().min(1).max(200)
const M10GNovelStoryIdSchema = z.string().regex(/^m10c-m10g-g[123]-[a-z0-9-]+$/)
const M10GForkStoryIdSchema = z.string().regex(/^m10c-m10g-fork-[a-z0-9-]+$/)

export const M10GNovelIdentitySchema = z.object({
  kind: z.literal('NOVEL'),
  profileId: z.enum(['G1', 'G2', 'G3']),
  routeClass: z.enum(['HIGH_TRUST', 'LOW_TRUST', 'MIXED']),
  storyId: M10GNovelStoryIdSchema,
  runId: RunIdSchema,
  correlationId: CorrelationIdSchema,
}).strict().superRefine((identity, context) => {
  const expectedRoute = {
    G1: 'HIGH_TRUST',
    G2: 'LOW_TRUST',
    G3: 'MIXED',
  } as const
  const expectedPrefix = `m10c-m10g-${identity.profileId.toLowerCase()}-`
  if (identity.routeClass !== expectedRoute[identity.profileId]) {
    context.addIssue({ code: 'custom', message: 'M10-G novel profile and route class mismatch' })
  }
  if (!identity.storyId.startsWith(expectedPrefix)) {
    context.addIssue({ code: 'custom', message: 'M10-G novel profile and story identity mismatch' })
  }
})

export const M10GForkIdentitySchema = z.object({
  kind: z.literal('FORK'),
  profileId: z.literal('FORK'),
  storyId: M10GForkStoryIdSchema,
  runId: RunIdSchema,
  correlationId: CorrelationIdSchema,
  parentStoryId: M10GNovelStoryIdSchema,
  parentStorySurfaceHash: Sha256Schema,
  forkChapterNumber: z.number().int().min(1).max(49),
  branchId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
}).strict().superRefine((identity, context) => {
  if (identity.storyId === identity.parentStoryId) {
    context.addIssue({ code: 'custom', message: 'M10-G fork story must differ from parent story' })
  }
})

export const M10GSemanticIdentitySchema = z.union([
  M10GNovelIdentitySchema,
  M10GForkIdentitySchema,
])

export const M10GExactExecutionIdentitySchema = z.object({
  providerId: z.literal('openrouter'),
  configuredModelId: z.literal('deepseek/deepseek-v3.2'),
  expectedActualModelId: z.literal('deepseek/deepseek-v3.2'),
  routeVersion: z.literal('2026-08-m10g-live'),
  primaryIndex: z.literal(0),
  fallbackAllowed: z.literal(false),
  actualModelResolutionRequired: z.literal(true),
  temperature: z.literal(0),
  maxRetries: z.literal(0),
}).strict()

export const M10GSemanticCaseAuthoritySchema = z.object({
  caseId: z.string().regex(/^m10-g-d-r[1-8]-[a-z0-9-]+$/),
  rubricId: SemanticRubricIdSchema,
  view: SemanticJudgeViewSchema,
  horizonKind: SemanticHorizonKindSchema,
  coverage: SemanticCoverageSchema,
  promptHash: Sha256Schema,
}).strict()

export const M10GSemanticAuthoritySchema = z.object({
  schemaVersion: z.literal(1),
  authorityId: z.literal('m10-g-semantic-authority-v1'),
  authorityStatement: z.literal('M10-G inherits frozen M10-F semantic policy while owning distinct proof identities, provenance, surfaces, and artifacts.'),
  inheritedM10FAuthorityHash: Sha256Schema,
  scoreDirection: z.literal('HIGHER_IS_BETTER'),
  thresholdKind: z.literal('NORMATIVE'),
  uniformThreshold: z.literal(80),
  sampleCountPerCase: z.literal(3),
  aggregation: z.literal('MEDIAN'),
  equalityPasses: z.literal(true),
  maximumConclusiveSpread: z.literal(20),
  requiredCaseCount: z.literal(12),
  requiredValidSampleCount: z.literal(36),
  executionIdentity: M10GExactExecutionIdentitySchema,
  cases: z.array(M10GSemanticCaseAuthoritySchema).length(12),
  authorityHash: Sha256Schema,
}).strict()

export const M10GChapterSurfaceSchema = z.object({
  chapterNumber: z.number().int().min(1).max(50),
  title: z.string().min(1).max(500),
  paragraphs: z.array(z.string().min(1).max(40_000)).min(1).max(200),
  contentHash: Sha256Schema,
  sourceChapterContentSha256: Sha256Schema,
  chapterHash: Sha256Schema,
}).strict()

/**
 * Source provenance is expressed as caller-asserted SHA-256 content digests.
 * These are NOT Git blob object identities and the pure layer never reads bytes
 * from disk, shells out to git, or contacts a database. Validation is limited to
 * internal consistency between the declared digests, the source surface
 * authority, and the derived surface hashes.
 */
export const M10GStructuralContextSchema = z.object({
  storyPromise: z.string().min(1).max(4_000),
  mainConflict: z.string().min(1).max(4_000),
  finalQuestion: z.string().min(1).max(4_000),
  activeThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
  resolvedThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
  payoffSchedule: z.array(z.string().min(1).max(2_000)).max(40),
  lockedEndingKey: z.string().min(1).max(200),
  actPosition: z.string().min(1).max(200),
}).strict()

export const M10GSourceSurfaceAuthoritySchema = z.object({
  schemaVersion: z.literal(1),
  identity: M10GSemanticIdentitySchema,
  sourceManifestContentSha256: Sha256Schema,
  sourceCaptureContentSha256: Sha256Schema,
  chapters: z.array(z.object({
    chapterNumber: z.number().int().min(1).max(50),
    title: z.string().min(1).max(500),
    contentHash: Sha256Schema,
    sourceChapterContentSha256: Sha256Schema,
  }).strict()).length(50),
  structuralContextHash: Sha256Schema,
  authorityHash: Sha256Schema,
}).strict()

export const M10GStorySurfaceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  identity: M10GSemanticIdentitySchema,
  sourceSurfaceAuthorityHash: Sha256Schema,
  sourceManifestPathHash: Sha256Schema,
  sourceManifestContentSha256: Sha256Schema,
  sourceCapturePathHash: Sha256Schema,
  sourceCaptureContentSha256: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  chapters: z.array(M10GChapterSurfaceSchema).length(50),
  structuralContext: M10GStructuralContextSchema,
}).strict()

export const M10GAssembledSemanticCaseSchema = z.object({
  identity: M10GSemanticIdentitySchema,
  authorityHash: Sha256Schema,
  sourceSurfaceAuthorityHash: Sha256Schema,
  sourceManifestContentSha256: Sha256Schema,
  sourceCaptureContentSha256: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  caseAuthority: M10GSemanticCaseAuthoritySchema,
  judgeInput: SemanticJudgeInputSchema,
  judgeInputHash: Sha256Schema,
  promptHash: Sha256Schema,
}).strict()

export const M10GSemanticEvidenceRefSchema = z.object({
  segmentId: z.string().min(1).max(160),
  quote: z.string().min(1).max(4_000),
  quoteHash: Sha256Schema,
}).strict()

export const M10GObservedExecutionIdentitySchema = z.object({
  providerId: z.string().min(1).max(80).nullable(),
  actualModelId: z.string().min(1).max(300).nullable(),
  actualModelResolved: z.boolean(),
  fallbackIndex: z.number().int().min(0).max(32),
  routeVersion: z.string().min(1).max(160).nullable(),
}).strict()

export const M10GTransportCaptureSchema = z.object({
  runId: RunIdSchema,
  correlationId: CorrelationIdSchema,
  candidateId: z.string().min(1).max(200),
  sampleIndex: z.number().int().min(0).max(2),
  providerId: z.string().min(1).max(80),
  configuredModelId: z.string().min(1).max(300),
  routeVersion: z.string().min(1).max(160),
  fallbackIndex: z.number().int().min(0).max(32),
  actualModelId: z.string().min(1).max(300).nullable(),
  actualModelResolved: z.boolean(),
  finishReason: z.string().min(1).max(100).nullable(),
  outcome: z.enum(['SUCCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'ABORTED', 'INVALID_RESPONSE', 'CONTENT_REJECTED']),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(),
}).strict()

export const M10GSemanticAttemptStatusSchema = z.enum([
  'VALID',
  'TRANSPORT_FAILURE',
  'MALFORMED_RESPONSE',
  'MODEL_IDENTITY_FAILURE',
  'EVIDENCE_FAILURE',
])

/**
 * An attempt is a record of one observed judge response. A VALID attempt must
 * carry model identity, verdict, confidence, finding codes, evidence mode,
 * verifiable evidence refs, and a rationale summary digest; failure attempts
 * carry an empty response payload and at least one failure code.
 */
export const M10GSemanticAttemptSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: Sha256Schema,
  identity: M10GSemanticIdentitySchema,
  authorityHash: Sha256Schema,
  sourceSurfaceAuthorityHash: Sha256Schema,
  sourceManifestContentSha256: Sha256Schema,
  sourceCaptureContentSha256: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  caseId: z.string().min(1).max(200),
  rubricId: SemanticRubricIdSchema,
  sampleIndex: z.number().int().min(0).max(2),
  judgeInputHash: Sha256Schema,
  promptHash: Sha256Schema,
  configuredExecutionIdentity: M10GExactExecutionIdentitySchema,
  observedIdentity: M10GObservedExecutionIdentitySchema,
  transportCapture: M10GTransportCaptureSchema,
  rawResponse: z.string().max(100_000),
  rawResponseSha256: Sha256Schema,
  assembledJudgeInputSha256: Sha256Schema,
  status: M10GSemanticAttemptStatusSchema,
  score: z.number().int().min(0).max(100).nullable(),
  modelVerdict: SemanticModelVerdictSchema.nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  findingCodes: z.array(SemanticFindingCodeSchema).max(8),
  evidenceMode: z.enum(['SPAN', 'FULL_HORIZON_ABSENCE']).nullable(),
  evidenceRefs: z.array(M10GSemanticEvidenceRefSchema).max(20),
  rationaleSummaryHash: Sha256Schema.nullable(),
  failureCodes: z.array(z.string().regex(/^[A-Z0-9_]{1,100}$/)).max(20),
}).strict()

export const M10GSemanticAggregateSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1).max(200),
  rubricId: SemanticRubricIdSchema,
  authorityHash: Sha256Schema,
  judgeInputHash: Sha256Schema,
  promptHash: Sha256Schema,
  attemptRefs: z.array(Sha256Schema).max(3),
  validSampleRefs: z.array(Sha256Schema).max(3),
  validSampleCount: z.number().int().min(0).max(3),
  scores: z.array(z.number().int().min(0).max(100)).max(3),
  medianScore: z.number().int().min(0).max(100).nullable(),
  scoreSpread: z.number().int().min(0).max(100).nullable(),
  outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  failureCodes: z.array(z.string().regex(/^[A-Z0-9_]{1,100}$/)).max(30),
}).strict()

export const M10GSemanticArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  artifactKind: z.literal('M10_G_SEMANTIC_EVIDENCE'),
  identity: M10GSemanticIdentitySchema,
  authorityHash: Sha256Schema,
  sourceSurfaceAuthorityHash: Sha256Schema,
  sourceManifestPathHash: Sha256Schema,
  sourceManifestContentSha256: Sha256Schema,
  sourceCapturePathHash: Sha256Schema,
  sourceCaptureContentSha256: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  executionIdentity: M10GExactExecutionIdentitySchema,
  attempts: z.array(M10GSemanticAttemptSchema).max(36),
  aggregates: z.array(M10GSemanticAggregateSchema).length(12),
  gate: z.object({
    outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
    requiredCaseCount: z.literal(12),
    observedCaseCount: z.number().int().min(0),
    requiredValidSampleCount: z.literal(36),
    observedValidSampleCount: z.number().int().min(0),
    everyRequiredCasePassed: z.boolean(),
    failureCodes: z.array(z.string().regex(/^[A-Z0-9_]{1,100}$/)).max(50),
  }).strict(),
  artifactHash: Sha256Schema,
}).strict()

export type M10GSemanticIdentity = z.infer<typeof M10GSemanticIdentitySchema>
export type M10GExactExecutionIdentity = z.infer<typeof M10GExactExecutionIdentitySchema>
export type M10GObservedExecutionIdentity = z.infer<typeof M10GObservedExecutionIdentitySchema>
export type M10GTransportCapture = z.infer<typeof M10GTransportCaptureSchema>
export type M10GSemanticCaseAuthority = z.infer<typeof M10GSemanticCaseAuthoritySchema>
export type M10GSemanticAuthority = z.infer<typeof M10GSemanticAuthoritySchema>
export type M10GSourceSurfaceAuthority = z.infer<typeof M10GSourceSurfaceAuthoritySchema>
export type M10GStorySurfaceManifest = z.infer<typeof M10GStorySurfaceManifestSchema>
export type M10GAssembledSemanticCase = z.infer<typeof M10GAssembledSemanticCaseSchema>
export type M10GSemanticAttempt = z.infer<typeof M10GSemanticAttemptSchema>
export type M10GSemanticAggregate = z.infer<typeof M10GSemanticAggregateSchema>
export type M10GSemanticArtifact = z.infer<typeof M10GSemanticArtifactSchema>
