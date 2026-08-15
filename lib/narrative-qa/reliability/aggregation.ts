import { STAGE_IDS, missingMeasurement, observedValue, presentMeasurement, type MeasurementState } from './contracts'
import { compareDecimals, decimalMean, percentileCont, ratioOf, sumDecimals, type CanonicalDecimal } from './decimal'
import {
  sortProviderCallObservationsUtf8,
  validateReliabilityObservationSet,
  type Money,
  type ReliabilityObservationSet,
} from './measurements'

export type RequiredMetricId =
  | 'FIRST_ATTEMPT_SUCCESS_RATE' | 'RETRY_SUCCESS_RATE' | 'TERMINAL_FAILURE_RATE' | 'CHECKPOINT_REUSE_RATE'
  | 'PROSE_REGENERATION_ON_CHOICE_RETRY_RATE' | 'OWNERSHIP_LOSS_RECOVERY_RATE' | 'RECOVERY_SUCCESS_RATE'
  | 'PROVIDER_FALLBACK_RATE' | 'FULL_NOVEL_COMPLETION_RATE' | 'RETRY_COUNT' | 'GENERATION_PROVIDER_CALL_COUNT'
  | 'JUDGE_PROVIDER_CALL_COUNT' | 'TOTAL_PROVIDER_CALL_COUNT' | 'DUPLICATE_PUBLICATION_COUNT'
  | 'CANONICAL_CORRUPTION_COUNT' | 'GENERATION_LATENCY_P50' | 'GENERATION_LATENCY_P95'
  | 'RECOVERY_LATENCY_P50' | 'RECOVERY_LATENCY_P95' | 'INPUT_TOKEN_USAGE' | 'OUTPUT_TOKEN_USAGE'
  | 'TOTAL_TOKEN_USAGE' | 'ACTUAL_PROVIDER_COST' | 'PRICING_ESTIMATED_COST' | 'ACTUAL_COST_COVERAGE_RATIO'
  | 'PRICING_COST_COVERAGE_RATIO'

export interface AggregateMetric {
  readonly metricId: RequiredMetricId
  readonly value: MeasurementState<number | CanonicalDecimal>
  readonly numerator: number | CanonicalDecimal
  readonly denominator: number
  readonly eligibilityBoundary: string
  readonly counts: Readonly<{ includedCount: number; excludedCount: number; eligibleCount: number }>
  readonly coverageRatio: CanonicalDecimal<'PROBABILITY'>
  readonly provenance: 'OBSERVED' | 'MODELED_FROM_PRICING'
  readonly observationRefs: readonly string[]
}

export function aggregateReliabilityObservations(input: unknown) {
  const set = validateReliabilityObservationSet(input)
  const calls = sortProviderCallObservationsUtf8(set.providerCalls)
  const logical = set.logicalGenerationUnits
  const recoveries = set.recoveryActions
  const novels = set.novelExecutions
  const requiredMetrics: AggregateMetric[] = [
    rate('FIRST_ATTEMPT_SUCCESS_RATE', logical.filter((unit) => unit.terminalOutcome === 'SUCCESS' && unit.attemptCount >= 1).length, logical.length, 'logical generation units with terminally observed attempt 1', logical.map(ref)),
    rate('RETRY_SUCCESS_RATE', logical.filter((unit) => unit.attemptCount > 1 && unit.terminalOutcome === 'SUCCESS').length, logical.filter((unit) => unit.attemptCount > 1).length, 'logical generation units with at least one retry and terminal outcome', logical.filter((unit) => unit.attemptCount > 1).map(ref)),
    rate('TERMINAL_FAILURE_RATE', logical.filter((unit) => unit.terminalOutcome === 'FAILURE').length, logical.length, 'logical generation units entering generation with terminal outcome', logical.map(ref)),
    rate('CHECKPOINT_REUSE_RATE', recoveries.filter((item) => item.checkpointDecisionObserved && item.reusedExactValidCheckpoint).length, recoveries.filter((item) => item.checkpointDecisionObserved).length, 'recovery actions after checkpoint-bearing interruption with checkpoint decision observed', recoveries.filter((item) => item.checkpointDecisionObserved).map(ref)),
    rate('PROSE_REGENERATION_ON_CHOICE_RETRY_RATE', recoveries.filter((item) => item.choiceRetryAfterValidProseCheckpoint && item.regeneratedProse).length, recoveries.filter((item) => item.choiceRetryAfterValidProseCheckpoint).length, 'choice retries after valid prose checkpoint where choice-only retry is allowed', recoveries.filter((item) => item.choiceRetryAfterValidProseCheckpoint).map(ref)),
    rate('OWNERSHIP_LOSS_RECOVERY_RATE', recoveries.filter((item) => item.recoveryKind === 'OWNERSHIP_LOSS' && item.terminalOutcome === 'SUCCESS' && !item.manualDatabaseMutation).length, recoveries.filter((item) => item.recoveryKind === 'OWNERSHIP_LOSS').length, 'ownership-loss incidents with terminal recovery outcome', recoveries.filter((item) => item.recoveryKind === 'OWNERSHIP_LOSS').map(ref)),
    rate('RECOVERY_SUCCESS_RATE', recoveries.filter((item) => item.terminalOutcome === 'SUCCESS' && !item.manualDatabaseMutation).length, recoveries.length, 'retry, checkpoint resume, stale-lease reclaim, or ownership-loss recovery actions with terminal outcome', recoveries.map(ref)),
    rate('PROVIDER_FALLBACK_RATE', logical.filter((unit) => unit.fallbackEligible && unit.fallbackInvoked).length, logical.filter((unit) => unit.fallbackEligible).length, 'logical generation units reaching provider selection where fallback policy applies', logical.filter((unit) => unit.fallbackEligible).map(ref)),
    rate('FULL_NOVEL_COMPLETION_RATE', novels.filter(isSuccessfulCompleteNovel).length, novels.length, 'novel executions started at chapter 1 with terminal observed outcome', novels.map(ref)),
    countMetric('RETRY_COUNT', calls.filter((call) => call.attemptNumber > 1).length + recoveries.length, logical.length + recoveries.length, 'attempts after attempt 1 and topology recovery actions', [...calls.filter((call) => call.attemptNumber > 1).map(ref), ...recoveries.map(ref)], logical.length + recoveries.length),
    countMetric('GENERATION_PROVIDER_CALL_COUNT', calls.length, calls.length, 'reached generation provider nodes', calls.map(ref), calls.length),
    countMetric('JUDGE_PROVIDER_CALL_COUNT', set.judgeEvaluations.length, set.judgeEvaluations.length, 'required sampled judge evaluations', set.judgeEvaluations.map(ref), set.judgeEvaluations.length),
    countMetric('TOTAL_PROVIDER_CALL_COUNT', calls.length + set.judgeEvaluations.length, calls.length + set.judgeEvaluations.length, 'reached generation provider nodes plus required sampled judge evaluations', [...calls.map(ref), ...set.judgeEvaluations.map(ref)], calls.length + set.judgeEvaluations.length),
    countMetric('DUPLICATE_PUBLICATION_COUNT', set.publicationAttempts.filter((item) => item.producedDuplicateCanonicalPublication).length, set.publicationAttempts.length, 'all publication attempts', set.publicationAttempts.map(ref), set.publicationAttempts.length),
    countMetric('CANONICAL_CORRUPTION_COUNT', set.canonicalInvariantChecks.filter((item) => item.outcome === 'CORRUPT').length, set.canonicalInvariantChecks.length, 'all required post-operation invariant checks', set.canonicalInvariantChecks.map(ref), set.canonicalInvariantChecks.length),
    percentileMetric('GENERATION_LATENCY_P50', logical, '0.50', 'terminally observed generation units with authorized start/end timestamps'),
    percentileMetric('GENERATION_LATENCY_P95', logical, '0.95', 'terminally observed generation units with authorized start/end timestamps'),
    percentileMetric('RECOVERY_LATENCY_P50', recoveries, '0.50', 'terminal recovery actions with authorized start/end timestamps'),
    percentileMetric('RECOVERY_LATENCY_P95', recoveries, '0.95', 'terminal recovery actions with authorized start/end timestamps'),
    tokenMetric('INPUT_TOKEN_USAGE', calls, 'inputTokens'), tokenMetric('OUTPUT_TOKEN_USAGE', calls, 'outputTokens'), tokenMetric('TOTAL_TOKEN_USAGE', calls, 'totalTokens'),
    costMetric('ACTUAL_PROVIDER_COST', calls, 'actualCost', 'OBSERVED'), costMetric('PRICING_ESTIMATED_COST', calls, 'estimatedCost', 'MODELED_FROM_PRICING'),
    coverageMetric('ACTUAL_COST_COVERAGE_RATIO', calls, 'actualCost', 'OBSERVED'), coverageMetric('PRICING_COST_COVERAGE_RATIO', calls, 'estimatedCost', 'MODELED_FROM_PRICING'),
  ]

  const chapterStageDiagnostics = set.declaredApplicableCells.map(({ chapterNumber, stageId }) => {
    const observations = set.stageOutcomes.filter((item) => item.chapterNumber === chapterNumber && item.stageId === stageId)
    const failures = observations.filter((item) => item.outcome === 'FAILURE').length
    return deepFreeze({ chapterNumber, stageId, numerator: failures, denominator: observations.length,
      failureProbability: probabilityState(failures, observations.length), eligibilityBoundary: 'reached finalized stage outcomes at same chapter and stage', observationRefs: observations.map(ref) })
  })
  const centralStageFailureProbabilities = STAGE_IDS.map((stageId) => {
    const observations = set.stageOutcomes.filter((item) => item.stageId === stageId)
    const failures = observations.filter((item) => item.outcome === 'FAILURE').length
    const authority = set.exchangeabilityAuthorities.find((item) => item.stageId === stageId)
    if (!authority) throw new Error(`Missing exchangeability authority for ${stageId}`)
    return deepFreeze({ probabilityKey: 'stageId' as const, stageId, numerator: failures, denominator: observations.length,
      failureProbability: observedValue(probabilityState(failures, observations.length), observations.length > 0 ? observations.map(ref) : [authority.decisionRef]),
      eligibilityBoundary: 'eligible reached finalized stage outcomes pooled across chapters and executions in exact profile stratum',
      counts: counts(observations.length, observations.length), coverageRatio: ratioOf(BigInt(observations.length), BigInt(observations.length || 1)),
      observationRefs: observations.map(ref), exchangeabilityAuthority: authority })
  })

  const poolMinimum = set.executionProfile === 'RELEASE_EVIDENCE' ? 30 : 1
  const completeNovelMinimum = set.executionProfile === 'RELEASE_EVIDENCE' ? 10 : 0
  const completeNovelCount = novels.filter(isSuccessfulCompleteNovel).length
  const profileCompleteness = deepFreeze({
    executionProfile: set.executionProfile, exactCompatibleStratum: set.compatibleStratum,
    stagePools: centralStageFailureProbabilities.map((item) => ({ stageId: item.stageId, minimum: poolMinimum, observed: item.denominator, complete: item.denominator >= poolMinimum })),
    applicableCells: chapterStageDiagnostics.map((item) => ({ chapterNumber: item.chapterNumber, stageId: item.stageId, minimum: 1, observed: item.denominator, complete: item.denominator >= 1 })),
    completeNovels: { minimum: completeNovelMinimum, observed: completeNovelCount, complete: completeNovelCount >= completeNovelMinimum },
  })

  return deepFreeze({
    executionProfile: set.executionProfile, compatibleStratum: set.compatibleStratum, requiredMetrics,
    centralStageFailureProbabilities, chapterStageDiagnostics, profileCompleteness,
    observedCostComparators: {
      maxObservedMeanGenerationCostPerChapter: chapterComparator(set),
      meanGenerationCostPerSuccessfulCompleteNovel: novelCostMean(set, true),
    },
    observedCostDiagnostics: { meanGenerationSpendPerStartedNovelAttempt: { ...novelCostMean(set, false), comparatorEligible: false as const } },
  })
}

function rate(metricId: RequiredMetricId, numerator: number, denominator: number, boundary: string, refs: string[]): AggregateMetric {
  return metric(metricId, probabilityState(numerator, denominator), numerator, denominator, boundary, counts(denominator, denominator), 'OBSERVED', refs)
}
function countMetric(metricId: RequiredMetricId, value: number, denominator: number, boundary: string, refs: string[], eligible: number): AggregateMetric {
  return metric(metricId, presentMeasurement(value), value, denominator, boundary, counts(eligible, eligible), 'OBSERVED', refs)
}
function percentileMetric(metricId: RequiredMetricId, items: readonly { elapsedMilliseconds: MeasurementState<CanonicalDecimal<'LATENCY_MILLISECONDS'>>; observationId: string }[], quantile: '0.50' | '0.95', boundary: string): AggregateMetric {
  const values = items.flatMap((item) => item.elapsedMilliseconds.state === 'PRESENT' ? [item.elapsedMilliseconds.value] : [])
  return metric(metricId, percentileCont(values, quantile, 'LATENCY_MILLISECONDS'), values.length === 0 ? 0 : values[0]!, items.length, boundary, counts(values.length, items.length), 'OBSERVED', items.map(ref))
}
function tokenMetric(metricId: RequiredMetricId, calls: ReliabilityObservationSet['providerCalls'], key: 'inputTokens' | 'outputTokens' | 'totalTokens'): AggregateMetric {
  const covered = calls.filter((call) => call[key].state === 'PRESENT')
  const value = covered.length === 0 && calls.length > 0 ? missingMeasurement<number>('OBSERVATION_COVERAGE_INCOMPLETE', 'No covered token observations') : presentMeasurement(covered.reduce((sum, call) => sum + (call[key].state === 'PRESENT' ? call[key].value : 0), 0))
  return metric(metricId, value, value.state === 'PRESENT' ? value.value : 0, calls.length, 'provider calls in selected task/chapter/novel identity scope', counts(covered.length, calls.length), 'OBSERVED', calls.map(ref))
}
function costMetric(metricId: RequiredMetricId, calls: ReliabilityObservationSet['providerCalls'], key: 'actualCost' | 'estimatedCost', provenance: 'OBSERVED' | 'MODELED_FROM_PRICING'): AggregateMetric {
  const values = calls.flatMap((call) => call[key].state === 'PRESENT' ? [call[key].value] : [])
  const value = values.length === 0 && calls.length > 0 ? missingMeasurement<Money>('COST_UNAVAILABLE', 'No covered cost observations') : presentMeasurement(sumDecimals(values, 'MONEY'))
  return metric(metricId, value, value.state === 'PRESENT' ? value.value : '0.00000000' as Money, calls.length, 'provider calls denominated in exact compatible stratum currency', counts(values.length, calls.length), provenance, calls.map(ref))
}
function coverageMetric(metricId: RequiredMetricId, calls: ReliabilityObservationSet['providerCalls'], key: 'actualCost' | 'estimatedCost', provenance: 'OBSERVED' | 'MODELED_FROM_PRICING'): AggregateMetric {
  const covered = calls.filter((call) => call[key].state === 'PRESENT').length
  return metric(metricId, probabilityState(covered, calls.length), covered, calls.length, 'selected provider calls with complete applicable cost state', counts(covered, calls.length), provenance, calls.map(ref))
}
function metric(metricId: RequiredMetricId, value: AggregateMetric['value'], numerator: AggregateMetric['numerator'], denominator: number, boundary: string, metricCounts: AggregateMetric['counts'], provenance: AggregateMetric['provenance'], refs: string[]): AggregateMetric {
  return deepFreeze({ metricId, value, numerator, denominator, eligibilityBoundary: boundary, counts: metricCounts,
    coverageRatio: ratioOf(BigInt(metricCounts.includedCount), BigInt(metricCounts.eligibleCount || 1)), provenance, observationRefs: utf8Sort(refs) })
}
function counts(includedCount: number, eligibleCount: number) { return { includedCount, excludedCount: eligibleCount - includedCount, eligibleCount } }
function probabilityState(numerator: number, denominator: number): MeasurementState<CanonicalDecimal<'PROBABILITY'>> { return denominator === 0 ? missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'Rate requires eligible observed denominator') : presentMeasurement(ratioOf(BigInt(numerator), BigInt(denominator))) }
function ref(item: { observationId: string }): string { return item.observationId }
function isSuccessfulCompleteNovel(item: ReliabilityObservationSet['novelExecutions'][number]): boolean { return item.terminalOutcome === 'SUCCESS' && item.completedChapterNumbers.length === 50 }

function chapterComparator(set: ReliabilityObservationSet) {
  const means: Money[] = []
  let eligible = 0
  let included = 0
  const refs: string[] = []
  for (let chapter = 1; chapter <= 50; chapter += 1) {
    const executions = set.chapterExecutions.filter((item) => item.chapterNumber === chapter)
    eligible += executions.length
    const values = executions.flatMap((item) => item.generationCost.state === 'PRESENT' ? [item.generationCost.value] : [])
    included += values.length
    refs.push(...executions.map(ref))
    if (values.length > 0) means.push(decimalMean(values, 'MONEY'))
  }
  const maximum = means.reduce<Money | null>((current, value) => current === null || compareDecimals(value, current, 'MONEY') > 0 ? value : current, null)
  return costMeanResult(maximum === null ? null : maximum, included, eligible, 'complete observed generation costs grouped into exact per-chapter means; maximum of available chapter means', refs)
}
function novelCostMean(set: ReliabilityObservationSet, successfulOnly: boolean) {
  const eligibleItems = successfulOnly ? set.novelExecutions.filter(isSuccessfulCompleteNovel) : set.novelExecutions
  const values = eligibleItems.flatMap((item) => item.generationCost.state === 'PRESENT' ? [item.generationCost.value] : [])
  return costMeanResult(values.length === 0 ? null : decimalMean(values, 'MONEY'), values.length, eligibleItems.length,
    successfulOnly ? 'successful observed complete chapter 1..50 novel runs only; judge excluded' : 'all started observed novel attempts including partial terminal failures; judge excluded', eligibleItems.map(ref))
}
function costMeanResult(value: Money | null, included: number, eligible: number, boundary: string, refs: string[]) {
  return deepFreeze({ value: value === null ? missingMeasurement<Money>('COST_UNAVAILABLE', 'No complete observed generation cost sample') : presentMeasurement(value), denominator: included,
    eligibilityBoundary: boundary, counts: counts(included, eligible), coverageRatio: ratioOf(BigInt(included), BigInt(eligible || 1)), provenance: 'OBSERVED' as const, observationRefs: utf8Sort(refs) })
}
function utf8Sort(values: readonly string[]): string[] { return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))) }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }; return value }
