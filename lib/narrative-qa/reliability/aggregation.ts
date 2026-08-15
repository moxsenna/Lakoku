import { STAGE_IDS, missingMeasurement, observedValue, presentMeasurement, type MeasurementState } from './contracts'
import { compareDecimals, decimalMean, percentageOf, percentileCont, ratioOf, sumDecimals, type CanonicalDecimal } from './decimal'
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
  | 'PRICING_COST_COVERAGE_RATIO' | 'EMPIRICAL_CHAPTER_STAGE_FAILURE_DISTRIBUTION' | 'OBSERVED_COMPLETED_NOVEL_COUNT'
  | 'FIRST_ATTEMPT_BASELINE_COST' | 'RETRY_FALLBACK_COST' | 'RETRY_OVERHEAD_PERCENTAGE' | 'CHAPTER_COST_P50'
  | 'CHAPTER_COST_P95' | 'JUDGE_EVALUATION_COST'

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
  readonly partialObservedValue?: MeasurementState<number | CanonicalDecimal>
}

export function aggregateReliabilityObservations(input: unknown) {
  const set = validateReliabilityObservationSet(input)
  const calls = sortProviderCallObservationsUtf8(set.providerCalls)
  const logical = set.logicalGenerationUnits
  const recoveries = set.recoveryActions
  const novels = set.novelExecutions
  const requiredMetrics: AggregateMetric[] = [
    rate('FIRST_ATTEMPT_SUCCESS_RATE', logical.filter((unit) => calls.some((call) => call.logicalUnitAlias === unit.logicalUnitAlias && call.attemptNumber === 1 && call.outcome === 'SUCCESS')).length, logical.filter((unit) => calls.some((call) => call.logicalUnitAlias === unit.logicalUnitAlias && call.attemptNumber === 1)).length, 'logical generation units with terminally observed exact attempt 1 outcome', logical.map(ref)),
    rate('RETRY_SUCCESS_RATE', logical.filter((unit) => unit.attemptCount > 1 && unit.terminalOutcome === 'SUCCESS').length, logical.filter((unit) => unit.attemptCount > 1).length, 'logical generation units with at least one retry and terminal outcome', logical.filter((unit) => unit.attemptCount > 1).map(ref)),
    rate('TERMINAL_FAILURE_RATE', logical.filter((unit) => unit.terminalOutcome === 'FAILURE').length, logical.length, 'logical generation units entering generation with terminal outcome', logical.map(ref)),
    rate('CHECKPOINT_REUSE_RATE', recoveries.filter((item) => item.checkpointDecisionObserved && item.reusedExactValidCheckpoint).length, recoveries.filter((item) => item.checkpointDecisionObserved).length, 'recovery actions after checkpoint-bearing interruption with checkpoint decision observed', recoveries.filter((item) => item.checkpointDecisionObserved).map(ref)),
    rate('PROSE_REGENERATION_ON_CHOICE_RETRY_RATE', recoveries.filter((item) => item.choiceRetryAfterValidProseCheckpoint && item.regeneratedProse).length, recoveries.filter((item) => item.choiceRetryAfterValidProseCheckpoint).length, 'choice retries after valid prose checkpoint where choice-only retry is allowed', recoveries.filter((item) => item.choiceRetryAfterValidProseCheckpoint).map(ref)),
    rate('OWNERSHIP_LOSS_RECOVERY_RATE', recoveries.filter((item) => item.recoveryKind === 'OWNERSHIP_LOSS' && item.terminalOutcome === 'SUCCESS' && !item.manualDatabaseMutation).length, recoveries.filter((item) => item.recoveryKind === 'OWNERSHIP_LOSS').length, 'ownership-loss incidents with terminal recovery outcome', recoveries.filter((item) => item.recoveryKind === 'OWNERSHIP_LOSS').map(ref)),
    rate('RECOVERY_SUCCESS_RATE', recoveries.filter((item) => item.terminalOutcome === 'SUCCESS' && !item.manualDatabaseMutation).length, recoveries.length, 'retry, checkpoint resume, stale-lease reclaim, or ownership-loss recovery actions with terminal outcome', recoveries.map(ref)),
    rate('PROVIDER_FALLBACK_RATE', logical.filter((unit) => unit.fallbackEligible && unit.fallbackInvoked).length, logical.filter((unit) => unit.fallbackEligible).length, 'logical generation units reaching provider selection where fallback policy applies', logical.filter((unit) => unit.fallbackEligible).map(ref)),
    rate('FULL_NOVEL_COMPLETION_RATE', novels.filter(isSuccessfulCompleteNovel).length, novels.length, 'novel executions started at chapter 1 with terminal observed outcome', novels.map(ref)),
    countMetric('RETRY_COUNT', set.stageOutcomes.filter((stage) => ['PROSE_RETRY', 'CHECKPOINT_RECOVERY', 'STRUCTURED_RETRY', 'OWNERSHIP_RECOVERY', 'PUBLICATION_RECOVERY'].includes(stage.stageId)).length, set.stageOutcomes.length, 'reached stages whose frozen retryCounterEffect is INCREMENT', set.stageOutcomes.map(ref), set.stageOutcomes.length),
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
    rate('EMPIRICAL_CHAPTER_STAGE_FAILURE_DISTRIBUTION', set.stageOutcomes.filter((item) => item.outcome === 'FAILURE').length, set.stageOutcomes.length, 'reached finalized stage outcomes at exact chapter-stage cells', set.stageOutcomes.map(ref)),
    countMetric('OBSERVED_COMPLETED_NOVEL_COUNT', novels.filter(isSuccessfulCompleteNovel).length, novels.length, 'valid complete chapter 1..50 novel executions among started novels', novels.map(ref), novels.length),
    costClassMetric('FIRST_ATTEMPT_BASELINE_COST', calls.filter((call) => call.stageId === 'PROSE_PRIMARY' || call.stageId === 'STRUCTURED_OUTPUT'), 'first reached PROSE_PRIMARY and STRUCTURED_OUTPUT provider calls'),
    costClassMetric('RETRY_FALLBACK_COST', calls.filter((call) => ['PROSE_RETRY', 'PROVIDER_FALLBACK', 'STRUCTURED_RETRY'].includes(call.stageId)), 'reached prose retry, provider fallback, and structured retry provider calls'),
    retryOverheadMetric(calls),
    chapterCostPercentile('CHAPTER_COST_P50', set, '0.50'), chapterCostPercentile('CHAPTER_COST_P95', set, '0.95'),
    judgeCostMetric(set),
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
      counts: extendedCounts(observations.length, 0, observations.length), coverageRatio: ratioOf(BigInt(observations.length), BigInt(observations.length || 1)),
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

  const dimensionedMetrics = buildDimensionedMetrics(set)
  return deepFreeze({
    executionProfile: set.executionProfile, compatibleStratum: set.compatibleStratum, requiredMetrics, dimensionedMetrics,
    centralStageFailureProbabilities, chapterStageDiagnostics, profileCompleteness,
    observedCostComparators: {
      maxObservedMeanGenerationCostPerChapter: chapterComparator(set),
      observedJudgeCostMaximum: observedMaximumCost(set.judgeEvaluations.map((item) => item.cost), set.judgeEvaluations.map(ref), 'observed judge-evaluation maximum diagnostic only'),
      observedRetryOverheadMaximum: observedMaximumCost(calls.filter((item) => item.attemptNumber > 1).map((item) => item.actualCost), calls.filter((item) => item.attemptNumber > 1).map(ref), 'observed retry/fallback cost maximum diagnostic only'),
      observedCombinedNovelCostP95: combinedNovelP95(set),
      meanGenerationCostPerSuccessfulCompleteNovel: novelCostMean(set, true),
    },
    observedCostDiagnostics: { meanGenerationSpendPerStartedNovelAttempt: { ...startedAttemptSpend(set), comparatorEligible: false as const } },
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
  const partial = presentMeasurement(covered.reduce((sum, call) => sum + (call[key].state === 'PRESENT' ? call[key].value : 0), 0))
  const value = covered.length < calls.length ? missingMeasurement<number>('OBSERVATION_COVERAGE_INCOMPLETE', 'Complete token aggregate requires every eligible provider call') : partial
  return { ...metric(metricId, value, value.state === 'PRESENT' ? value.value : covered.reduce((sum, call) => sum + (call[key].state === 'PRESENT' ? call[key].value : 0), 0), calls.length, 'provider calls in selected task/chapter/novel identity scope', counts(covered.length, calls.length), 'OBSERVED', calls.map(ref)), partialObservedValue: partial }
}
function costMetric(metricId: RequiredMetricId, calls: ReliabilityObservationSet['providerCalls'], key: 'actualCost' | 'estimatedCost', provenance: 'OBSERVED' | 'MODELED_FROM_PRICING'): AggregateMetric {
  const values = calls.flatMap((call) => call[key].state === 'PRESENT' ? [call[key].value] : [])
  const partial = presentMeasurement(sumDecimals(values, 'MONEY'))
  const value = values.length < calls.length ? missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', 'Complete cost aggregate requires every eligible provider call') : partial
  return { ...metric(metricId, value, value.state === 'PRESENT' ? value.value : sumDecimals(values, 'MONEY'), calls.length, 'provider calls denominated in exact compatible stratum currency', counts(values.length, calls.length), provenance, calls.map(ref)), partialObservedValue: partial }
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
  const maximum = means.length === 50 ? means.reduce<Money | null>((current, value) => current === null || compareDecimals(value, current, 'MONEY') > 0 ? value : current, null) : null
  return { ...costMeanResult(maximum, included, eligible, 'all 50 exact observed per-chapter generation cost means; judge excluded', refs), chapterMeanCounts: counts(means.length, 50) }
}
function novelCostMean(set: ReliabilityObservationSet, successfulOnly: boolean) {
  const eligibleItems = successfulOnly ? set.novelExecutions.filter(isSuccessfulCompleteNovel) : set.novelExecutions
  const values = eligibleItems.flatMap((item) => item.generationCost.state === 'PRESENT' ? [item.generationCost.value] : [])
  return costMeanResult(values.length === 0 ? null : decimalMean(values, 'MONEY'), values.length, eligibleItems.length,
    successfulOnly ? 'successful observed complete chapter 1..50 novel runs only; judge excluded' : 'all started observed novel attempts including partial terminal failures; judge excluded', eligibleItems.map(ref))
}
function startedAttemptSpend(set: ReliabilityObservationSet) {
  const samples = set.novelExecutions.flatMap((novel) => {
    const calls = set.providerCalls.filter((call) => call.novelExecutionAlias === novel.novelExecutionAlias)
    if (calls.length === 0 || calls.some((call) => call.actualCost.state !== 'PRESENT')) return []
    return [sumDecimals(calls.flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : []), 'MONEY')]
  })
  return costMeanResult(samples.length === 0 ? null : decimalMean(samples, 'MONEY'), samples.length, set.novelExecutions.length, 'complete reached generation-call actual costs through each started attempt terminal boundary; partial failures included; judge excluded', [...set.novelExecutions.map(ref), ...set.providerCalls.map(ref)])
}
function costMeanResult(value: Money | null, included: number, eligible: number, boundary: string, refs: string[]) {
  return deepFreeze({ value: value === null ? missingMeasurement<Money>('COST_UNAVAILABLE', 'No complete observed generation cost sample') : presentMeasurement(value), denominator: included,
    eligibilityBoundary: boundary, counts: counts(included, eligible), coverageRatio: ratioOf(BigInt(included), BigInt(eligible || 1)), provenance: 'OBSERVED' as const, observationRefs: utf8Sort(refs) })
}
function extendedCounts(includedCount: number, unavailableCount: number, eligibleCount: number) { return { includedCount, excludedCount: eligibleCount - includedCount - unavailableCount, unavailableCount, eligibleCount } }
function costClassMetric(metricId: RequiredMetricId, calls: ReliabilityObservationSet['providerCalls'], boundary: string): AggregateMetric { return costMetric(metricId, calls, 'actualCost', 'OBSERVED') && { ...costMetric(metricId, calls, 'actualCost', 'OBSERVED'), eligibilityBoundary: boundary } }
function retryOverheadMetric(calls: ReliabilityObservationSet['providerCalls']): AggregateMetric {
  const baseline = calls.filter((call) => call.stageId === 'PROSE_PRIMARY' || call.stageId === 'STRUCTURED_OUTPUT').flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])
  const retry = calls.filter((call) => ['PROSE_RETRY', 'PROVIDER_FALLBACK', 'STRUCTURED_RETRY'].includes(call.stageId)).flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])
  const eligible = baseline.length + retry.length
  const value = baseline.length === 0 ? missingMeasurement<CanonicalDecimal<'PERCENTAGE'>>('COST_UNAVAILABLE', 'Retry overhead requires positive complete baseline') : presentMeasurement(percentageMoney(sumDecimals(retry, 'MONEY'), sumDecimals(baseline, 'MONEY')))
  return metric('RETRY_OVERHEAD_PERCENTAGE', value, retry.length, baseline.length, 'retry/fallback provider cost divided by first-attempt baseline provider cost', counts(eligible, eligible), 'OBSERVED', calls.map(ref))
}
function percentageMoney(numerator: Money, denominator: Money): CanonicalDecimal<'PERCENTAGE'> { return percentageOf(BigInt(numerator.replace('.', '')), BigInt(denominator.replace('.', ''))) }
function chapterCostPercentile(metricId: RequiredMetricId, set: ReliabilityObservationSet, quantile: '0.50' | '0.95'): AggregateMetric {
  const values = set.chapterExecutions.flatMap((item) => item.generationCost.state === 'PRESENT' ? [item.generationCost.value] : [])
  return metric(metricId, percentileCont(values, quantile, 'MONEY'), values.length === 0 ? 0 : values[0]!, set.chapterExecutions.length, 'complete observed chapter generation costs; judge excluded', counts(values.length, set.chapterExecutions.length), 'OBSERVED', set.chapterExecutions.map(ref))
}
function judgeCostMetric(set: ReliabilityObservationSet): AggregateMetric {
  const values = set.judgeEvaluations.flatMap((item) => item.cost.state === 'PRESENT' ? [item.cost.value] : [])
  const value = values.length < set.judgeEvaluations.length ? missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', 'Judge cost requires complete sampled judge plan coverage') : presentMeasurement(sumDecimals(values, 'MONEY'))
  return metric('JUDGE_EVALUATION_COST', value, value.state === 'PRESENT' ? value.value : 0, set.judgeEvaluations.length, 'required judge evaluations after successful complete novel', counts(values.length, set.judgeEvaluations.length), 'OBSERVED', set.judgeEvaluations.map(ref))
}
function buildDimensionedMetrics(set: ReliabilityObservationSet) {
  const groups: Array<{ scope: 'TASK' | 'CHAPTER' | 'NOVEL'; taskId?: string; chapterNumber?: number; novelExecutionAlias?: string; calls: ReliabilityObservationSet['providerCalls'] }> = []
  for (const taskId of ['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT'] as const) groups.push({ scope: 'TASK', taskId, calls: set.providerCalls.filter((call) => call.taskId === taskId) })
  for (const chapterNumber of [...new Set(set.providerCalls.map((call) => call.chapterNumber))].sort((a, b) => a - b)) groups.push({ scope: 'CHAPTER', chapterNumber, calls: set.providerCalls.filter((call) => call.chapterNumber === chapterNumber) })
  for (const novelExecutionAlias of utf8Sort([...new Set(set.providerCalls.map((call) => call.novelExecutionAlias))])) groups.push({ scope: 'NOVEL', novelExecutionAlias, calls: set.providerCalls.filter((call) => call.novelExecutionAlias === novelExecutionAlias) })
  return groups.flatMap((group) => [
    countMetric('GENERATION_PROVIDER_CALL_COUNT', group.calls.length, group.calls.length, 'reached generation provider nodes in exact identity scope', group.calls.map(ref), group.calls.length),
    tokenMetric('INPUT_TOKEN_USAGE', group.calls, 'inputTokens'), tokenMetric('OUTPUT_TOKEN_USAGE', group.calls, 'outputTokens'), tokenMetric('TOTAL_TOKEN_USAGE', group.calls, 'totalTokens'),
    costMetric('ACTUAL_PROVIDER_COST', group.calls, 'actualCost', 'OBSERVED'), costMetric('PRICING_ESTIMATED_COST', group.calls, 'estimatedCost', 'MODELED_FROM_PRICING'),
  ].map((item) => ({ ...item, ...group, calls: undefined, providerModelPolicyId: set.compatibleStratum.providerModelPolicyId, actualCostSource: group.calls[0]?.actualCostSource ?? null, pricingSnapshotHash: set.compatibleStratum.pricingSnapshotHash })))
}
function observedMaximumCost(states: readonly MeasurementState<Money>[], refs: string[], boundary: string) { const values = states.flatMap((item) => item.state === 'PRESENT' ? [item.value] : []); const maximum = values.reduce<Money | null>((current, value) => current === null || compareDecimals(value, current, 'MONEY') > 0 ? value : current, null); return costMeanResult(maximum, values.length, states.length, boundary, refs) }
function combinedNovelP95(set: ReliabilityObservationSet) { const values = set.novelExecutions.flatMap((novel) => { if (novel.generationCost.state !== 'PRESENT') return []; const judges = set.judgeEvaluations.filter((judge) => judge.novelExecutionAlias === novel.novelExecutionAlias); if (judges.some((judge) => judge.cost.state !== 'PRESENT')) return []; return [sumDecimals([novel.generationCost.value, ...judges.flatMap((judge) => judge.cost.state === 'PRESENT' ? [judge.cost.value] : [])], 'MONEY')] }); return { value: percentileCont(values, '0.95', 'MONEY'), denominator: values.length, eligibilityBoundary: 'complete observed successful novel generation plus complete judge costs', counts: counts(values.length, set.novelExecutions.length), coverageRatio: ratioOf(BigInt(values.length), BigInt(set.novelExecutions.length || 1)), provenance: 'OBSERVED' as const, observationRefs: utf8Sort([...set.novelExecutions.map(ref), ...set.judgeEvaluations.map(ref)]) } }
function utf8Sort(values: readonly string[]): string[] { return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))) }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }; return value }
