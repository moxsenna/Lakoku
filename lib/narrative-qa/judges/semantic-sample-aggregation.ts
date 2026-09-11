export interface SemanticSampleAggregationInput {
  attempts: ReadonlyArray<{
    attemptId: string
    sampleIndex: number
    status: string
    score: number | null
    failureCodes: readonly string[]
  }>
  requiredSampleCount: 3
  threshold: 80
  maximumConclusiveSpread: 20
}

export interface SemanticSampleAggregationResult {
  attemptRefs: string[]
  validSampleRefs: string[]
  validSampleCount: number
  scores: number[]
  medianScore: number | null
  scoreSpread: number | null
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  failureCodes: string[]
}

/** Generic pure MEDIAN policy. Stage wrappers own schemas, identities, and error contracts. */
export function deriveSemanticSampleAggregation(
  input: SemanticSampleAggregationInput,
): SemanticSampleAggregationResult {
  const valid = input.attempts.filter((attempt) => attempt.status === 'VALID' && attempt.score !== null)
  const scores = valid.map((attempt) => attempt.score as number).sort((left, right) => left - right)
  const failureCodes = input.attempts.flatMap((attempt) => attempt.failureCodes)
  if (input.attempts.length !== input.requiredSampleCount) failureCodes.push('REQUIRED_ATTEMPTS_MISSING')
  if (new Set(input.attempts.map((attempt) => attempt.sampleIndex)).size !== input.attempts.length) {
    failureCodes.push('DUPLICATE_SAMPLE_INDEX')
  }
  if (valid.length < input.requiredSampleCount) failureCodes.push('VALID_SAMPLE_COUNT_BELOW_3')
  const medianScore = scores.length === input.requiredSampleCount ? scores[1]! : null
  const scoreSpread = scores.length === input.requiredSampleCount ? scores[2]! - scores[0]! : null
  if (scoreSpread !== null && scoreSpread > input.maximumConclusiveSpread) {
    failureCodes.push('SCORE_SPREAD_EXCEEDS_20')
  }
  const conclusive = failureCodes.length === 0 && medianScore !== null
  return {
    attemptRefs: input.attempts.map((attempt) => attempt.attemptId),
    validSampleRefs: valid.map((attempt) => attempt.attemptId),
    validSampleCount: valid.length,
    scores,
    medianScore,
    scoreSpread,
    outcome: conclusive ? medianScore >= input.threshold ? 'PASS' : 'FAIL' : 'INCONCLUSIVE',
    failureCodes: [...new Set(failureCodes)].sort(),
  }
}
