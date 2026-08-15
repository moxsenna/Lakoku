import { describe, expect, it } from 'vitest'
import { SEMANTIC_RUBRIC_IDS } from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import {
  GENERATION_COST_KEY_SCHEMA,
  assertCompleteRequiredCoverage,
  computeCostDistributionHash,
  createPricingSnapshot,
  formatCostDistributionKey,
  generationCostKey,
  getAllGenerationCostKeys,
  getAllJudgeCostKeys,
  judgeCostKey,
  missingRequiredCostKeys,
  modeledPricingCostEntry,
  observedCostEntry,
  sampleCostFromDistribution,
  selectCostDistribution,
  sortCostDistributionEntries,
  type CostDistributionKey,
  type ModeledPricingCostEntry,
  type ObservedCostEntry,
} from '../../lib/narrative-qa/reliability'

function snapshot(currency = 'IDR') {
  return createPricingSnapshot({
    pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
    providerId: 'provider_alpha',
    exactModelId: 'model-text-1',
    currency,
    inputPricePerUnit: '2.00000000',
    outputPricePerUnit: '10.00000000',
    unitSize: 1000000,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: '2026-12-31T23:59:59.000Z',
  })
}

function keyOf(key: CostDistributionKey): string {
  return formatCostDistributionKey(key)
}

describe('M10-E generation cost distribution coverage', () => {
  it('covers exactly 250 generation provider-node keys across chapters 1..50', () => {
    const keys = getAllGenerationCostKeys('policy_x')
    expect(keys.length).toBe(250)
    const formatted = new Set(keys.map(keyOf))
    expect(formatted.size).toBe(250)
    for (const key of keys) {
      expect(key.kind).toBe('GENERATION')
      expect(key.providerModelPolicyId).toBe('policy_x')
    }
    const chapterNumbers = new Set(keys.map((key) => key.chapterNumber))
    expect(chapterNumbers.size).toBe(50)
    expect(Math.min(...chapterNumbers)).toBe(1)
    expect(Math.max(...chapterNumbers)).toBe(50)
  })

  it('binds each stage to the frozen task and attempt class', () => {
    const keys = getAllGenerationCostKeys('policy_x')
    const expected = {
      PROSE_PRIMARY: ['CHAPTER_PROSE', 'PRIMARY'],
      PROSE_RETRY: ['CHAPTER_PROSE', 'RETRY'],
      PROVIDER_FALLBACK: ['CHAPTER_PROSE', 'FALLBACK'],
      STRUCTURED_OUTPUT: ['CHAPTER_STRUCTURED_OUTPUT', 'PRIMARY'],
      STRUCTURED_RETRY: ['CHAPTER_STRUCTURED_OUTPUT', 'RETRY'],
    } as const
    for (const key of keys) {
      expect([key.taskId, key.attemptClass]).toEqual(expected[key.stageId])
    }
  })

  it('exposes exactly 24 judge keys from the ordered judge plan', () => {
    const keys = getAllJudgeCostKeys('policy_x')
    expect(keys.length).toBe(24)
    const formatted = new Set(keys.map(keyOf))
    expect(formatted.size).toBe(24)
    const expectedOrder: string[] = []
    for (const judgeTaskId of SEMANTIC_RUBRIC_IDS) {
      for (const evaluationIndex of [0, 1, 2]) {
        expectedOrder.push(`JUDGE:${judgeTaskId}:${evaluationIndex}:policy_x`)
      }
    }
    expect(keys.map(keyOf)).toEqual(expectedOrder)
    for (const key of keys) {
      expect(key.providerModelPolicyId).toBe('policy_x')
    }
  })

  it('rejects wrong task or attempt class for a stage', () => {
    expect(() => generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: 'CHAPTER_STRUCTURED_OUTPUT',
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'policy_x',
    })).toThrow()
    expect(() => generationCostKey({
      chapterNumber: 1,
      stageId: 'STRUCTURED_OUTPUT',
      taskId: 'CHAPTER_STRUCTURED_OUTPUT',
      attemptClass: 'FALLBACK',
      providerModelPolicyId: 'policy_x',
    })).toThrow()
    expect(() => GENERATION_COST_KEY_SCHEMA.parse({
      kind: 'GENERATION',
      chapterNumber: 1,
      stageId: 'CHECKPOINT_RECOVERY',
      taskId: 'RUNTIME_RECOVERY',
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'policy_x',
    })).toThrow()
  })

  it('reports missing required keys and rejects extra runtime keys', () => {
    const required = getAllGenerationCostKeys('policy_x')
    const provided = new Set(required.map(keyOf))
    expect(missingRequiredCostKeys(required, provided)).toEqual([])
    expect(() => assertCompleteRequiredCoverage(required, provided, 'GENERATION')).not.toThrow()

    const firstKey = keyOf(required[0])
    provided.delete(firstKey)
    const missing = missingRequiredCostKeys(required, provided)
    expect(missing).toEqual([firstKey])
    expect(() => assertCompleteRequiredCoverage(required, provided, 'GENERATION')).toThrow(/incomplete/i)

    // Runtime stages can never become generation cost keys.
    expect(() => generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: 'RUNTIME_RECOVERY',
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'policy_x',
    })).toThrow()
  })
})

describe('M10-E cost distribution selection', () => {
  const genKey = generationCostKey({
    chapterNumber: 12,
    stageId: 'PROSE_PRIMARY',
    taskId: 'CHAPTER_PROSE',
    attemptClass: 'PRIMARY',
    providerModelPolicyId: 'policy_x',
  })

  it('selects complete observed empirical distributions before pricing fallback', () => {
    const empirical = {
      availability: 'AVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>([[keyOf(genKey), [
        observedCostEntry('4.00000000', 'obs-4'),
        observedCostEntry('2.00000000', 'obs-2'),
      ]]]),
    }
    const pricing = {
      pricingSnapshot: snapshot(),
      distributions: new Map<string, readonly ModeledPricingCostEntry[]>([[keyOf(genKey), [
        modeledPricingCostEntry('9.00000000', snapshot().canonicalHash, 'price-9'),
      ]]]),
    }
    const result = selectCostDistribution(genKey, 'IDR', empirical, pricing)
    expect(result.status).toBe('SELECTED')
    if (result.status !== 'SELECTED') return
    expect(result.distribution.provenance).toBe('OBSERVED')
    expect(result.distribution.currency).toBe('IDR')
    expect(result.distribution.entries.map((entry) => entry.cost)).toEqual(['2.00000000', '4.00000000'])
    expect(result.distribution.entries.every((entry) => entry.provenance === 'OBSERVED')).toBe(true)
  })

  it('selects pricing fallback only after explicit empirical-unavailable state', () => {
    const empiricalUnavailable = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    const snapshotAuthority = snapshot()
    const pricing = {
      pricingSnapshot: snapshotAuthority,
      distributions: new Map([[keyOf(genKey), [
        modeledPricingCostEntry('7.00000000', snapshotAuthority.canonicalHash, 'price-7'),
      ]]]),
    }
    const result = selectCostDistribution(genKey, 'IDR', empiricalUnavailable, pricing)
    expect(result.status).toBe('SELECTED')
    if (result.status !== 'SELECTED') return
    expect(result.distribution.provenance).toBe('MODELED_FROM_PRICING')
    expect(result.distribution.entries[0].cost).toBe('7.00000000')
    if (result.distribution.entries[0].provenance !== 'MODELED_FROM_PRICING') return
    expect(result.distribution.entries[0].pricingSnapshotHash).toBe(snapshotAuthority.canonicalHash)
  })

  it('yields HOLD when neither empirical nor pricing source exists', () => {
    const unavailable = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    expect(selectCostDistribution(genKey, 'IDR', unavailable).status).toBe('HOLD')
  })

  it('does not let incomplete empirical evidence be bypassed without explicit unavailable classification', () => {
    const incomplete = {
      availability: 'AVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    const snapshotAuthority = snapshot()
    const pricing = {
      pricingSnapshot: snapshotAuthority,
      distributions: new Map([[keyOf(genKey), [
        modeledPricingCostEntry('7.00000000', snapshotAuthority.canonicalHash, 'price-7'),
      ]]]),
    }
    const result = selectCostDistribution(genKey, 'IDR', incomplete, pricing)
    expect(result.status).toBe('HOLD')
    if (result.status === 'SELECTED') return
    expect(result.reason).toMatch(/Incomplete empirical evidence/)
  })

  it('rejects empty empirical and pricing distributions', () => {
    const emptyEmpirical = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    const snapshotAuthority = snapshot()
    const emptyPricing = {
      pricingSnapshot: snapshotAuthority,
      distributions: new Map<string, readonly ModeledPricingCostEntry[]>(),
    }
    expect(selectCostDistribution(genKey, 'IDR', emptyEmpirical, emptyPricing).status).toBe('HOLD')
  })

  it('rejects mixed provenance inside one empirical distribution', () => {
    const poisoned = {
      availability: 'AVAILABLE' as const,
      distributions: new Map([[keyOf(genKey), [
        observedCostEntry('2.00000000', 'obs-2'),
        modeledPricingCostEntry('9.00000000', snapshot().canonicalHash, 'price-9'),
      ] as unknown as readonly ObservedCostEntry[],
    ]]),
    }
    const result = selectCostDistribution(genKey, 'IDR', poisoned)
    expect(result.status).toBe('HOLD')
  })

  it('rejects pricing fallback bound to a mismatched snapshot hash', () => {
    const unavailable = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    const otherHash = 'a'.repeat(64)
    const pricing = {
      pricingSnapshot: snapshot(),
      distributions: new Map([[keyOf(genKey), [
        modeledPricingCostEntry('7.00000000', otherHash, 'price-7'),
      ]]]),
    }
    const result = selectCostDistribution(genKey, 'IDR', unavailable, pricing)
    expect(result.status).toBe('HOLD')
    if (result.status === 'SELECTED') return
    expect(result.reason).toMatch(/snapshot hash mismatch/i)
  })

  it('rejects mixed currency instead of converting', () => {
    const unavailable = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    const pricing = {
      pricingSnapshot: snapshot('USD'),
      distributions: new Map([[keyOf(genKey), [
        modeledPricingCostEntry('7.00000000', snapshot('USD').canonicalHash, 'price-7'),
      ]]]),
    }
    const result = selectCostDistribution(genKey, 'IDR', unavailable, pricing)
    expect(result.status).toBe('HOLD')
    if (result.status === 'SELECTED') return
    expect(result.reason).toMatch(/currency mismatch/i)
  })

  it('does not select pricing fallback for a policy stratum it is not bound to', () => {
    const unavailable = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map<string, readonly ObservedCostEntry[]>(),
    }
    const otherKey = generationCostKey({
      chapterNumber: 12,
      stageId: 'PROSE_PRIMARY',
      taskId: 'CHAPTER_PROSE',
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'policy_y',
    })
    const snapshotAuthority = snapshot()
    const pricing = {
      pricingSnapshot: snapshotAuthority,
      distributions: new Map([[keyOf(otherKey), [
        modeledPricingCostEntry('7.00000000', snapshotAuthority.canonicalHash, 'price-7'),
      ]]]),
    }
    expect(selectCostDistribution(genKey, 'IDR', unavailable, pricing).status).toBe('HOLD')
  })
})

describe('M10-E cost distribution sampling', () => {
  it('sorts entries by numeric money value then observation ID UTF-8 bytes', () => {
    const entries = [
      observedCostEntry('10.00000000', 'obs-b'),
      observedCostEntry('2.00000000', 'obs-a'),
      observedCostEntry('10.00000000', 'obs-a'),
    ]
    const sorted = sortCostDistributionEntries(entries)
    expect(sorted.map((entry) => entry.cost)).toEqual(['2.00000000', '10.00000000', '10.00000000'])
    expect(sorted.map((entry) => entry.observationId)).toEqual(['obs-a', 'obs-a', 'obs-b'])
  })

  it('samples inverse CDF first, last, and boundary indexes', () => {
    const make = (entries: readonly ObservedCostEntry[]) => ({
      key: genKey(),
      provenance: 'OBSERVED' as const,
      currency: 'IDR',
      entries,
      canonicalHash: computeCostDistributionHash(genKey(), 'OBSERVED', 'IDR', entries),
    })
    const two = make([observedCostEntry('1.00000000', 'obs-1'), observedCostEntry('5.00000000', 'obs-5')])
    expect(sampleCostFromDistribution(two, 0)).toBe('1.00000000')
    expect(sampleCostFromDistribution(two, 2147483648)).toBe('5.00000000')
    expect(sampleCostFromDistribution(two, 4294967295)).toBe('5.00000000')
    const three = make([
      observedCostEntry('1.00000000', 'obs-1'),
      observedCostEntry('2.00000000', 'obs-2'),
      observedCostEntry('3.00000000', 'obs-3'),
    ])
    expect(sampleCostFromDistribution(three, 0)).toBe('1.00000000')
    expect(sampleCostFromDistribution(three, 4294967295)).toBe('3.00000000')
  })
})

function genKey() {
  return generationCostKey({
    chapterNumber: 12,
    stageId: 'PROSE_PRIMARY',
    taskId: 'CHAPTER_PROSE',
    attemptClass: 'PRIMARY',
    providerModelPolicyId: 'policy_x',
  })
}

describe('M10-E judge cost coverage', () => {
  it('enforces complete ordered judge key coverage', () => {
    const required = getAllJudgeCostKeys('policy_x')
    const provided = new Set(required.map(keyOf))
    expect(missingRequiredCostKeys(required, provided)).toEqual([])
    expect(() => assertCompleteRequiredCoverage(required, provided, 'JUDGE')).not.toThrow()

    provided.delete(keyOf(required[5]))
    expect(missingRequiredCostKeys(required, provided)).toEqual([keyOf(required[5])])

    const duplicate = judgeCostKey({ judgeTaskId: SEMANTIC_RUBRIC_IDS[0], evaluationIndex: 1, providerModelPolicyId: 'policy_x' })
    const match = required.find((key) => key.evaluationIndex === 1 && key.judgeTaskId === SEMANTIC_RUBRIC_IDS[0])
    expect(match).toBeDefined()
    if (match) expect(keyOf(duplicate)).toBe(keyOf(match))
  })

  it('rejects judge key policy mismatch against the plan stratum', () => {
    const required = getAllJudgeCostKeys('policy_x')
    const provided = new Set(required.map(keyOf))
    const foreign = new Set(provided)
    const otherPlan = getAllJudgeCostKeys('policy_z')
    foreign.delete(keyOf(required[0]))
    foreign.add(keyOf(otherPlan[0]))
    expect(missingRequiredCostKeys(required, provided).length).toBe(0)
    expect(missingRequiredCostKeys(required, foreign).length).toBe(1)
  })
})