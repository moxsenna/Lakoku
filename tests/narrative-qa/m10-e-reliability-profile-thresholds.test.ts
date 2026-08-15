import { describe, expect, it } from 'vitest'
import { aggregateReliabilityObservations, createChapterStageExchangeabilityAuthorities } from '../../lib/narrative-qa/reliability'
import { validSet } from './m10-e-reliability-measurements.test'

function repeatedStageSet(profile: 'CONTRACT_FIXTURE' | 'RELEASE_EVIDENCE', count: number) {
  const set = validSet()
  set.executionProfile = profile
  set.exchangeabilityAuthorities = createChapterStageExchangeabilityAuthorities(profile, set.compatibleStratum)
  set.stageOutcomes = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(set.stageOutcomes[0]!), observationId: `stage_${index}`, stageExecutionAlias: `stage_${index}`,
    providerCallAlias: `call_${index}`, outcome: index === 0 ? 'FAILURE' as const : 'SUCCESS' as const,
  }))
  set.providerCalls = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(set.providerCalls[0]!), observationId: `call_${index}`, callAlias: `call_${index}`,
    stageExecutionAlias: `stage_${index}`, logicalUnitAlias: `unit_${index}`, outcome: index === 0 ? 'FAILURE' as const : 'SUCCESS' as const,
  }))
  set.logicalGenerationUnits = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(set.logicalGenerationUnits[0]!), observationId: `unit_${index}`, logicalUnitAlias: `unit_${index}`,
    terminalOutcome: index === 0 ? 'FAILURE' as const : 'SUCCESS' as const,
  }))
  return set
}

describe('M10-E profile completeness thresholds', () => {
  it.each([[0, false], [1, true]] as const)('fixture stage pool %i completeness is %s', (count, expected) => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', count))
    expect(aggregate.profileCompleteness.stagePools.find((pool) => pool.stageId === 'PROSE_PRIMARY')?.complete).toBe(expected)
  })

  it.each([[29, false], [30, true], [31, true]] as const)('release stage pool %i completeness is %s', (count, expected) => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('RELEASE_EVIDENCE', count))
    expect(aggregate.profileCompleteness.stagePools.find((pool) => pool.stageId === 'PROSE_PRIMARY')?.complete).toBe(expected)
  })

  it.each([[0, false], [1, true]] as const)('applicable cell %i completeness is %s', (count, expected) => {
    const set = repeatedStageSet('CONTRACT_FIXTURE', count)
    const aggregate = aggregateReliabilityObservations(set)
    expect(aggregate.profileCompleteness.applicableCells[0]?.complete).toBe(expected)
  })

  it.each([[9, false], [10, true], [11, true]] as const)('release complete novel count %i completeness is %s', (count, expected) => {
    const set = repeatedStageSet('RELEASE_EVIDENCE', 30)
    set.novelExecutions = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(set.novelExecutions[0]!), observationId: `novel_${index}`, novelExecutionAlias: `novel_${index}`,
      terminalOutcome: 'SUCCESS' as const, completedChapterNumbers: Array.from({ length: 50 }, (_value, chapter) => chapter + 1),
    }))
    expect(aggregateReliabilityObservations(set).profileCompleteness.completeNovels).toMatchObject({ minimum: 10, observed: count, complete: expected })
  })

  it('does not repair empty observed pool with exchangeability authority', () => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', 0))
    const probability = aggregate.centralStageFailureProbabilities.find((metric) => metric.stageId === 'PROSE_PRIMARY')!
    expect(probability.failureProbability.provenance).toBe('OBSERVED')
    expect(probability.failureProbability.value.state).toBe('MISSING')
    expect(probability.denominator).toBe(0)
  })

  it('rejects missing, malformed, or incompatible exchangeability rather than holding', () => {
    const missing = repeatedStageSet('CONTRACT_FIXTURE', 1)
    missing.exchangeabilityAuthorities = missing.exchangeabilityAuthorities.slice(1)
    expect(() => aggregateReliabilityObservations(missing)).toThrow()

    const incompatible = repeatedStageSet('CONTRACT_FIXTURE', 1)
    incompatible.exchangeabilityAuthorities = structuredClone(incompatible.exchangeabilityAuthorities)
    incompatible.exchangeabilityAuthorities[0]!.compatibleStratum.providerModelPolicyId = 'other'
    expect(() => aggregateReliabilityObservations(incompatible)).toThrow()
  })
})
