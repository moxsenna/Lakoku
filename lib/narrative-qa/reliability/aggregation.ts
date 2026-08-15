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

export const P4_ENGINEERING_REASON_ORDER = [
  'DUPLICATE_PUBLICATION_DETECTED', 'CANONICAL_CORRUPTION_DETECTED', 'STAGE_POOL_THRESHOLD_NOT_MET', 'APPLICABLE_CELL_COVERAGE_INCOMPLETE',
  'COMPLETE_NOVEL_THRESHOLD_NOT_MET', 'RETRY_RECOVERY_FALLBACK_COVERAGE_INCOMPLETE', 'PUBLICATION_INVARIANT_COVERAGE_INCOMPLETE',
  'LATENCY_COVERAGE_INCOMPLETE', 'TOKEN_COVERAGE_INCOMPLETE', 'PROVIDER_JUDGE_COUNT_COVERAGE_INCOMPLETE', 'COST_COVERAGE_INCOMPLETE',
] as const
export type P4EngineeringReason = (typeof P4_ENGINEERING_REASON_ORDER)[number]
export type ReliabilityEvidenceClassification = Readonly<
  | { engineeringGate: 'PASS' | 'HOLD' | 'FAIL'; reasonCodes: readonly P4EngineeringReason[]; aggregate: ReturnType<typeof aggregateReliabilityObservations> }
  | { engineeringGate: 'FAIL'; reasonCodes: readonly ['MALFORMED_EVIDENCE']; error: string }
>

export function classifyReliabilityObservations(input: unknown): ReliabilityEvidenceClassification {
  try {
    const aggregate = aggregateReliabilityObservations(input)
    const metric = (id: RequiredMetricId) => aggregate.requiredMetrics.find((item) => item.metricId === id)
    const missing = (ids: readonly RequiredMetricId[]) => ids.some((id) => metric(id)?.value.state !== 'PRESENT')
    const reasons = new Set<P4EngineeringReason>(aggregate.profileCompleteness.reasonCodes)
    if ((metric('DUPLICATE_PUBLICATION_COUNT')?.numerator ?? 0) !== 0) reasons.add('DUPLICATE_PUBLICATION_DETECTED')
    if ((metric('CANONICAL_CORRUPTION_COUNT')?.numerator ?? 0) !== 0) reasons.add('CANONICAL_CORRUPTION_DETECTED')
    if (missing(['RETRY_SUCCESS_RATE', 'CHECKPOINT_REUSE_RATE', 'PROSE_REGENERATION_ON_CHOICE_RETRY_RATE', 'OWNERSHIP_LOSS_RECOVERY_RATE', 'RECOVERY_SUCCESS_RATE', 'PROVIDER_FALLBACK_RATE'])) reasons.add('RETRY_RECOVERY_FALLBACK_COVERAGE_INCOMPLETE')
    if (metric('DUPLICATE_PUBLICATION_COUNT')?.denominator === 0 || metric('CANONICAL_CORRUPTION_COUNT')?.denominator === 0) reasons.add('PUBLICATION_INVARIANT_COVERAGE_INCOMPLETE')
    if (missing(['GENERATION_LATENCY_P50', 'GENERATION_LATENCY_P95', 'RECOVERY_LATENCY_P50', 'RECOVERY_LATENCY_P95'])) reasons.add('LATENCY_COVERAGE_INCOMPLETE')
    if (missing(['INPUT_TOKEN_USAGE', 'OUTPUT_TOKEN_USAGE', 'TOTAL_TOKEN_USAGE'])) reasons.add('TOKEN_COVERAGE_INCOMPLETE')
    if (missing(['GENERATION_PROVIDER_CALL_COUNT', 'JUDGE_PROVIDER_CALL_COUNT', 'TOTAL_PROVIDER_CALL_COUNT'])) reasons.add('PROVIDER_JUDGE_COUNT_COVERAGE_INCOMPLETE')
    const judgeCostIncomplete = aggregate.requiredMetrics.find((item) => item.metricId === 'FULL_NOVEL_COMPLETION_RATE')?.numerator !== 0 && metric('JUDGE_EVALUATION_COST')?.value.state !== 'PRESENT'
    if (missing(['PRICING_ESTIMATED_COST', 'PRICING_COST_COVERAGE_RATIO']) || judgeCostIncomplete) reasons.add('COST_COVERAGE_INCOMPLETE')
    const reasonCodes = P4_ENGINEERING_REASON_ORDER.filter((reason) => reasons.has(reason))
    const safetyFailure = reasonCodes.some((reason) => reason === 'DUPLICATE_PUBLICATION_DETECTED' || reason === 'CANONICAL_CORRUPTION_DETECTED')
    return deepFreeze({ engineeringGate: safetyFailure ? 'FAIL' as const : reasonCodes.length === 0 ? 'PASS' as const : 'HOLD' as const, reasonCodes, aggregate })
  } catch (error) {
    return deepFreeze({ engineeringGate: 'FAIL' as const, reasonCodes: ['MALFORMED_EVIDENCE'] as const, error: error instanceof Error ? error.message : 'Unknown malformed evidence' })
  }
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
    modeledUnavailableMetric('FIRST_ATTEMPT_BASELINE_COST', 'P5 pricing selection required for modeled first-attempt baseline'),
    modeledUnavailableMetric('RETRY_FALLBACK_COST', 'P5 pricing selection required for modeled retry/fallback cost'),
    modeledUnavailableMetric('RETRY_OVERHEAD_PERCENTAGE', 'P5 modeled baseline and retry costs required'),
    ...Array.from({ length: 50 }, (_, index) => chapterCostPercentile('CHAPTER_COST_P50', set, '0.50', index + 1)),
    ...Array.from({ length: 50 }, (_, index) => chapterCostPercentile('CHAPTER_COST_P95', set, '0.95', index + 1)),
    judgeCostMetric(set),
  ]

  const chapterStageDiagnostics = set.declaredApplicableCells.map(({ chapterNumber, stageId }) => {
    const observations = set.stageOutcomes.filter((item) => item.chapterNumber === chapterNumber && item.stageId === stageId)
    const failures = observations.filter((item) => item.outcome === 'FAILURE').length
    return deepFreeze({ chapterNumber, stageId, numerator: failures, denominator: observations.length,
      failureProbability: probabilityState(failures, observations.length), eligibilityBoundary: 'reached finalized stage outcomes at same chapter and stage',
      counts: extendedCounts(observations.length, 0, observations.length), coverageRatio: ratioOf(BigInt(observations.length), BigInt(observations.length || 1)),
      provenance: 'OBSERVED' as const, executionProfile: set.executionProfile, compatibleStratum: set.compatibleStratum,
      providerModelPolicyId: set.compatibleStratum.providerModelPolicyId, sourceAuthorityHash: set.observationSourceAuthority.canonicalHash,
      sourceRefs: utf8Sort([...new Set(observations.map((item) => item.sourceRef))]), observationRefs: utf8Sort(observations.map(ref)) })
  })
  const centralStageFailureProbabilities = STAGE_IDS.map((stageId) => {
    const observations = set.stageOutcomes.filter((item) => item.stageId === stageId)
    const failures = observations.filter((item) => item.outcome === 'FAILURE').length
    const authority = set.exchangeabilityAuthorities.find((item) => item.stageId === stageId)
    if (!authority) throw new Error(`Missing exchangeability authority for ${stageId}`)
    return deepFreeze({ probabilityKey: 'stageId' as const, stageId, numerator: failures, denominator: observations.length,
      failureProbability: observedValue(probabilityState(failures, observations.length), observations.map(ref)),
      eligibilityBoundary: 'eligible reached finalized stage outcomes pooled across chapters and executions in exact profile stratum',
      counts: extendedCounts(observations.length, 0, observations.length), coverageRatio: ratioOf(BigInt(observations.length), BigInt(observations.length || 1)),
      observationRefs: observations.map(ref), exchangeabilityAuthority: authority })
  })

  const poolMinimum = set.executionProfile === 'RELEASE_EVIDENCE' ? 30 : 1
  const completeNovelMinimum = set.executionProfile === 'RELEASE_EVIDENCE' ? 10 : 0
  const completeNovelCount = novels.filter(isSuccessfulCompleteNovel).length
  const stagePools = centralStageFailureProbabilities.map((item) => ({ stageId: item.stageId, minimum: poolMinimum, observed: item.denominator, complete: item.denominator >= poolMinimum }))
  const applicableCells = chapterStageDiagnostics.map((item) => ({ chapterNumber: item.chapterNumber, stageId: item.stageId, minimum: 1, observed: item.denominator, complete: item.denominator >= 1 }))
  const completeNovels = { minimum: completeNovelMinimum, observed: completeNovelCount, complete: completeNovelCount >= completeNovelMinimum }
  const reasonCodes = [
    ...(stagePools.some((item) => !item.complete) ? ['STAGE_POOL_THRESHOLD_NOT_MET' as const] : []),
    ...(applicableCells.some((item) => !item.complete) ? ['APPLICABLE_CELL_COVERAGE_INCOMPLETE' as const] : []),
    ...(!completeNovels.complete ? ['COMPLETE_NOVEL_THRESHOLD_NOT_MET' as const] : []),
  ]
  const profileCompleteness = deepFreeze({
    executionProfile: set.executionProfile, exactCompatibleStratum: set.compatibleStratum, stagePools, applicableCells, completeNovels,
    engineeringGate: reasonCodes.length === 0 ? 'PASS' as const : 'HOLD' as const, reasonCodes,
  })

  const dimensionedMetrics = buildDimensionedMetrics(set, requiredMetrics)
  return deepFreeze({
    executionProfile: set.executionProfile, compatibleStratum: set.compatibleStratum, requiredMetrics, dimensionedMetrics,
    centralStageFailureProbabilities, chapterStageDiagnostics, profileCompleteness,
    observedCostComparators: {
      maxObservedMeanGenerationCostPerChapter: chapterComparator(set),
      observedJudgeCostMaximum: perNovelJudgeMaximum(set),
      observedRetryOverheadMaximum: perNovelRetryOverheadMaximum(set),
      observedCombinedNovelCostP95: combinedNovelP95(set),
      meanGenerationCostPerSuccessfulCompleteNovel: novelCostMean(set, true),
    },
    modeledPricingSlots: {
      firstAttemptBaselineCost: unavailablePricingSlot(set, 'P5 pricing selection required for modeled first-attempt baseline'),
      retryFallbackCost: unavailablePricingSlot(set, 'P5 pricing selection required for modeled retry/fallback cost'),
      retryOverheadPercentage: unavailablePricingSlot(set, 'P5 modeled baseline and retry costs required'),
      expectedChapterGenerationMeans: Array.from({ length: 50 }, (_, index) => ({ chapterNumber: index + 1, ...unavailablePricingSlot(set, 'P5/P6 modeled chapter mean unavailable') })),
      expectedGenerationCostPerSuccessfulNovelRun: unavailablePricingSlot(set, 'P5/P6 modeled successful-novel mean unavailable'),
      modeledJudgeTotal: unavailablePricingSlot(set, 'P5/P6 modeled judge total unavailable'),
      modeledCombinedTotalNovelCostP95: unavailablePricingSlot(set, 'P5/P6 modeled combined p95 unavailable'),
    },
    observedCostDiagnostics: {
      meanGenerationSpendPerStartedNovelAttempt: { ...startedAttemptSpend(set), comparatorEligible: false as const },
      observedBaselineCost: costClassMetric('FIRST_ATTEMPT_BASELINE_COST', calls.filter((call) => call.stageId === 'PROSE_PRIMARY' || call.stageId === 'STRUCTURED_OUTPUT'), 'observed actual first-attempt diagnostic'),
      observedRetryFallbackCost: costClassMetric('RETRY_FALLBACK_COST', calls.filter((call) => ['PROSE_RETRY', 'PROVIDER_FALLBACK', 'STRUCTURED_RETRY'].includes(call.stageId)), 'observed actual retry/fallback diagnostic'),
    },
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
function modeledUnavailableMetric(metricId: RequiredMetricId, detail: string): AggregateMetric {
  return metric(metricId, missingMeasurement('COST_UNAVAILABLE', detail), 0, 0, 'modeled pricing slot; actual pricing selection and calculation belongs to P5', counts(0, 0), 'MODELED_FROM_PRICING', [])
}
function unavailablePricingSlot(set: ReliabilityObservationSet, detail: string) {
  return deepFreeze({ provenance: 'MODELED_FROM_PRICING' as const, value: missingMeasurement<Money>('COST_UNAVAILABLE', detail), pricingSnapshotHash: set.compatibleStratum.pricingSnapshotHash, observationRefs: [] as string[] })
}
function costClassMetric(metricId: RequiredMetricId, calls: ReliabilityObservationSet['providerCalls'], boundary: string): AggregateMetric { return costMetric(metricId, calls, 'actualCost', 'OBSERVED') && { ...costMetric(metricId, calls, 'actualCost', 'OBSERVED'), eligibilityBoundary: boundary } }
function percentageMoney(numerator: Money, denominator: Money): CanonicalDecimal<'PERCENTAGE'> { return percentageOf(BigInt(numerator.replace('.', '')), BigInt(denominator.replace('.', ''))) }
function chapterCostPercentile(metricId: RequiredMetricId, set: ReliabilityObservationSet, quantile: '0.50' | '0.95', chapterNumber: number): AggregateMetric & { chapterNumber: number } {
  const executions = set.chapterExecutions.filter((item) => item.chapterNumber === chapterNumber)
  const values = executions.flatMap((item) => item.generationCost.state === 'PRESENT' ? [item.generationCost.value] : [])
  return { ...metric(metricId, percentileCont(values, quantile, 'MONEY'), values.length === 0 ? 0 : values[0]!, executions.length, `complete observed chapter ${chapterNumber} generation costs; judge excluded`, counts(values.length, executions.length), 'OBSERVED', executions.map(ref)), chapterNumber }
}
function judgeCostMetric(set: ReliabilityObservationSet): AggregateMetric {
  const values = set.judgeEvaluations.flatMap((item) => item.cost.state === 'PRESENT' ? [item.cost.value] : [])
  const value = values.length < set.judgeEvaluations.length ? missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', 'Judge cost requires complete sampled judge plan coverage') : presentMeasurement(sumDecimals(values, 'MONEY'))
  return metric('JUDGE_EVALUATION_COST', value, value.state === 'PRESENT' ? value.value : 0, set.judgeEvaluations.length, 'required judge evaluations after successful complete novel', counts(values.length, set.judgeEvaluations.length), 'OBSERVED', set.judgeEvaluations.map(ref))
}
function buildDimensionedMetrics(set: ReliabilityObservationSet, requiredMetrics: readonly AggregateMetric[]) {
  type Group = { scope: 'TASK' | 'CHAPTER' | 'NOVEL_EXECUTION' | 'SOURCE' | 'PROVIDER_MODEL_POLICY'; dimensionKey: string; taskId?: string; chapterNumber?: number; novelExecutionAlias?: string; sourceRef?: string; calls: ReliabilityObservationSet['providerCalls']; stages: ReliabilityObservationSet['stageOutcomes'] }
  const groups: Group[] = []
  for (const taskId of ['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT', 'RUNTIME_RECOVERY'] as const) groups.push({ scope: 'TASK', dimensionKey: `TASK.${taskId}`, taskId, calls: set.providerCalls.filter((call) => call.taskId === taskId), stages: set.stageOutcomes.filter((stage) => stage.taskId === taskId) })
  for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) groups.push({ scope: 'CHAPTER', dimensionKey: `CHAPTER.${String(chapterNumber).padStart(2, '0')}`, chapterNumber, calls: set.providerCalls.filter((call) => call.chapterNumber === chapterNumber), stages: set.stageOutcomes.filter((stage) => stage.chapterNumber === chapterNumber) })
  for (const novelExecutionAlias of utf8Sort(set.novelExecutions.map((novel) => novel.novelExecutionAlias))) groups.push({ scope: 'NOVEL_EXECUTION', dimensionKey: `NOVEL_EXECUTION.${novelExecutionAlias}`, novelExecutionAlias, calls: set.providerCalls.filter((call) => call.novelExecutionAlias === novelExecutionAlias), stages: set.stageOutcomes.filter((stage) => stage.novelExecutionAlias === novelExecutionAlias) })
  for (const source of set.observationSourceAuthority.normalizedSources) groups.push({ scope: 'SOURCE', dimensionKey: `SOURCE.${source.sourceRef}`, sourceRef: source.sourceRef, calls: set.providerCalls.filter((call) => call.sourceRef === source.sourceRef), stages: set.stageOutcomes.filter((stage) => stage.sourceRef === source.sourceRef) })
  groups.push({ scope: 'PROVIDER_MODEL_POLICY', dimensionKey: `PROVIDER_MODEL_POLICY.${set.compatibleStratum.providerModelPolicyId}`, calls: set.providerCalls, stages: set.stageOutcomes })
  const directMetricIds = ['RETRY_COUNT', 'GENERATION_PROVIDER_CALL_COUNT', 'INPUT_TOKEN_USAGE', 'OUTPUT_TOKEN_USAGE', 'TOTAL_TOKEN_USAGE', 'ACTUAL_PROVIDER_COST', 'PRICING_ESTIMATED_COST', 'ACTUAL_COST_COVERAGE_RATIO', 'PRICING_COST_COVERAGE_RATIO'] as const
  const copiedMetricIds = [...new Set(requiredMetrics.map((metric) => metric.metricId))].filter((metricId) => !directMetricIds.includes(metricId as (typeof directMetricIds)[number]))
  const metricIds: readonly RequiredMetricId[] = [...directMetricIds, ...copiedMetricIds]
  return groups.flatMap((group) => metricIds.map((metricId) => {
    const item = metricId === 'RETRY_COUNT' ? countMetric(metricId, group.stages.filter((stage) => ['PROSE_RETRY', 'CHECKPOINT_RECOVERY', 'STRUCTURED_RETRY', 'OWNERSHIP_RECOVERY', 'PUBLICATION_RECOVERY'].includes(stage.stageId)).length, group.stages.length, 'reached frozen retry-counter stages in canonical dimension scope', group.stages.map(ref), group.stages.length)
      : metricId === 'GENERATION_PROVIDER_CALL_COUNT' ? countMetric(metricId, group.calls.length, group.calls.length, 'reached generation provider nodes in exact identity scope', group.calls.map(ref), group.calls.length)
        : metricId === 'INPUT_TOKEN_USAGE' ? tokenMetric(metricId, group.calls, 'inputTokens')
          : metricId === 'OUTPUT_TOKEN_USAGE' ? tokenMetric(metricId, group.calls, 'outputTokens')
            : metricId === 'TOTAL_TOKEN_USAGE' ? tokenMetric(metricId, group.calls, 'totalTokens')
              : metricId === 'ACTUAL_PROVIDER_COST' ? costMetric(metricId, group.calls, 'actualCost', 'OBSERVED')
                : metricId === 'PRICING_ESTIMATED_COST' ? costMetric(metricId, group.calls, 'estimatedCost', 'MODELED_FROM_PRICING')
                  : metricId === 'ACTUAL_COST_COVERAGE_RATIO' ? coverageMetric(metricId, group.calls, 'actualCost', 'OBSERVED')
                    : metricId === 'PRICING_COST_COVERAGE_RATIO' ? coverageMetric(metricId, group.calls, 'estimatedCost', 'MODELED_FROM_PRICING')
                      : copyRequiredMetric(metricId, requiredMetrics)
    return { ...item, scope: group.scope, dimensionKey: group.dimensionKey, taskId: group.taskId, chapterNumber: group.chapterNumber, novelExecutionAlias: group.novelExecutionAlias,
      sourceRef: group.sourceRef, executionProfile: set.executionProfile, providerModelPolicyId: set.compatibleStratum.providerModelPolicyId, compatibleStratum: set.compatibleStratum,
      sourceAuthorityHash: set.observationSourceAuthority.canonicalHash, actualCostSource: group.calls[0]?.actualCostSource ?? null, pricingSnapshotHash: set.compatibleStratum.pricingSnapshotHash }
  }))
}
function copyRequiredMetric(metricId: RequiredMetricId, metrics: readonly AggregateMetric[]): AggregateMetric {
  const metric = metrics.find((candidate) => candidate.metricId === metricId)
  if (!metric) throw new Error(`Missing canonical required metric ${metricId}`)
  return metric
}
function perNovelJudgeMaximum(set: ReliabilityObservationSet) {
  const eligible = set.novelExecutions.filter(isSuccessfulCompleteNovel)
  const totals = eligible.flatMap((novel) => { const judges = set.judgeEvaluations.filter((item) => item.novelExecutionAlias === novel.novelExecutionAlias); return judges.length === set.judgePlanAuthority.evaluations.length && judges.every((item) => item.cost.state === 'PRESENT') ? [sumDecimals(judges.flatMap((item) => item.cost.state === 'PRESENT' ? [item.cost.value] : []), 'MONEY')] : [] })
  const maximum = totals.reduce<Money | null>((current, value) => current === null || compareDecimals(value, current, 'MONEY') > 0 ? value : current, null)
  return costMeanResult(maximum, totals.length, eligible.length, 'maximum complete exact judge-plan total per successful complete novel', [...eligible.map(ref), ...set.judgeEvaluations.map(ref)])
}
function perNovelRetryOverheadMaximum(set: ReliabilityObservationSet) {
  const eligible = set.novelExecutions.filter(isSuccessfulCompleteNovel)
  const values = eligible.flatMap((novel) => {
    const calls = set.providerCalls.filter((call) => call.novelExecutionAlias === novel.novelExecutionAlias)
    if (calls.some((call) => call.actualCost.state !== 'PRESENT')) return []
    const baseline = calls.filter((call) => call.stageId === 'PROSE_PRIMARY' || call.stageId === 'STRUCTURED_OUTPUT').flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])
    const retry = calls.filter((call) => ['PROSE_RETRY', 'PROVIDER_FALLBACK', 'STRUCTURED_RETRY'].includes(call.stageId)).flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])
    const baselineTotal = sumDecimals(baseline, 'MONEY')
    if (baseline.length === 0 || baselineTotal === '0.00000000') return []
    return [percentageMoney(sumDecimals(retry, 'MONEY'), baselineTotal)]
  })
  const maximum = values.reduce<CanonicalDecimal<'PERCENTAGE'> | null>((current, value) => current === null || compareDecimals(value, current, 'PERCENTAGE') > 0 ? value : current, null)
  return deepFreeze({ value: maximum === null ? missingMeasurement<CanonicalDecimal<'PERCENTAGE'>>('COST_UNAVAILABLE', 'No complete observed per-novel retry overhead') : presentMeasurement(maximum), denominator: values.length,
    eligibilityBoundary: 'maximum retry/fallback actual cost divided by baseline actual cost per successful complete novel', counts: counts(values.length, eligible.length), coverageRatio: ratioOf(BigInt(values.length), BigInt(eligible.length || 1)), provenance: 'OBSERVED' as const, observationRefs: utf8Sort([...eligible.map(ref), ...set.providerCalls.map(ref)]) })
}
function combinedNovelP95(set: ReliabilityObservationSet) { const eligible = set.novelExecutions.filter(isSuccessfulCompleteNovel); const values = eligible.flatMap((novel) => { if (novel.generationCost.state !== 'PRESENT') return []; const judges = set.judgeEvaluations.filter((judge) => judge.novelExecutionAlias === novel.novelExecutionAlias); if (judges.length !== set.judgePlanAuthority.evaluations.length || judges.some((judge) => judge.cost.state !== 'PRESENT')) return []; return [sumDecimals([novel.generationCost.value, ...judges.flatMap((judge) => judge.cost.state === 'PRESENT' ? [judge.cost.value] : [])], 'MONEY')] }); return { value: percentileCont(values, '0.95', 'MONEY'), denominator: values.length, eligibilityBoundary: 'successful complete chapter 1..50 novel with complete generation total and exact complete judge plan', counts: counts(values.length, eligible.length), coverageRatio: ratioOf(BigInt(values.length), BigInt(eligible.length || 1)), provenance: 'OBSERVED' as const, observationRefs: utf8Sort([...eligible.map(ref), ...set.judgeEvaluations.map(ref)]) } }
function utf8Sort(values: readonly string[]): string[] { return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))) }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }; return value }
