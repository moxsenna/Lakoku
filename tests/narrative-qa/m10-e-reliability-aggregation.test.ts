import { describe, expect, it } from 'vitest'
import { aggregateReliabilityObservations } from '../../lib/narrative-qa/reliability'
import { validSet } from './m10-e-reliability-measurements.test'

function addFailedStage(set: ReturnType<typeof validSet>, chapterNumber: number, suffix: string) {
  const stage = structuredClone(set.stageOutcomes[0]!)
  Object.assign(stage, { observationId: `stage_${suffix}`, stageExecutionAlias: `stage_${suffix}`, chapterExecutionAlias: `chapter_${suffix}`, chapterNumber, outcome: 'FAILURE', providerCallAlias: `call_${suffix}` })
  const call = structuredClone(set.providerCalls[0]!)
  Object.assign(call, { observationId: `call_${suffix}`, callAlias: `call_${suffix}`, stageExecutionAlias: `stage_${suffix}`, chapterExecutionAlias: `chapter_${suffix}`, chapterNumber, outcome: 'FAILURE' })
  call.logicalUnitAlias = `unit_${suffix}`
  const unit = structuredClone(set.logicalGenerationUnits[0]!)
  Object.assign(unit, { observationId: `unit_${suffix}`, logicalUnitAlias: `unit_${suffix}`, chapterExecutionAlias: `chapter_${suffix}`, chapterNumber, terminalOutcome: 'FAILURE' })
  set.stageOutcomes.push(stage)
  set.providerCalls.push(call)
  set.logicalGenerationUnits.push(unit)
  set.declaredApplicableCells.push({ chapterNumber, stageId: 'PROSE_PRIMARY' })
}

describe('M10-E deterministic aggregation', () => {
  it('pools observed reached failures by stageId and keeps per-cell diagnostics separate', () => {
    const set = validSet()
    addFailedStage(set, 2, 'two')
    addFailedStage(set, 2, 'three')
    const aggregate = aggregateReliabilityObservations(set)
    const central = aggregate.centralStageFailureProbabilities.find((metric) => metric.stageId === 'PROSE_PRIMARY')!
    expect(central.probabilityKey).toBe('stageId')
    expect(central.failureProbability).toMatchObject({ provenance: 'OBSERVED', value: { state: 'PRESENT', value: '0.666666666667' } })
    expect(central.numerator).toBe(2)
    expect(central.denominator).toBe(3)
    expect(central.exchangeabilityAuthority.stageId).toBe('PROSE_PRIMARY')
    expect(aggregate.chapterStageDiagnostics.filter((metric) => metric.stageId === 'PROSE_PRIMARY')).toEqual(expect.arrayContaining([
      expect.objectContaining({ chapterNumber: 1, numerator: 0, denominator: 1 }),
      expect.objectContaining({ chapterNumber: 2, numerator: 2, denominator: 2 }),
    ]))
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

  it('computes observed max of per-chapter means and successful-complete conditional novel mean', () => {
    const set = validSet()
    set.chapterExecutions.push(
      { ...structuredClone(set.chapterExecutions[0]!), observationId: 'chapter_1b', chapterExecutionAlias: 'chapter_1b', generationCost: { state: 'PRESENT', value: '3.00000000' } },
      { ...structuredClone(set.chapterExecutions[0]!), observationId: 'chapter_2', chapterExecutionAlias: 'chapter_2', chapterNumber: 2, generationCost: { state: 'PRESENT', value: '5.00000000' } },
    )
    const successful = structuredClone(set.novelExecutions[0]!)
    Object.assign(successful, { observationId: 'novel_success', novelExecutionAlias: 'novel_success', terminalOutcome: 'SUCCESS', completedChapterNumbers: Array.from({ length: 50 }, (_, i) => i + 1), generationCost: { state: 'PRESENT', value: '100.00000000' } })
    set.novelExecutions.push(successful)
    const aggregate = aggregateReliabilityObservations(set)
    expect(aggregate.observedCostComparators.maxObservedMeanGenerationCostPerChapter.value).toEqual({ state: 'PRESENT', value: '5.00000000' })
    expect(aggregate.observedCostComparators.meanGenerationCostPerSuccessfulCompleteNovel.value).toEqual({ state: 'PRESENT', value: '100.00000000' })
    expect(aggregate.observedCostDiagnostics.meanGenerationSpendPerStartedNovelAttempt.value).toEqual({ state: 'PRESENT', value: '50.50000000' })
    expect(aggregate.observedCostDiagnostics.meanGenerationSpendPerStartedNovelAttempt.comparatorEligible).toBe(false)
  })

  it('excludes and counts incomplete samples instead of treating them as zero', () => {
    const set = validSet()
    Object.assign(set.chapterExecutions[0]!, { generationCost: { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'absent' } })
    const metric = aggregateReliabilityObservations(set).observedCostComparators.maxObservedMeanGenerationCostPerChapter
    expect(metric.value.state).toBe('MISSING')
    expect(metric.counts).toEqual({ includedCount: 0, excludedCount: 1, eligibleCount: 1 })
  })
})
