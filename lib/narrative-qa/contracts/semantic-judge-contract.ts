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
export const SemanticTierSchema = z.enum(['strong', 'weak', 'borderline'])
/** D1 corpus labels are author-review labels, distinct from runtime semantic tiers. */
export const SemanticCorpusTierSchema = z.enum(['STRONG', 'WEAK', 'BORDERLINE'])
export const SemanticReviewLabelSchema = z.literal('PENDING_REVIEW')
export const SemanticJudgeViewSchema = z.enum(['reader', 'structural'])
export const SemanticHorizonKindSchema = z.enum(['LOCAL', 'ACT', 'NOVEL', 'RUNWAY'])
export const SemanticEvidenceModeSchema = z.enum(['SPAN', 'FULL_HORIZON_ABSENCE'])
export const SemanticModelVerdictSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE'])

export const SemanticHorizonSchema = z
  .object({
    kind: SemanticHorizonKindSchema,
    fromChapter: z.number().int().min(1).max(50),
    toChapter: z.number().int().min(1).max(50),
  })
  .strict()
  .refine((horizon) => horizon.fromChapter <= horizon.toChapter, {
    message: 'horizon fromChapter must not exceed toChapter',
  })

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
    finalDramaticQuestion: z.string().min(1).max(4_000),
    actPosition: z.string().min(1).max(500),
    setupAndPayoff: z.string().min(1).max(4_000).optional(),
  })
  .strict()

export const SemanticCorpusFixtureSchema = z
  .object({
    fixtureId: z.string().min(1).max(160),
    fixtureFamilyId: z.string().min(1).max(160),
    lineageId: z.string().min(1).max(160),
    mutationSiblingId: z.string().min(1).max(160),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
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

export const SemanticCorpusRubricRowSchema = z
  .object({
    rowId: z.string().min(1).max(160),
    rubricId: SemanticRubricIdSchema,
    partition: SemanticPartitionSchema,
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
  })

export const SemanticCorpusManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusId: z.literal('M10-D1-semantic-calibration-v1'),
    provenance: z.literal('frozen human-authored fixture corpus'),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    rows: z.array(SemanticCorpusRubricRowSchema).min(1),
  })
  .strict()

const ReaderSurfaceSchema = z
  .object({
    segments: z.array(OrderedChapterSegmentSchema).min(1).max(200),
  })
  .strict()

export const ReaderSemanticJudgeInputSchema = ReaderSurfaceSchema.extend({
  view: z.literal('reader'),
}).strict()

export const StructuralSemanticJudgeInputSchema = ReaderSurfaceSchema.extend({
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
    judgePolicyVersion: z.string().min(1).max(160),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    exactModelId: z.string().min(1).max(300),
    sampleIndex: z.number().int().min(0),
    rubricId: SemanticRubricIdSchema,
    horizon: SemanticHorizonSchema,
    score: z.number().int().min(0).max(100),
    modelVerdict: SemanticModelVerdictSchema,
    evidenceMode: SemanticEvidenceModeSchema,
    absenceCode: z.literal('EMOTIONAL_RESOLUTION_ABSENT').optional(),
    evidence: z.array(SemanticEvidenceSpanSchema).max(20),
    rationaleSummary: z.string().min(1).max(1_000),
  })
  .strict()

export const ValidatedSemanticJudgeSampleSchema = RawSemanticJudgeSampleSchema.extend({
  evidenceValid: z.boolean(),
  validationErrors: z.array(z.string()).max(20),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
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

export const SemanticAggregateSchema = z
  .object({
    rubricId: SemanticRubricIdSchema,
    threshold: SemanticThresholdArtifactSchema,
    sampleCount: z.literal(3),
    scores: z.array(z.number().int().min(0).max(100)).length(3),
    medianScore: z.number().int().min(0).max(100),
    scoreSpread: z.number().int().min(0).max(100),
    unstable: z.boolean(),
    outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
    validatedSamples: z.array(ValidatedSemanticJudgeSampleSchema).length(3),
  })
  .strict()

export const SemanticAggregateRequestSchema = z
  .object({
    rubricId: SemanticRubricIdSchema,
    threshold: SemanticThresholdArtifactSchema,
    input: SemanticJudgeInputSchema,
    rawSamples: z.array(RawSemanticJudgeSampleSchema).length(3),
  })
  .strict()

export type SemanticRubricId = z.infer<typeof SemanticRubricIdSchema>
export type SemanticCorpusFixture = z.infer<typeof SemanticCorpusFixtureSchema>
export type SemanticCorpusRubricRow = z.infer<typeof SemanticCorpusRubricRowSchema>
export type SemanticCorpusManifest = z.infer<typeof SemanticCorpusManifestSchema>
export type SemanticJudgeInput = z.infer<typeof SemanticJudgeInputSchema>
export type SemanticHorizon = z.infer<typeof SemanticHorizonSchema>
export type RawSemanticJudgeSample = z.infer<typeof RawSemanticJudgeSampleSchema>
export type ValidatedSemanticJudgeSample = z.infer<typeof ValidatedSemanticJudgeSampleSchema>
export type SemanticAggregateRequest = z.infer<typeof SemanticAggregateRequestSchema>
export type SemanticThresholdArtifact = z.infer<typeof SemanticThresholdArtifactSchema>
export type SemanticAggregate = z.infer<typeof SemanticAggregateSchema>
