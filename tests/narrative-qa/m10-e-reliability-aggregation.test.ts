import { describe, expect, it } from 'vitest'
import { aggregateReliabilityObservations } from '../../lib/narrative-qa/reliability'
import { addSuccessfulCompleteNovel, validSet } from './m10-e-reliability-measurements.test'

describe('M10-E deterministic aggregation', () => {
  it('pools observed reached outcomes by stageId and keeps full per-cell evidence separate', () => {
    const aggregate = aggregateReliabilityObservations(validSet())
    const central = aggregate.centralStageFailureProbabilities.find((metric) => metric.stageId === 'PROSE_PRIMARY')!
    expect(central).toMatchObject({ probabilityKey: 'stageId', numerator: 0, denominator: 1, failureProbability: { provenance: 'OBSERVED', value: { state: 'PRESENT', value: '0.000000000000' } } })
    expect(central.exchangeabilityAuthority.stageId).toBe('PROSE_PRIMARY')
    expect(aggregate.chapterStageDiagnostics.find((metric) => metric.stageId === 'PROSE_PRIMARY')).toMatchObject({
      chapterNumber: 1, numerator: 0, denominator: 1, provenance: 'OBSERVED', counts: { includedCount: 1, unavailableCount: 0, eligibleCount: 1 },
      coverageRatio: '1.000000000000', providerModelPolicyId: 'provider_v1', sourceRefs: ['fixture.telemetry'],
    })
  })

  it('puts boundary, counts, coverage, provenance, and refs on every required metric', () => {
    const aggregate = aggregateReliabilityObservations(validSet())
    expect(aggregate.requiredMetrics.map((metric) => metric.metricId)).toEqual(expect.arrayContaining([
      'FIRST_ATTEMPT_SUCCESS_RATE', 'RETRY_SUCCESS_RATE', 'TERMINAL_FAILURE_RATE', 'CHECKPOINT_REUSE_RATE',
      'PROSE_REGENERATION_ON_CHOICE_RETRY_RATE', 'OWNERSHIP_LOSS_RECOVERY_RATE', 'RECOVERY_SUCCESS_RATE',
      'PROVIDER_FALLBACK_RATE', 'FULL_NOVEL_COMPLETION_RATE', 'RETRY_COUNT', 'GENERATION_PROVIDER_CALL_COUNT',
      'JUDGE_PROVIDER_CALL_COUNT', 'TOTAL_PROVIDER_CALL_COUNT', 'DUPLICATE_PUBLICATION_COUNT',
      'CANONICAL_CORRUPTION_COUNT', 'GENERATION_LATENCY_P50', 'GENERATION_LATENCY_P95', 'RECOVERY_LATENCY_P50',
      'RECOVERY_LATENCY_P95', 'INPUT_TOKEN_USAGE', 'OUTPUT_TOKEN_USAGE', 'TOTAL_TOKEN_USAGE',
      'ACTUAL_PROVIDER_COST', 'PRICING_ESTIMATED_COST', 'ACTUAL_COST_COVERAGE_RATIO', 'PRICING_COST_COVERAGE_RATIO',
      'EMPIRICAL_CHAPTER_STAGE_FAILURE_DISTRIBUTION', 'OBSERVED_COMPLETED_NOVEL_COUNT', 'FIRST_ATTEMPT_BASELINE_COST',
      'RETRY_FALLBACK_COST', 'RETRY_OVERHEAD_PERCENTAGE', 'CHAPTER_COST_P50', 'CHAPTER_COST_P95', 'JUDGE_EVALUATION_COST',
    ]))
    for (const metric of aggregate.requiredMetrics) {
      expect(metric.eligibilityBoundary.length).toBeGreaterThan(0)
      expect(metric.counts.eligibleCount).toBe(metric.counts.includedCount + metric.counts.excludedCount)
      expect(metric.coverageRatio).toMatch(/^\d+\.\d{12}$/)
      expect(metric.provenance).toMatch(/^(OBSERVED|MODELED_FROM_PRICING)$/)
      expect(Array.isArray(metric.observationRefs)).toBe(true)
      expect('value' in metric || 'numerator' in metric).toBe(true)
      expect('denominator' in metric).toBe(true)
    }
  })

  it('uses exact attempt-1 outcome from topology-valid observations', () => {
    const metric = aggregateReliabilityObservations(validSet()).requiredMetrics.find((item) => item.metricId === 'FIRST_ATTEMPT_SUCCESS_RATE')!
    expect(metric.numerator).toBe(2)
    expect(metric.denominator).toBe(2)
  })

  it('emits task/chapter/novel, cost-source, and provider-policy audit dimensions', () => {
    const rollups = aggregateReliabilityObservations(validSet()).dimensionedMetrics
    expect(rollups).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'TASK', taskId: 'CHAPTER_PROSE', metricId: 'TOTAL_TOKEN_USAGE' }),
      expect.objectContaining({ scope: 'CHAPTER', chapterNumber: 1, metricId: 'ACTUAL_PROVIDER_COST' }),
      expect.objectContaining({ scope: 'NOVEL_EXECUTION', dimensionKey: 'NOVEL_EXECUTION.novel_a', metricId: 'PRICING_ESTIMATED_COST' }),
      expect.objectContaining({ scope: 'SOURCE', dimensionKey: 'SOURCE.fixture.telemetry', metricId: 'ACTUAL_COST_COVERAGE_RATIO' }),
      expect.objectContaining({ scope: 'PROVIDER_MODEL_POLICY', dimensionKey: 'PROVIDER_MODEL_POLICY.provider_v1', metricId: 'PRICING_COST_COVERAGE_RATIO' }),
      expect.objectContaining({ providerModelPolicyId: 'provider_v1', actualCostSource: 'PROVIDER_REPORTED' }),
      expect.objectContaining({ scope: 'TASK', taskId: 'CHAPTER_PROSE', metricId: 'GENERATION_PROVIDER_CALL_COUNT' }),
    ]))
    expect(new Set(rollups.map((metric) => metric.dimensionKey))).toEqual(new Set([
      'TASK.CHAPTER_PROSE', 'TASK.CHAPTER_STRUCTURED_OUTPUT', 'TASK.RUNTIME_RECOVERY', 'NOVEL_EXECUTION.novel_a', 'SOURCE.fixture.telemetry', 'PROVIDER_MODEL_POLICY.provider_v1',
      ...Array.from({ length: 50 }, (_, index) => `CHAPTER.${String(index + 1).padStart(2, '0')}`),
    ]))
    expect(rollups).toContainEqual(expect.objectContaining({ dimensionKey: 'TASK.RUNTIME_RECOVERY', metricId: 'RETRY_COUNT' }))
    for (const metric of rollups) {
      expect(metric.counts.eligibleCount).toBe(metric.counts.includedCount + metric.counts.excludedCount)
      expect(metric.eligibilityBoundary).not.toBe('')
      expect(metric.observationRefs).toBeDefined()
    }
  })

  it('locks exact canonical E.3 applicability-matrix key set', () => {
    const aggregate = aggregateReliabilityObservations(validSet())
    const expectedDimensionKeys = [
      'TASK.CHAPTER_PROSE', 'TASK.CHAPTER_STRUCTURED_OUTPUT', 'TASK.RUNTIME_RECOVERY',
      ...Array.from({ length: 50 }, (_, index) => `CHAPTER.${String(index + 1).padStart(2, '0')}`),
      'NOVEL_EXECUTION.novel_a', 'SOURCE.fixture.telemetry', 'PROVIDER_MODEL_POLICY.provider_v1',
    ]
    const directMetricIds = ['RETRY_COUNT', 'GENERATION_PROVIDER_CALL_COUNT', 'INPUT_TOKEN_USAGE', 'OUTPUT_TOKEN_USAGE', 'TOTAL_TOKEN_USAGE', 'ACTUAL_PROVIDER_COST', 'PRICING_ESTIMATED_COST', 'ACTUAL_COST_COVERAGE_RATIO', 'PRICING_COST_COVERAGE_RATIO']
    const expectedMetricIds = [...directMetricIds, ...new Set(aggregate.requiredMetrics.map((metric) => metric.metricId).filter((metric) => !directMetricIds.includes(metric)))]
    expect(aggregate.dimensionedMetrics.map((record) => `${record.dimensionKey}|${record.metricId}`)).toEqual(expectedDimensionKeys.flatMap((key) => expectedMetricIds.map((metric) => `${key}|${metric}`)))
    expect(Object.keys(aggregate.chapterStageDiagnostics[0]!).sort()).toEqual([
      'chapterNumber', 'compatibleStratum', 'counts', 'coverageRatio', 'denominator', 'eligibilityBoundary', 'executionProfile', 'failureProbability',
      'numerator', 'observationRefs', 'provenance', 'providerModelPolicyId', 'sourceAuthorityHash', 'sourceRefs', 'stageId',
    ].sort())
  })

  it('emits all chapter percentiles separately and leaves P5 modeled pricing slots missing', () => {
    const aggregate = aggregateReliabilityObservations(validSet())
    expect(aggregate.requiredMetrics.filter((metric) => metric.metricId === 'CHAPTER_COST_P50')).toHaveLength(50)
    expect(aggregate.requiredMetrics.filter((metric) => metric.metricId === 'CHAPTER_COST_P95')).toHaveLength(50)
    expect(aggregate.requiredMetrics.find((metric) => metric.metricId === 'FIRST_ATTEMPT_BASELINE_COST')).toMatchObject({ provenance: 'MODELED_FROM_PRICING', value: { state: 'MISSING' } })
    expect(aggregate.modeledPricingSlots.expectedChapterGenerationMeans).toHaveLength(50)
    expect(aggregate.modeledPricingSlots.modeledJudgeTotal.value.state).toBe('MISSING')
    expect(aggregate.observedCostDiagnostics.observedBaselineCost).toMatchObject({ provenance: 'OBSERVED', value: { state: 'PRESENT', value: '2.00000000' } })
  })

  it('marks complete token/cost aggregate missing on partial coverage and exposes partial sum separately', () => {
    const set = validSet()
    Object.assign(set.providerCalls[0]!, { actualCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'absent' }, totalTokens: { state: 'MISSING', reasonCode: 'TELEMETRY_UNAVAILABLE', detail: 'absent' } })
    Object.assign(set.chapterExecutions[0]!, { generationCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'partial coverage' } })
    Object.assign(set.novelExecutions[0]!, { generationCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'partial coverage' } })
    const aggregate = aggregateReliabilityObservations(set)
    const cost = aggregate.requiredMetrics.find((item) => item.metricId === 'ACTUAL_PROVIDER_COST')!
    expect(cost.value.state).toBe('MISSING')
    expect(cost.partialObservedValue).toEqual({ state: 'PRESENT', value: '1.00000000' })
    expect(cost.counts).toEqual({ includedCount: 1, excludedCount: 1, eligibleCount: 2 })
  })

  it('computes observed max of per-chapter means and successful-complete conditional novel mean', () => {
    const set = validSet()
    addSuccessfulCompleteNovel(set, 'success')
    const aggregate = aggregateReliabilityObservations(set)
    expect(aggregate.observedCostComparators.maxObservedMeanGenerationCostPerChapter.value).toEqual({ state: 'PRESENT', value: '2.00000000' })
    expect(aggregate.observedCostComparators.maxObservedMeanGenerationCostPerChapter.chapterMeanCounts).toEqual({ includedCount: 50, excludedCount: 0, eligibleCount: 50 })
    expect(aggregate.observedCostComparators.meanGenerationCostPerSuccessfulCompleteNovel.value).toEqual({ state: 'PRESENT', value: '100.00000000' })
    expect(aggregate.observedCostDiagnostics.meanGenerationSpendPerStartedNovelAttempt.value).toEqual({ state: 'PRESENT', value: '51.00000000' })
    expect(aggregate.observedCostDiagnostics.meanGenerationSpendPerStartedNovelAttempt.comparatorEligible).toBe(false)
  })

  it('excludes and counts incomplete samples instead of treating them as zero', () => {
    const set = validSet()
    Object.assign(set.providerCalls[0]!, { actualCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'absent' } })
    Object.assign(set.chapterExecutions[0]!, { generationCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'absent' } })
    Object.assign(set.novelExecutions[0]!, { generationCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'absent' } })
    const metric = aggregateReliabilityObservations(set).observedCostComparators.maxObservedMeanGenerationCostPerChapter
    expect(metric.value.state).toBe('MISSING')
    expect(metric.counts).toEqual({ includedCount: 0, excludedCount: 1, eligibleCount: 1 })
  })
})
