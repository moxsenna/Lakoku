import {
  BOUNDED_NOVEL_CHAPTERS_V1,
  type RawSemanticJudgeSample,
  RawSemanticJudgeSampleSchema,
  SEMANTIC_FINDING_CODES,
  type SemanticAggregate,
  SemanticAggregateSchema,
  type SemanticAggregateRequest,
  SemanticAggregateRequestSchema,
  type SemanticCorpusAuthority,
  SemanticCorpusAuthoritySchema,
  type SemanticCoverage,
  SemanticCoverageSchema,
  type SemanticExecutionAuthority,
  SemanticExecutionAuthoritySchema,
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
const LABEL_LEAK_KEY_PATTERN = /^(label|tier|partition|universeId|expected(?:verdict|score|outcome)?|verdict|calibration|holdout|cArtifacts?|thresholds?|writer(?:Reason|Plans?)?|reason(?:ing)?|repair(?:Plans?)?|disposition(?:Text)?|justification|reviewState|findingCodes?)$/i
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

/** Canonical ordered chapter list a coverage declares. */
export function coverageChapters(coverage: SemanticCoverage): number[] {
  const parsed = SemanticCoverageSchema.parse(coverage)
  if (parsed.mode === 'CONTIGUOUS') {
    return Array.from(
      { length: parsed.toChapter - parsed.fromChapter + 1 },
      (_, index) => parsed.fromChapter + index,
    )
  }
  return [...parsed.chapterNumbers]
}

export function sameCoverage(left: SemanticCoverage, right: SemanticCoverage): boolean {
  return stableStringify(left) === stableStringify(right)
}

export function sameHorizon(left: SemanticHorizon, right: SemanticHorizon): boolean {
  return left.kind === right.kind && sameCoverage(left.coverage, right.coverage)
}

export function sameExecutionAuthority(
  left: SemanticExecutionAuthority,
  right: SemanticExecutionAuthority,
): boolean {
  return (
    left.judgePolicyVersion === right.judgePolicyVersion &&
    left.promptHash === right.promptHash &&
    left.exactModelId === right.exactModelId
  )
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

/**
 * Rubric-aware coverage validation. Sparse surfaces are legal only where the
 * rubric declares them; contiguity is never inferred from min/max chapter.
 */
export function validateRubricCoverage(rubricId: SemanticRubricId, horizon: SemanticHorizon): void {
  const chapters = coverageChapters(horizon.coverage)
  if (horizon.kind === 'NOVEL' && (chapters[0] !== 1 || chapters[chapters.length - 1] !== 50 || chapters.length !== 50)) {
    throw new SemanticJudgePolicyError('novel horizon requires complete Bab 1 through Bab 50 coverage')
  }
  if (horizon.kind === 'BOUNDED_NOVEL') {
    // Registry membership is checked before coverage, so an unregistered rubric
    // can never reach a coverage comparison and pass by accident.
    const registered = BOUNDED_NOVEL_CHAPTERS_V1[rubricId]
    if (!registered) {
      throw new SemanticJudgePolicyError(`bounded novel horizon is not registered for ${rubricId}`)
    }
    if (horizon.coverage.mode !== 'EXPLICIT') {
      throw new SemanticJudgePolicyError('bounded novel horizon requires explicit pre-registered coverage')
    }
    if (
      chapters.length !== registered.length ||
      chapters.some((chapter, index) => chapter !== registered[index])
    ) {
      throw new SemanticJudgePolicyError(
        `bounded novel horizon must supply the exact registered ${rubricId} chapters: ${registered.join(', ')}`,
      )
    }
    if (chapters.length === 50) {
      throw new SemanticJudgePolicyError('bounded novel horizon must never claim complete Bab 1 through Bab 50 coverage')
    }
  }
  if (horizon.kind === 'RUNWAY') {
    if (horizon.coverage.mode !== 'CONTIGUOUS' || horizon.coverage.fromChapter !== 41 || horizon.coverage.toChapter !== 50) {
      throw new SemanticJudgePolicyError('runway horizon requires contiguous Bab 41 through Bab 50 coverage')
    }
  }
  if (horizon.kind === 'ACT' && chapters.length < 2) {
    throw new SemanticJudgePolicyError('act horizon requires multiple ordered segments')
  }
  if (rubricId === 'D-R4' && horizon.kind === 'LOCAL') {
    if (chapters.length !== 3 || chapters[1] !== chapters[0]! + 1 || chapters[2] !== chapters[0]! + 2) {
      throw new SemanticJudgePolicyError('D-R4 local horizon requires exactly N-2, N-1, N coverage')
    }
  }
  if (rubricId === 'D-R6') {
    if (horizon.coverage.mode !== 'EXPLICIT' || chapters.length < 2) {
      throw new SemanticJudgePolicyError('D-R6 requires explicit setup and payoff chapter coverage')
    }
  }
  if (rubricId === 'D-R7') {
    if (horizon.coverage.mode !== 'EXPLICIT' || !chapters.includes(49)) {
      throw new SemanticJudgePolicyError('D-R7 requires explicit ending coverage including Bab 49')
    }
  }
  if (rubricId === 'D-R8') {
    if (
      horizon.coverage.mode !== 'CONTIGUOUS' ||
      horizon.coverage.fromChapter !== 41 ||
      horizon.coverage.toChapter !== 50
    ) {
      throw new SemanticJudgePolicyError('D-R8 requires contiguous Bab 41 through Bab 50 coverage')
    }
  }
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
  const expectedChapters = coverageChapters(horizon.coverage)
  if (
    suppliedChapters.length !== expectedChapters.length ||
    suppliedChapters.some((chapter, index) => chapter !== expectedChapters[index])
  ) {
    throw new SemanticJudgePolicyError('input must supply exactly the declared coverage chapters')
  }
  validateRubricCoverage(rubricId, horizon)
  if (rubricId === 'D-R7' && !hasFullChapter(parsed, 49)) {
    throw new SemanticJudgePolicyError('D-R7 requires complete Bab 49 input')
  }
  if (rubricId === 'D-R8' && !hasFullChapter(parsed, 50)) {
    throw new SemanticJudgePolicyError('D-R8 requires complete Bab 50 input')
  }
}

export function computeJudgeInputHash(input: SemanticJudgeInput): string {
  return computeSha256(stableStringify(SemanticJudgeInputSchema.parse(input)))
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

function assertCorpusAuthorityMatch(
  authority: SemanticCorpusAuthority,
  sample: RawSemanticJudgeSample,
): void {
  if (sample.fixtureId !== authority.fixtureId) {
    throw new SemanticJudgePolicyError('sample fixtureId does not match frozen corpus authority')
  }
  if (sample.fixtureContentHash !== authority.fixtureContentHash) {
    throw new SemanticJudgePolicyError('sample fixtureContentHash does not match frozen corpus authority')
  }
  if (sample.judgeInputHash !== authority.judgeInputHash) {
    throw new SemanticJudgePolicyError('sample judgeInputHash does not match assembled judge input')
  }
  if (sample.rubricId !== authority.rubricId) {
    throw new SemanticJudgePolicyError('sample rubricId does not match frozen corpus authority')
  }
  if (sample.view !== authority.view) {
    throw new SemanticJudgePolicyError('sample view does not match frozen corpus authority')
  }
  if (!sameHorizon(sample.horizon, authority.horizon)) {
    throw new SemanticJudgePolicyError('sample horizon does not match frozen corpus authority')
  }
}

/**
 * Derives evidence state from rubric finding codes and evidence obligations.
 * `modelVerdict` is never read here.
 */
function deriveValidationErrors(
  input: SemanticJudgeInput,
  sample: RawSemanticJudgeSample,
): string[] {
  const validationErrors: string[] = []
  const allowedCodes = SEMANTIC_FINDING_CODES[sample.rubricId] as readonly string[]
  for (const code of sample.findingCodes) {
    if (!allowedCodes.includes(code)) {
      validationErrors.push(`finding code not allowed for ${sample.rubricId}: ${code}`)
    }
  }

  const segmentsById = new Map(input.segments.map((segment) => [segment.segmentId, segment]))
  const evidenceSegments = sample.evidence.map((evidence) => segmentsById.get(evidence.segmentId))

  if (sample.evidenceMode === 'SPAN') {
    if (sample.absenceCode !== undefined) {
      validationErrors.push('absenceCode is only valid for FULL_HORIZON_ABSENCE')
    }
    if (sample.evidence.length === 0) validationErrors.push('SPAN evidence required')
    for (let index = 0; index < sample.evidence.length; index += 1) {
      const evidence = sample.evidence[index]!
      const segment = evidenceSegments[index]
      if (!segment || !segment.content.includes(evidence.quote)) {
        validationErrors.push(`evidence quote not found: ${evidence.segmentId}`)
      }
    }
    if (
      sample.rubricId === 'D-R4' &&
      sample.findingCodes.includes('REPETITION_SEMANTIC_DUPLICATE') &&
      new Set(sample.evidence.map((evidence) => evidence.segmentId)).size < 2
    ) {
      validationErrors.push('D-R4 duplicate finding requires two distinct evidence locations')
    }
    if (sample.rubricId === 'D-R6') {
      const evidenceChapters = evidenceSegments.flatMap((segment) => (segment ? [segment.chapterNumber] : []))
      if (evidenceChapters.length < 2 || Math.min(...evidenceChapters) >= Math.max(...evidenceChapters)) {
        validationErrors.push('D-R6 requires setup evidence before payoff evidence')
      }
    }
    if (sample.rubricId === 'D-R7' && !evidenceSegments.some((segment) => segment?.chapterNumber === 49)) {
      validationErrors.push('D-R7 requires Bab 49 span evidence')
    }
    if (sample.rubricId === 'D-R8') {
      const chapters = evidenceSegments.flatMap((segment) => (segment ? [segment.chapterNumber] : []))
      if (!chapters.includes(50) || !chapters.some((chapter) => chapter >= 41 && chapter <= 49)) {
        validationErrors.push('D-R8 requires Bab 50 and runway evidence')
      }
    }
    return validationErrors
  }

  // FULL_HORIZON_ABSENCE is a narrow D-R7 mode. Missing, shortened, or altered
  // Bab 49 yields an unsupported sample, never a semantic FAIL.
  if (
    sample.rubricId !== 'D-R7' ||
    sample.absenceCode !== EMOTIONAL_RESOLUTION_ABSENT ||
    !sample.findingCodes.includes(EMOTIONAL_RESOLUTION_ABSENT) ||
    sample.evidence.length !== 0 ||
    !hasFullChapter(input, 49)
  ) {
    validationErrors.push('FULL_HORIZON_ABSENCE only supports D-R7 emotional-resolution absence with complete Bab 49')
  }
  return validationErrors
}

export function validateRawSemanticJudgeSample(
  input: SemanticJudgeInput,
  rawSample: RawSemanticJudgeSample,
  corpusAuthority: SemanticCorpusAuthority,
): ValidatedSemanticJudgeSample {
  const parsedInput = SemanticJudgeInputSchema.parse(input)
  const parsedRaw = RawSemanticJudgeSampleSchema.parse(rawSample)
  const parsedAuthority = SemanticCorpusAuthoritySchema.parse(corpusAuthority)
  SemanticExecutionAuthoritySchema.parse(parsedRaw.executionAuthority)

  assertNoLabelLeak(parsedInput)

  // Trusted identity is recomputed from the supplied input, never trusted from
  // the sample. Altered prose with an unchanged claimed hash is rejected here.
  const trustedInputHash = computeJudgeInputHash(parsedInput)
  if (trustedInputHash !== parsedAuthority.judgeInputHash) {
    throw new SemanticJudgePolicyError('supplied input does not match frozen corpus authority judgeInputHash')
  }
  assertCorpusAuthorityMatch(parsedAuthority, parsedRaw)
  validateOrderedHorizon(parsedInput, parsedAuthority.rubricId, parsedAuthority.horizon)
  if (parsedInput.view !== parsedAuthority.view) {
    throw new SemanticJudgePolicyError('input view does not match frozen corpus authority')
  }

  const validationErrors = deriveValidationErrors(parsedInput, parsedRaw)
  const evidenceValid = validationErrors.length === 0
  const sampleId = computeSha256(stableStringify({
    corpusAuthority: parsedAuthority,
    executionAuthority: parsedRaw.executionAuthority,
    sampleIndex: parsedRaw.sampleIndex,
    score: parsedRaw.score,
    modelVerdict: parsedRaw.modelVerdict,
    evidenceMode: parsedRaw.evidenceMode,
    findingCodes: parsedRaw.findingCodes,
    absenceCode: parsedRaw.absenceCode ?? null,
    evidence: parsedRaw.evidence,
    rationaleSummary: parsedRaw.rationaleSummary,
    evidenceValid,
    validationErrors,
  }))

  return ValidatedSemanticJudgeSampleSchema.parse({
    ...parsedRaw,
    sampleId,
    evidenceState: evidenceValid ? 'SUPPORTED' : 'UNSUPPORTED',
    evidenceValid,
    validationErrors,
    corpusAuthority: parsedAuthority,
  })
}

export function deriveSemanticAggregate(
  request: SemanticAggregateRequest,
  input: SemanticJudgeInput,
  corpusAuthority: SemanticCorpusAuthority,
): SemanticAggregate {
  const parsedRequest = SemanticAggregateRequestSchema.parse(request)
  const parsedAuthority = SemanticCorpusAuthoritySchema.parse(corpusAuthority)
  const { rawSamples, rubricId, threshold } = parsedRequest
  if (threshold.rubricId !== rubricId) throw new SemanticJudgePolicyError('threshold rubric mismatch')
  if (rubricId !== parsedAuthority.rubricId) {
    throw new SemanticJudgePolicyError('aggregate rubric does not match frozen corpus authority')
  }

  const executionAuthority = rawSamples[0]!.executionAuthority
  if (rawSamples.some((sample) => !sameExecutionAuthority(sample.executionAuthority, executionAuthority))) {
    throw new SemanticJudgePolicyError('aggregate samples must share one execution authority')
  }
  const indices = new Set(rawSamples.map((sample) => sample.sampleIndex))
  if (indices.size !== SAMPLE_COUNT || [0, 1, 2].some((index) => !indices.has(index))) {
    throw new SemanticJudgePolicyError('aggregate requires distinct sample indices 0, 1, and 2')
  }

  const validatedSamples = rawSamples.map((sample) => validateRawSemanticJudgeSample(input, sample, parsedAuthority))
  const sampleRefs = validatedSamples.map((sample) => sample.sampleId)
  if (new Set(sampleRefs).size !== SAMPLE_COUNT) {
    throw new SemanticJudgePolicyError('aggregate requires distinct sample identities')
  }

  const scores = sortedNumbers(validatedSamples.map((sample) => sample.score))
  const medianScore = scores[1]!
  const scoreSpread = scores[2]! - scores[0]!
  const unstable = scoreSpread > 20
  const allSupported = validatedSamples.every((sample) => sample.evidenceState === 'SUPPORTED')
  const outcome = !allSupported || unstable ? 'INCONCLUSIVE' : medianScore >= threshold.threshold ? 'PASS' : 'FAIL'

  return SemanticAggregateSchema.parse({
    rubricId,
    fixtureId: parsedAuthority.fixtureId,
    view: parsedAuthority.view,
    coverage: parsedAuthority.horizon.coverage,
    judgeInputHash: parsedAuthority.judgeInputHash,
    executionAuthority,
    threshold,
    sampleCount: SAMPLE_COUNT,
    sampleRefs,
    scores,
    medianScore,
    scoreSpread,
    unstable,
    outcome,
  })
}
