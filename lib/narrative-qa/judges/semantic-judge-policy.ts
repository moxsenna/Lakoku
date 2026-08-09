import {
  type RawSemanticJudgeSample,
  RawSemanticJudgeSampleSchema,
  type SemanticAggregate,
  SemanticAggregateSchema,
  type SemanticAggregateRequest,
  SemanticAggregateRequestSchema,
  type SemanticHorizon,
  type SemanticJudgeInput,
  SemanticJudgeInputSchema,
  type SemanticRubricId,
  type SemanticThresholdArtifact,
  SemanticThresholdArtifactSchema,
  type ValidatedSemanticJudgeSample,
  ValidatedSemanticJudgeSampleSchema,
} from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

const SAMPLE_COUNT = 3
const EMOTIONAL_RESOLUTION_ABSENT = 'EMOTIONAL_RESOLUTION_ABSENT'
const LABEL_LEAK_KEY_PATTERN = /^(label|tier|partition|expected(?:verdict|score|outcome)?|verdict|calibration|holdout|cArtifacts?|thresholds?|writer(?:Reason|Plans?)?|reason(?:ing)?|repair(?:Plans?)?|disposition(?:Text)?)$/i
const STRUCTURAL_FIELD_PATTERN = /^(storyPromise|mainConflict|finalQuestion|activeThreadSummaries|resolvedThreadSummaries|payoffSchedule|lockedEndingKey|actPosition)$/

export class SemanticJudgePolicyError extends Error {
  constructor(message: string) {
    super(`SemanticJudgePolicyError: ${message}`)
    this.name = 'SemanticJudgePolicyError'
  }
}

export interface CalibrationScore {
  rubricId: SemanticRubricId
  partition: 'CALIBRATION' | 'VALIDATION_HOLDOUT'
  tier: 'strong' | 'weak'
  score: number
}

function sortedNumbers(values: number[]): number[] {
  return [...values].sort((left, right) => left - right)
}

function hasFullChapter(input: SemanticJudgeInput, chapterNumber: number): boolean {
  return input.segments.some((segment) => segment.chapterNumber === chapterNumber && segment.content.length > 0)
}

export function assertNoLabelLeak(input: unknown): void {
  const inspect = (value: unknown, readerView: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) inspect(item, readerView)
      return
    }
    if (typeof value !== 'object' || value === null) return

    const record = value as Record<string, unknown>
    const isReaderView = readerView || record.view === 'reader'
    for (const [key, nested] of Object.entries(record)) {
      if (LABEL_LEAK_KEY_PATTERN.test(key)) {
        throw new SemanticJudgePolicyError('judge input contains prohibited label or writer metadata')
      }
      if (isReaderView && STRUCTURAL_FIELD_PATTERN.test(key)) {
        throw new SemanticJudgePolicyError('reader input contains structural fields')
      }
      inspect(nested, isReaderView)
    }
  }
  inspect(input, false)
}

function sameHorizon(left: SemanticHorizon, right: SemanticHorizon): boolean {
  return left.kind === right.kind && left.fromChapter === right.fromChapter && left.toChapter === right.toChapter
}

export function validateOrderedHorizon(
  input: SemanticJudgeInput,
  rubricId: SemanticRubricId,
  horizon: SemanticHorizon,
): void {
  const parsed = SemanticJudgeInputSchema.parse(input)
  let previousChapter = 0
  const segmentIds = new Set<string>()
  for (const segment of parsed.segments) {
    if (segment.chapterNumber <= previousChapter) {
      throw new SemanticJudgePolicyError('segments must be ordered by strictly increasing chapter number')
    }
    if (segmentIds.has(segment.segmentId)) {
      throw new SemanticJudgePolicyError(`duplicate segmentId: ${segment.segmentId}`)
    }
    previousChapter = segment.chapterNumber
    segmentIds.add(segment.segmentId)
  }

  const suppliedChapters = parsed.segments.map((segment) => segment.chapterNumber)
  const expectedChapters = Array.from(
    { length: horizon.toChapter - horizon.fromChapter + 1 },
    (_, index) => horizon.fromChapter + index,
  )
  if (suppliedChapters.length !== expectedChapters.length || suppliedChapters.some((chapter, index) => chapter !== expectedChapters[index])) {
    throw new SemanticJudgePolicyError('horizon requires complete contiguous declared chapter coverage')
  }
  if (horizon.kind === 'ACT' && expectedChapters.length < 2) {
    throw new SemanticJudgePolicyError('act horizon requires multiple ordered segments')
  }
  if (horizon.kind === 'NOVEL' && (horizon.fromChapter !== 1 || horizon.toChapter !== 50)) {
    throw new SemanticJudgePolicyError('novel horizon requires complete Bab 1 through Bab 50 coverage')
  }
  if (horizon.kind === 'RUNWAY' && (horizon.fromChapter !== 41 || horizon.toChapter !== 50)) {
    throw new SemanticJudgePolicyError('runway horizon requires complete Bab 41 through Bab 50 coverage')
  }
  if (rubricId === 'D-R4' && horizon.kind === 'LOCAL' && expectedChapters.length !== 3) {
    throw new SemanticJudgePolicyError('D-R4 local horizon requires N/N-1/N-2 coverage')
  }
  if (rubricId === 'D-R6' && expectedChapters.length < 2) {
    throw new SemanticJudgePolicyError('D-R6 requires setup and payoff segments')
  }
  if (rubricId === 'D-R7' && !hasFullChapter(parsed, 49)) {
    throw new SemanticJudgePolicyError('D-R7 requires complete Bab 49 input')
  }
  if (rubricId === 'D-R8') {
    if (horizon.kind !== 'RUNWAY' || !hasFullChapter(parsed, 50)) {
      throw new SemanticJudgePolicyError('D-R8 requires complete Bab 41 through Bab 50 runway coverage')
    }
  }
}

export function deriveFrozenThreshold(
  rubricId: SemanticRubricId,
  scores: readonly CalibrationScore[],
): SemanticThresholdArtifact {
  if (scores.some((score) => score.partition !== 'CALIBRATION')) {
    throw new SemanticJudgePolicyError('threshold accepts calibration scores only')
  }
  const rubricScores = scores.filter((score) => score.rubricId === rubricId)
  const weakScores = rubricScores.filter((score) => score.tier === 'weak').map((score) => score.score)
  const strongScores = rubricScores.filter((score) => score.tier === 'strong').map((score) => score.score)
  if (weakScores.length === 0 || strongScores.length === 0) {
    throw new SemanticJudgePolicyError('threshold requires weak and strong calibration scores')
  }
  const weakCeiling = Math.max(...weakScores)
  const strongFloor = Math.min(...strongScores)
  if (weakCeiling >= strongFloor) {
    throw new SemanticJudgePolicyError('weak ceiling must be below strong floor')
  }
  const threshold = Math.ceil((weakCeiling + strongFloor) / 2)
  return Object.freeze(
    SemanticThresholdArtifactSchema.parse({
      rubricId,
      weakCeiling,
      strongFloor,
      threshold,
      calibrationHash: computeSha256(stableStringify(rubricScores)),
    }),
  )
}

export function validateRawSemanticJudgeSample(
  input: SemanticJudgeInput,
  rawSample: RawSemanticJudgeSample,
): ValidatedSemanticJudgeSample {
  const parsedInput = SemanticJudgeInputSchema.parse(input)
  const parsedRaw = RawSemanticJudgeSampleSchema.parse(rawSample)
  assertNoLabelLeak(parsedInput)
  validateOrderedHorizon(parsedInput, parsedRaw.rubricId, parsedRaw.horizon)

  const validationErrors: string[] = []
  const segmentsById = new Map(parsedInput.segments.map((segment) => [segment.segmentId, segment]))
  const evidenceSegments = parsedRaw.evidence.map((evidence) => segmentsById.get(evidence.segmentId))

  if (parsedRaw.evidenceMode === 'SPAN') {
    if (parsedRaw.evidence.length === 0) validationErrors.push('SPAN evidence required')
    for (let index = 0; index < parsedRaw.evidence.length; index += 1) {
      const evidence = parsedRaw.evidence[index]
      const segment = evidenceSegments[index]
      if (!segment || !segment.content.includes(evidence.quote)) {
        validationErrors.push(`evidence quote not found: ${evidence.segmentId}`)
      }
    }
    if (
      parsedRaw.rubricId === 'D-R4' &&
      parsedRaw.modelVerdict === 'FAIL' &&
      new Set(parsedRaw.evidence.map((evidence) => evidence.segmentId)).size < 2
    ) {
      validationErrors.push('D-R4 FAIL requires two distinct evidence locations')
    }
    if (parsedRaw.rubricId === 'D-R6') {
      const evidenceChapters = evidenceSegments.flatMap((segment) => (segment ? [segment.chapterNumber] : []))
      if (evidenceChapters.length < 2 || Math.min(...evidenceChapters) >= Math.max(...evidenceChapters)) {
        validationErrors.push('D-R6 requires setup evidence before payoff evidence')
      }
    }
    if (parsedRaw.rubricId === 'D-R7' && !parsedRaw.evidence.some((evidence) => segmentsById.get(evidence.segmentId)?.chapterNumber === 49)) {
      validationErrors.push('D-R7 requires Bab 49 span evidence')
    }
    if (parsedRaw.rubricId === 'D-R8') {
      const chapters = evidenceSegments.flatMap((segment) => (segment ? [segment.chapterNumber] : []))
      if (!chapters.includes(50) || !chapters.some((chapter) => chapter >= 41 && chapter <= 49)) {
        validationErrors.push('D-R8 requires Bab 50 and runway evidence')
      }
    }
  } else if (
    parsedRaw.rubricId !== 'D-R7' ||
    parsedRaw.modelVerdict !== 'FAIL' ||
    parsedRaw.absenceCode !== EMOTIONAL_RESOLUTION_ABSENT ||
    parsedRaw.evidence.length !== 0 ||
    !hasFullChapter(parsedInput, 49)
  ) {
    validationErrors.push('FULL_HORIZON_ABSENCE only supports D-R7 FAIL emotional-resolution absence with complete Bab 49')
  }

  return ValidatedSemanticJudgeSampleSchema.parse({
    ...parsedRaw,
    evidenceValid: validationErrors.length === 0,
    validationErrors,
    contentHash: computeSha256(stableStringify(parsedInput.segments)),
    inputHash: computeSha256(stableStringify(parsedInput)),
  })
}

export function deriveSemanticAggregate(request: SemanticAggregateRequest): SemanticAggregate {
  const parsedRequest = SemanticAggregateRequestSchema.parse(request)
  const { input, rawSamples, rubricId, threshold } = parsedRequest
  if (threshold.rubricId !== rubricId) throw new SemanticJudgePolicyError('threshold rubric mismatch')
  if (rawSamples.some((sample) => sample.rubricId !== rubricId)) {
    throw new SemanticJudgePolicyError('sample rubric mismatch')
  }
  if (rawSamples.some((sample) => !sameHorizon(sample.horizon, rawSamples[0].horizon))) {
    throw new SemanticJudgePolicyError('aggregate samples must share horizon identity')
  }

  const validatedSamples = rawSamples.map((sample) => validateRawSemanticJudgeSample(input, sample))
  const scores = sortedNumbers(validatedSamples.map((sample) => sample.score))
  const medianScore = scores[1]
  const scoreSpread = scores[2] - scores[0]
  const unstable = scoreSpread > 20
  const allEvidenceValid = validatedSamples.every((sample) => sample.evidenceValid)
  const outcome = !allEvidenceValid || unstable ? 'INCONCLUSIVE' : medianScore >= threshold.threshold ? 'PASS' : 'FAIL'

  return SemanticAggregateSchema.parse({
    rubricId,
    threshold,
    sampleCount: SAMPLE_COUNT,
    scores,
    medianScore,
    scoreSpread,
    unstable,
    outcome,
    validatedSamples,
  })
}
