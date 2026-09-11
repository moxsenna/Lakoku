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
const PilotStoryIdSchema = z.string().regex(/^m10c-m10f-[a-z0-9-]+$/)

export const M10FPilotIdentitySchema = z.object({
  storyId: PilotStoryIdSchema,
  runId: z.string().min(1).max(200),
  correlationId: z.string().uuid(),
}).strict()

export const M10FExactExecutionIdentitySchema = z.object({
  providerId: z.literal('openrouter'),
  configuredModelId: z.literal('deepseek/deepseek-v3.2'),
  expectedActualModelId: z.literal('deepseek/deepseek-v3.2'),
  routeVersion: z.literal('2026-08-m10f-live'),
  primaryIndex: z.literal(0),
  fallbackAllowed: z.literal(false),
  actualModelResolutionRequired: z.literal(true),
  temperature: z.literal(0),
  maxRetries: z.literal(0),
}).strict()

export const M10FSemanticCaseAuthoritySchema = z.object({
  caseId: z.string().min(1).max(200),
  rubricId: SemanticRubricIdSchema,
  view: SemanticJudgeViewSchema,
  horizonKind: SemanticHorizonKindSchema,
  coverage: SemanticCoverageSchema,
  promptHash: Sha256Schema,
}).strict()

export const M10FSemanticAuthoritySchema = z.object({
  schemaVersion: z.literal(1),
  authorityId: z.literal('m10-f-semantic-authority-v1'),
  authorityStatement: z.literal('M10-F PM authority sets a uniform minimum semantic-quality threshold of 80/100 across D-R1..D-R8. The threshold is normative, not empirically derived.'),
  scoreDirection: z.literal('HIGHER_IS_BETTER'),
  thresholdKind: z.literal('NORMATIVE'),
  uniformThreshold: z.literal(80),
  sampleCountPerCase: z.literal(3),
  aggregation: z.literal('MEDIAN'),
  equalityPasses: z.literal(true),
  maximumConclusiveSpread: z.literal(20),
  requiredCaseCount: z.literal(12),
  requiredValidSampleCount: z.literal(36),
  executionIdentity: M10FExactExecutionIdentitySchema,
  cases: z.array(M10FSemanticCaseAuthoritySchema).length(12),
  authorityHash: Sha256Schema,
}).strict()

export const M10FStoryChapterSurfaceSchema = z.object({
  chapterNumber: z.number().int().min(1).max(50),
  title: z.string().min(1).max(500),
  paragraphs: z.array(z.string().min(1).max(40_000)).min(1).max(200),
  contentHash: Sha256Schema,
  chapterHash: Sha256Schema,
  pilotCaptureHash: Sha256Schema,
  sourceCaptureArtifactHash: Sha256Schema,
  sourceEvidenceManifestHash: Sha256Schema,
}).strict()

export const M10FStructuralContextSchema = z.object({
  storyPromise: z.string().min(1).max(4_000),
  mainConflict: z.string().min(1).max(4_000),
  finalQuestion: z.string().min(1).max(4_000),
  activeThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
  resolvedThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
  payoffSchedule: z.array(z.string().min(1).max(2_000)).max(40),
  lockedEndingKey: z.string().min(1).max(200),
  actPosition: z.string().min(1).max(200),
}).strict()

export const M10FSourceStorySurfaceAuthoritySchema = z.object({
  schemaVersion: z.literal(3),
  pilotIdentity: M10FPilotIdentitySchema,
  sourceEvidenceManifestHash: Sha256Schema,
  sourceCaptureArtifactHash: Sha256Schema,
  liveCaptureArtifactHash: Sha256Schema,
  chapters: z.array(z.object({
    chapterNumber: z.number().int().min(1).max(50),
    publishedTitle: z.string().min(1).max(500),
    contentHash: Sha256Schema,
    pilotCaptureHash: Sha256Schema,
  }).strict()).length(50),
  structuralContextHash: Sha256Schema,
  authorityHash: Sha256Schema,
}).strict()

export const M10FStorySurfaceManifestSchema = z.object({
  schemaVersion: z.literal(5),
  pilotIdentity: M10FPilotIdentitySchema,
  sourceStorySurfaceAuthorityHash: Sha256Schema,
  sourceEvidenceManifestPathHash: Sha256Schema,
  sourceEvidenceManifestHash: Sha256Schema,
  sourceCaptureArtifactPathHash: Sha256Schema,
  sourceCaptureArtifactHash: Sha256Schema,
  liveCaptureArtifactPathHash: Sha256Schema,
  liveCaptureArtifactHash: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  chapters: z.array(M10FStoryChapterSurfaceSchema).length(50),
  structuralContext: M10FStructuralContextSchema,
}).strict()

export const M10FAssembledSemanticCaseSchema = z.object({
  pilotIdentity: M10FPilotIdentitySchema,
  authorityHash: Sha256Schema,
  sourceEvidenceManifestHash: Sha256Schema,
  sourceCaptureArtifactHash: Sha256Schema,
  liveCaptureArtifactHash: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  caseAuthority: M10FSemanticCaseAuthoritySchema,
  judgeInput: SemanticJudgeInputSchema,
  judgeInputHash: Sha256Schema,
  promptHash: Sha256Schema,
}).strict()

export const M10FSemanticEvidenceRefSchema = z.object({
  segmentId: z.string().min(1).max(160),
  quote: z.string().min(1).max(4_000),
  quoteHash: Sha256Schema,
}).strict()

export const M10FSemanticAttemptStatusSchema = z.enum([
  'VALID',
  'TRANSPORT_FAILURE',
  'MALFORMED_RESPONSE',
  'MODEL_IDENTITY_FAILURE',
  'EVIDENCE_FAILURE',
])

export const M10FSemanticAttemptSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: Sha256Schema,
  pilotIdentity: M10FPilotIdentitySchema,
  authorityHash: Sha256Schema,
  sourceEvidenceManifestHash: Sha256Schema,
  sourceCaptureArtifactHash: Sha256Schema,
  liveCaptureArtifactHash: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  caseId: z.string().min(1).max(200),
  rubricId: SemanticRubricIdSchema,
  sampleIndex: z.number().int().min(0).max(2),
  judgeInputHash: Sha256Schema,
  promptHash: Sha256Schema,
  configuredExecutionIdentity: M10FExactExecutionIdentitySchema,
  observedIdentity: z.object({
    providerId: z.string().min(1).max(80).nullable(),
    actualModelId: z.string().min(1).max(300).nullable(),
    actualModelResolved: z.boolean(),
    fallbackIndex: z.number().int().min(0).max(32),
    routeVersion: z.string().min(1).max(160).nullable(),
  }).strict(),
  status: M10FSemanticAttemptStatusSchema,
  score: z.number().int().min(0).max(100).nullable(),
  modelVerdict: SemanticModelVerdictSchema.nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  findingCodes: z.array(SemanticFindingCodeSchema).max(8),
  evidenceMode: z.enum(['SPAN', 'FULL_HORIZON_ABSENCE']).nullable(),
  evidenceRefs: z.array(M10FSemanticEvidenceRefSchema).max(20),
  rationaleSummaryHash: Sha256Schema.nullable(),
  failureCodes: z.array(z.string().regex(/^[A-Z0-9_]{1,100}$/)).max(20),
}).strict()

export const M10FSemanticAggregateSchema = z.object({
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

export const M10FSemanticArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  artifactKind: z.literal('M10_F_SEMANTIC_EVIDENCE'),
  pilotIdentity: M10FPilotIdentitySchema,
  authorityHash: Sha256Schema,
  sourceEvidenceManifestPathHash: Sha256Schema,
  sourceEvidenceManifestHash: Sha256Schema,
  sourceCaptureArtifactPathHash: Sha256Schema,
  sourceCaptureArtifactHash: Sha256Schema,
  liveCaptureArtifactPathHash: Sha256Schema,
  liveCaptureArtifactHash: Sha256Schema,
  storySurfaceHash: Sha256Schema,
  executionIdentity: M10FExactExecutionIdentitySchema,
  attempts: z.array(M10FSemanticAttemptSchema).max(36),
  aggregates: z.array(M10FSemanticAggregateSchema).length(12),
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

export type M10FPilotIdentity = z.infer<typeof M10FPilotIdentitySchema>
export type M10FExactExecutionIdentity = z.infer<typeof M10FExactExecutionIdentitySchema>
export type M10FSemanticAuthority = z.infer<typeof M10FSemanticAuthoritySchema>
export type M10FSemanticCaseAuthority = z.infer<typeof M10FSemanticCaseAuthoritySchema>
export type M10FSourceStorySurfaceAuthority = z.infer<typeof M10FSourceStorySurfaceAuthoritySchema>
export type M10FStorySurfaceManifest = z.infer<typeof M10FStorySurfaceManifestSchema>
export type M10FAssembledSemanticCase = z.infer<typeof M10FAssembledSemanticCaseSchema>
export type M10FSemanticAttempt = z.infer<typeof M10FSemanticAttemptSchema>
export type M10FSemanticAggregate = z.infer<typeof M10FSemanticAggregateSchema>
export type M10FSemanticArtifact = z.infer<typeof M10FSemanticArtifactSchema>
