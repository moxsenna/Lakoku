import { z } from 'zod'

export const SEMANTIC_RUBRIC_IDS = [
  'D-R1',
  'D-R2',
  'D-R3',
  'D-R4',
  'D-R5',
  'D-R6',
  'D-R7',
  'D-R8',
] as const

export const SemanticRubricIdSchema = z.enum(SEMANTIC_RUBRIC_IDS)
export const SemanticPartitionSchema = z.enum(['CALIBRATION', 'VALIDATION_HOLDOUT'])
export const SemanticUniverseIdSchema = z.enum(['pesisir-utara', 'lembah-awan'])
export const SemanticTierSchema = z.enum(['strong', 'weak', 'borderline'])
/** D1 corpus labels are author-review labels, distinct from runtime semantic tiers. */
export const SemanticCorpusTierSchema = z.enum(['STRONG', 'WEAK', 'BORDERLINE'])
/** Human-review authority for the frozen D1 corpus. Ratified at corpus commit 5a2ab2c. */
export const SemanticReviewLabelSchema = z.literal('RATIFIED')
export const SemanticJudgeViewSchema = z.enum(['reader', 'structural'])
export const SemanticHorizonKindSchema = z.enum(['LOCAL', 'ACT', 'NOVEL', 'RUNWAY'])
export const SemanticEvidenceModeSchema = z.enum(['SPAN', 'FULL_HORIZON_ABSENCE'])
/**
 * Diagnostic telemetry only. Policy never derives evidence validity, evidence
 * state, or gate outcome from this field.
 */
export const SemanticModelVerdictSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE'])

/**
 * Coverage is the canonical horizon identity. Sparse evidence surfaces must be
 * declared EXPLICIT; storing 6..34 when the surface is [6, 21, 34] is forbidden.
 */
export const ContiguousCoverageSchema = z
  .object({
    mode: z.literal('CONTIGUOUS'),
    fromChapter: z.number().int().min(1).max(50),
    toChapter: z.number().int().min(1).max(50),
  })
  .strict()
  .refine((coverage) => coverage.fromChapter <= coverage.toChapter, {
    message: 'coverage fromChapter must not exceed toChapter',
  })

export const ExplicitCoverageSchema = z
  .object({
    mode: z.literal('EXPLICIT'),
    chapterNumbers: z.array(z.number().int().min(1).max(50)).min(1).max(50),
  })
  .strict()
  .superRefine((coverage, context) => {
    for (let index = 1; index < coverage.chapterNumbers.length; index += 1) {
      if (coverage.chapterNumbers[index - 1]! >= coverage.chapterNumbers[index]!) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chapterNumbers', index],
          message: 'explicit coverage must be strictly ascending and unique',
        })
      }
    }
  })

export const SemanticCoverageSchema = z.union([ContiguousCoverageSchema, ExplicitCoverageSchema])

export const SemanticHorizonSchema = z
  .object({
    kind: SemanticHorizonKindSchema,
    coverage: SemanticCoverageSchema,
  })
  .strict()

export const OrderedChapterSegmentSchema = z
  .object({
    segmentId: z.string().min(1).max(160),
    chapterNumber: z.number().int().min(1).max(50),
    content: z.string().min(1).max(40_000),
  })
  .strict()

export const SemanticCorpusChapterSegmentSchema = z
  .object({
    chapterNumber: z.number().int().min(1).max(50),
    title: z.string().min(1).max(500),
    paragraphs: z.array(z.string().min(1).max(40_000)).min(1).max(200),
  })
  .strict()

export const SemanticCorpusStructuralContextSchema = z
  .object({
    storyPromise: z.string().min(1).max(4_000),
    mainConflict: z.string().min(1).max(4_000),
    finalDramaticQuestion: z.string().min(1).max(4_000),
    actPosition: z.string().min(1).max(500),
    activeThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
    resolvedThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
    payoffSchedule: z.array(z.string().min(1).max(2_000)).max(40),
    lockedEndingKey: z.string().min(1).max(200),
    setupAndPayoff: z.string().min(1).max(4_000).optional(),
  })
  .strict()

export const SemanticCorpusFixtureSchema = z
  .object({
    fixtureId: z.string().min(1).max(160),
    universeId: SemanticUniverseIdSchema,
    fixtureFamilyId: z.string().min(1).max(160),
    lineageId: z.string().min(1).max(160),
    mutationSiblingId: z.string().min(1).max(160),
    /**
     * Declared only for a real ALLOWED_CONTROLLED_MUTATION pair. Absent means the
     * fixture is independently authored; no relation may be fabricated to fill it.
     */
    mutationRelation: z
      .object({
        axis: z.literal('RUBRIC_STRENGTH'),
        baseFixtureId: z.string().min(1).max(160),
      })
      .strict()
      .optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    chapterHashes: z.record(z.string().regex(/^[0-9]{1,2}$/), z.string().regex(/^[a-f0-9]{64}$/)),
    partition: SemanticPartitionSchema,
    provenance: z.enum(['human-authored', 'reconstruction/provider-derived']),
    chapters: z.array(SemanticCorpusChapterSegmentSchema).min(1).max(50),
    structuralContext: SemanticCorpusStructuralContextSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    for (let index = 1; index < fixture.chapters.length; index += 1) {
      if (fixture.chapters[index - 1]!.chapterNumber >= fixture.chapters[index]!.chapterNumber) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chapters', index, 'chapterNumber'],
          message: 'chapters must be ordered by distinct ascending chapterNumber',
        })
      }
    }
  })

export const SemanticEvaluationCaseSchema = z
  .object({
    caseId: z.string().min(1).max(200),
    rowId: z.string().min(1).max(160),
    fixtureId: z.string().min(1).max(160),
    rubricId: SemanticRubricIdSchema,
    view: SemanticJudgeViewSchema,
    horizonKind: SemanticHorizonKindSchema,
    coverage: SemanticCoverageSchema,
  })
  .strict()

export const SemanticCorpusRubricRowSchema = z
  .object({
    rowId: z.string().min(1).max(160),
    rubricId: SemanticRubricIdSchema,
    partition: SemanticPartitionSchema,
    universeId: SemanticUniverseIdSchema,
    tier: SemanticCorpusTierSchema,
    fixture: SemanticCorpusFixtureSchema,
    reviewState: SemanticReviewLabelSchema,
    justification: z.string().min(1).max(4_000),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.partition !== row.fixture.partition) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixture', 'partition'],
        message: 'row partition must match fixture partition',
      })
    }
    if (row.universeId !== row.fixture.universeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixture', 'universeId'],
        message: 'row universeId must match fixture universeId',
      })
    }
  })

export const SemanticCorpusManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    corpusId: z.literal('M10-D1-semantic-calibration-v1'),
    provenance: z.literal('frozen human-authored fixture corpus'),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    review: z
      .object({
        status: z.literal('RATIFIED'),
        corpusCommit: z.literal('5a2ab2c'),
      })
      .strict(),
    rows: z.array(SemanticCorpusRubricRowSchema).min(1),
    evaluationCases: z.array(SemanticEvaluationCaseSchema).min(1),
  })
  .strict()

const JudgeSurfaceSchema = z
  .object({
    segments: z.array(OrderedChapterSegmentSchema).min(1).max(200),
  })
  .strict()

export const ReaderSemanticJudgeInputSchema = JudgeSurfaceSchema.extend({
  view: z.literal('reader'),
}).strict()

export const StructuralSemanticJudgeInputSchema = JudgeSurfaceSchema.extend({
  view: z.literal('structural'),
  storyPromise: z.string().min(1).max(4_000),
  mainConflict: z.string().min(1).max(4_000),
  finalQuestion: z.string().min(1).max(4_000),
  activeThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
  resolvedThreadSummaries: z.array(z.string().min(1).max(2_000)).max(40),
  payoffSchedule: z.array(z.string().min(1).max(2_000)).max(40),
  lockedEndingKey: z.string().min(1).max(200),
  actPosition: z.string().min(1).max(200),
}).strict()

export const SemanticJudgeInputSchema = z.union([
  ReaderSemanticJudgeInputSchema,
  StructuralSemanticJudgeInputSchema,
])

/**
 * Corpus authority is resolved only from the frozen manifest and pure assembly.
 * It never carries policy, prompt, or model identity.
 */
export const SemanticCorpusAuthoritySchema = z
  .object({
    fixtureId: z.string().min(1).max(160),
    fixtureContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    chapterHashes: z.record(z.string().regex(/^[0-9]{1,2}$/), z.string().regex(/^[a-f0-9]{64}$/)),
    judgeInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    rubricId: SemanticRubricIdSchema,
    view: SemanticJudgeViewSchema,
    horizon: SemanticHorizonSchema,
  })
  .strict()

/**
 * Execution authority is separate from corpus authority. D1 only validates its
 * shape and equality using synthetic values; a real execution authority is
 * frozen in D2 before the first model call.
 */
export const SemanticExecutionAuthoritySchema = z
  .object({
    judgePolicyVersion: z.string().min(1).max(160),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    exactModelId: z.string().min(1).max(300),
  })
  .strict()

export const SEMANTIC_FINDING_CODES = {
  'D-R1': ['PACING_PRESSURE_PRESENT', 'PACING_STALLED', 'PACING_LATE_MOVEMENT'],
  'D-R2': ['ARC_COSTLY_CHANGE', 'ARC_DECLARED_NOT_EARNED', 'ARC_CHANGE_THIN'],
  'D-R3': ['CONFLICT_OPTIONS_NARROWED', 'CONFLICT_FLAT', 'CONFLICT_PARTIAL_STAKES'],
  'D-R4': ['REPETITION_NONE', 'REPETITION_SEMANTIC_DUPLICATE', 'REPETITION_ECHO_WITH_GAIN'],
  'D-R5': ['CHAPTER_MOVES_STORY', 'CHAPTER_INERT', 'CHAPTER_MINOR_GAIN'],
  'D-R6': ['PAYOFF_USES_SETUP', 'PAYOFF_DECLARED_ONLY', 'PAYOFF_BRIDGE_COMPRESSED'],
  'D-R7': ['EMOTIONAL_RESOLUTION_PRESENT', 'EMOTIONAL_RESOLUTION_ABSENT', 'EMOTIONAL_RESOLUTION_INTERRUPTED'],
  'D-R8': ['ENDING_EARNED', 'ENDING_UNPREPARED', 'ENDING_UNDER_EARNED'],
} as const satisfies Readonly<Record<(typeof SEMANTIC_RUBRIC_IDS)[number], readonly string[]>>

export const SEMANTIC_ALL_FINDING_CODES = Object.values(SEMANTIC_FINDING_CODES).flat()
export const SemanticFindingCodeSchema = z.enum(
  SEMANTIC_ALL_FINDING_CODES as unknown as [string, ...string[]],
)

export const SemanticEvidenceSpanSchema = z
  .object({
    segmentId: z.string().min(1).max(160),
    quote: z.string().min(1).max(4_000),
  })
  .strict()

export const RawSemanticJudgeSampleSchema = z
  .object({
    fixtureId: z.string().min(1).max(160),
    fixtureContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    judgeInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionAuthority: SemanticExecutionAuthoritySchema,
    sampleIndex: z.number().int().min(0),
    rubricId: SemanticRubricIdSchema,
    view: SemanticJudgeViewSchema,
    horizon: SemanticHorizonSchema,
    score: z.number().int().min(0).max(100),
    /** Diagnostic only; never an input to validity or outcome. */
    modelVerdict: SemanticModelVerdictSchema,
    evidenceMode: SemanticEvidenceModeSchema,
    findingCodes: z.array(SemanticFindingCodeSchema).min(1).max(8),
    absenceCode: z.literal('EMOTIONAL_RESOLUTION_ABSENT').optional(),
    evidence: z.array(SemanticEvidenceSpanSchema).max(20),
    rationaleSummary: z.string().min(1).max(1_000),
  })
  .strict()

export const SemanticEvidenceStateSchema = z.enum(['SUPPORTED', 'UNSUPPORTED'])

export const ValidatedSemanticJudgeSampleSchema = RawSemanticJudgeSampleSchema.extend({
  sampleId: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceState: SemanticEvidenceStateSchema,
  evidenceValid: z.boolean(),
  validationErrors: z.array(z.string()).max(20),
  corpusAuthority: SemanticCorpusAuthoritySchema,
}).strict()

export const SemanticThresholdArtifactSchema = z
  .object({
    rubricId: SemanticRubricIdSchema,
    weakCeiling: z.number().int().min(0).max(100),
    strongFloor: z.number().int().min(0).max(100),
    threshold: z.number().int().min(0).max(100),
    calibrationHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

/**
 * Aggregate references immutable samples by id. Embedding sample payloads as
 * conclusion authority is forbidden.
 */
export const SemanticAggregateSchema = z
  .object({
    rubricId: SemanticRubricIdSchema,
    fixtureId: z.string().min(1).max(160),
    view: SemanticJudgeViewSchema,
    coverage: SemanticCoverageSchema,
    judgeInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionAuthority: SemanticExecutionAuthoritySchema,
    threshold: SemanticThresholdArtifactSchema,
    sampleCount: z.literal(3),
    sampleRefs: z.array(z.string().regex(/^[a-f0-9]{64}$/)).length(3),
    scores: z.array(z.number().int().min(0).max(100)).length(3),
    medianScore: z.number().int().min(0).max(100),
    scoreSpread: z.number().int().min(0).max(100),
    unstable: z.boolean(),
    outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  })
  .strict()

export const SemanticAggregateRequestSchema = z
  .object({
    rubricId: SemanticRubricIdSchema,
    threshold: SemanticThresholdArtifactSchema,
    rawSamples: z.array(RawSemanticJudgeSampleSchema).length(3),
  })
  .strict()

export type SemanticRubricId = z.infer<typeof SemanticRubricIdSchema>
export type SemanticUniverseId = z.infer<typeof SemanticUniverseIdSchema>
export type SemanticJudgeView = z.infer<typeof SemanticJudgeViewSchema>
export type SemanticHorizonKind = z.infer<typeof SemanticHorizonKindSchema>
export type SemanticCoverage = z.infer<typeof SemanticCoverageSchema>
export type SemanticCorpusFixture = z.infer<typeof SemanticCorpusFixtureSchema>
export type SemanticCorpusRubricRow = z.infer<typeof SemanticCorpusRubricRowSchema>
export type SemanticEvaluationCase = z.infer<typeof SemanticEvaluationCaseSchema>
export type SemanticCorpusManifest = z.infer<typeof SemanticCorpusManifestSchema>
export type SemanticJudgeInput = z.infer<typeof SemanticJudgeInputSchema>
export type SemanticHorizon = z.infer<typeof SemanticHorizonSchema>
export type SemanticCorpusAuthority = z.infer<typeof SemanticCorpusAuthoritySchema>
export type SemanticExecutionAuthority = z.infer<typeof SemanticExecutionAuthoritySchema>
export type SemanticFindingCode = z.infer<typeof SemanticFindingCodeSchema>
export type RawSemanticJudgeSample = z.infer<typeof RawSemanticJudgeSampleSchema>
export type ValidatedSemanticJudgeSample = z.infer<typeof ValidatedSemanticJudgeSampleSchema>
export type SemanticAggregateRequest = z.infer<typeof SemanticAggregateRequestSchema>
export type SemanticThresholdArtifact = z.infer<typeof SemanticThresholdArtifactSchema>
export type SemanticAggregate = z.infer<typeof SemanticAggregateSchema>
