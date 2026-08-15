import { describe, expect, it } from 'vitest'
import { aggregateReliabilityObservations, classifyReliabilityObservations, createChapterStageExchangeabilityAuthorities, createFixtureTopologyAuthority } from '../../lib/narrative-qa/reliability'
import { addSuccessfulCompleteNovel, validSet } from './m10-e-reliability-measurements.test'

function repeatedStageSet(profile: 'CONTRACT_FIXTURE' | 'RELEASE_EVIDENCE', count: number) {
  const set = validSet()
  set.executionProfile = profile
  set.exchangeabilityAuthorities = createChapterStageExchangeabilityAuthorities(profile, set.compatibleStratum)
  if (profile === 'RELEASE_EVIDENCE') {
    set.declaredApplicableCells = Array.from({ length: 50 }, (_, chapter) => set.exchangeabilityAuthorities.map(({ stageId }) => ({ chapterNumber: chapter + 1, stageId }))).flat()
  }
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
  set.chapterExecutions[0]!.generationCost = { state: 'PRESENT', value: `${count}.00000000` }
  set.novelExecutions[0]!.generationCost = { state: 'PRESENT', value: `${count}.00000000` }
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
    for (let index = 0; index < count; index += 1) addSuccessfulCompleteNovel(set, `release_${index}`)
    expect(aggregateReliabilityObservations(set).profileCompleteness.completeNovels).toMatchObject({ minimum: 10, observed: count, complete: expected })
  })

  it('rejects duplicate, extra, missing, and impossible fixture cells against exact fixture topology authority', () => {
    for (const mutate of [
      (set: ReturnType<typeof validSet>) => { set.declaredApplicableCells.push(set.declaredApplicableCells[0]!) },
      (set: ReturnType<typeof validSet>) => { set.declaredApplicableCells.push({ chapterNumber: 1, stageId: 'PROSE_RETRY' }) },
      (set: ReturnType<typeof validSet>) => { set.declaredApplicableCells = [] },
      (set: ReturnType<typeof validSet>) => { set.fixtureTopologyAuthority = createFixtureTopologyAuthority([{ chapterNumber: 1, stageId: 'PROSE_RETRY' }]) },
    ]) {
      const set = structuredClone(validSet())
      mutate(set)
      expect(() => aggregateReliabilityObservations(set)).toThrow()
    }
  })

  it('requires release declaration to contain exact 50 by applicable stage cells', () => {
    const set = repeatedStageSet('RELEASE_EVIDENCE', 30)
    set.declaredApplicableCells = set.declaredApplicableCells.slice(1)
    expect(() => aggregateReliabilityObservations(set)).toThrow(/release applicable cells/i)
  })

  it('does not repair empty observed pool with exchangeability authority or forge observation refs', () => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', 0))
    const probability = aggregate.centralStageFailureProbabilities.find((metric) => metric.stageId === 'PROSE_PRIMARY')!
    expect(probability.failureProbability.provenance).toBe('OBSERVED')
    expect(probability.failureProbability.value.state).toBe('MISSING')
    expect(probability.denominator).toBe(0)
    expect(probability.observationRefs).toEqual([])
    expect(probability.failureProbability.observationRefs).toEqual([])
    expect(probability.counts).toEqual({ includedCount: 0, excludedCount: 0, unavailableCount: 0, eligibleCount: 0 })
  })

  it('classifies coverage deficiency HOLD with deterministic reason codes', () => {
    const incomplete = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', 0)).profileCompleteness
    expect(incomplete.engineeringGate).toBe('HOLD')
    expect(incomplete.reasonCodes).toEqual(['STAGE_POOL_THRESHOLD_NOT_MET', 'APPLICABLE_CELL_COVERAGE_INCOMPLETE'])
  })

  it('classifies malformed authority FAIL without converting coverage HOLD', () => {
    const malformed = repeatedStageSet('CONTRACT_FIXTURE', 1)
    malformed.exchangeabilityAuthorities = malformed.exchangeabilityAuthorities.slice(1)
    expect(classifyReliabilityObservations(malformed)).toMatchObject({ engineeringGate: 'FAIL', reasonCodes: ['MALFORMED_EVIDENCE'] })
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
