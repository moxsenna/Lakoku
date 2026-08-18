import { describe, expect, it } from 'vitest'
import {
  M10_E_CUMULATIVE_MODEL_V1,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  computeCostDistributionHash,
  createChapterStageExchangeabilityAuthorities,
  createJudgePlanAuthority,
  failureProbabilityThreshold,
  formatCostDistributionKey,
  getAllGenerationCostKeys,
  getAllJudgeCostKeys,
  missingMeasurement,
  modeledPricingCostEntry,
  observedCostEntry,
  observedValue,
  presentMeasurement,
  ratioOf,
  runCumulativeModel,
  STAGE_IDS,
  getStageSemantics,
  getStageTransition,
  type CanonicalDecimal,
  type CompatibleStratumIdentity,
  type CostDistribution,
  type CostDistributionKey,
  type CumulativeModelInput,
  type StageId,
} from '../../lib/narrative-qa/reliability'

const HASH = 'a'.repeat(64)
const POLICY = 'provider_v1'
const CURRENCY = 'IDR'
const PATH_STEP_LIMIT = 32

const stratum: CompatibleStratumIdentity = {
  retryFallbackPolicyId: 'retry_v1', retryFallbackPolicyHash: HASH,
  topologyVersion: M10_E_TOPOLOGY_V1.authorityVersion, topologyHash: M10_E_TOPOLOGY_V1.canonicalHash,
  stageCatalogVersion: M10_E_STAGE_CATALOG_V1.authorityVersion, stageCatalogHash: M10_E_STAGE_CATALOG_V1.canonicalHash,
  taskMappingVersion: M10_E_TASK_MAPPING_V1.authorityVersion, taskMappingHash: M10_E_TASK_MAPPING_V1.canonicalHash,
  providerModelPolicyId: POLICY, pricingPolicyVersion: 'pricing_v1', pricingSnapshotHash: HASH,
}

function distribution(key: CostDistributionKey, observationId: string, cost = '2.50000000', variant: 'OBSERVED' | 'MODELED_FROM_PRICING' = 'OBSERVED'): CostDistribution {
  const entry = variant === 'OBSERVED' ? observedCostEntry(cost, observationId) : modeledPricingCostEntry(cost, HASH, observationId)
  return {
    key,
    provenance: variant,
    currency: CURRENCY,
    entries: [entry],
    canonicalHash: computeCostDistributionHash(key, variant, CURRENCY, [entry]),
  }
}

function fullDistributionMap(): Map<string, CostDistribution> {
  const map = new Map<string, CostDistribution>()
  for (const key of getAllGenerationCostKeys(POLICY)) map.set(formatCostDistributionKey(key), distribution(key, `obs-gen-${key.chapterNumber}-${key.stageId}`))
  for (const key of getAllJudgeCostKeys(POLICY)) map.set(formatCostDistributionKey(key), distribution(key, `obs-judge-${key.judgeTaskId}-${key.evaluationIndex}`))
  return map
}

function buildInput(probability: string, seed: string, overrides: { distributions?: Map<string, CostDistribution> } = {}): CumulativeModelInput {
  const exchangeabilityAuthorities = createChapterStageExchangeabilityAuthorities('CONTRACT_FIXTURE', stratum)
  const centralStageProbabilities = STAGE_IDS.map((stageId) => ({ stageId, observed: observedValue(presentMeasurement(probability as CanonicalDecimal<'PROBABILITY'>), [`obs-${stageId}`]) }))
  return {
    executionProfile: 'CONTRACT_FIXTURE',
    compatibleStratum: stratum,
    centralStageProbabilities,
    exchangeabilityAuthorities,
    costDistributions: { currency: CURRENCY, distributions: overrides.distributions ?? fullDistributionMap() },
    judgePlan: createJudgePlanAuthority(POLICY, CURRENCY),
    seed,
    iterations: 100000,
  }
}

function walkPath(entry: StageId, outcome: 'SUCCESS' | 'FAILURE', stop: 'CHAPTER_COMPLETE' | 'TERMINAL_FAILURE') {
  let stageId = entry
  let stageCount = 0
  let providerCount = 0
  let retryCount = 0
  for (let step = 0; step < PATH_STEP_LIMIT; step += 1) {
    stageCount += 1
    const semantics = getStageSemantics(stageId)
    if (semantics.providerCall.state === 'APPLICABLE') providerCount += 1
    if (semantics.retryCounterEffect === 'INCREMENT') retryCount += 1
    const transition = getStageTransition(stageId, outcome)
    if (transition.chapterEffect === stop) return { stageCount, providerCount, retryCount }
    const next = transition.nextStageIds[0]
    if (next === undefined) throw new Error(`Path without ${stop} from ${stageId}`)
    stageId = next
  }
  throw new Error(`Path step limit exceeded at ${stageId}`)
}

const successPath = (() => walkPath('PROSE_PRIMARY', 'SUCCESS', 'CHAPTER_COMPLETE'))()
const failurePath = (() => walkPath('PROSE_PRIMARY', 'FAILURE', 'TERMINAL_FAILURE'))()

function expectedCount(numerator: number, denominator: number): string {
  const scale = BigInt(1000000)
  const coefficient = BigInt(numerator) * scale
  const quotient = coefficient / BigInt(denominator)
  const remainder = coefficient % BigInt(denominator)
  const rounded = remainder * BigInt(2) >= BigInt(denominator) ? quotient + BigInt(1) : quotient
  const whole = rounded / scale
  const fraction = (rounded % scale).toString().padStart(6, '0')
  return `${whole.toString()}.${fraction}`
}

function moneyScaled(wholeUnits: number): string {
  const coefficient = Math.round(wholeUnits * 100000000)
  const whole = Math.floor(coefficient / 100000000)
  const fraction = (coefficient % 100000000).toString().padStart(8, '0')
  return `${whole.toString()}.${fraction}`
}

describe('cumulative model input validation', () => {
  it('enforces exactly 100000 iterations', () => {
    const base = buildInput('0.500000000000', 's')
    expect(() => runCumulativeModel({ ...base, iterations: 99999 })).toThrow()
    expect(() => runCumulativeModel({ ...base, iterations: 100001 })).toThrow()
  })

  it('rejects assumed central probabilities', () => {
    const base = buildInput('0.500000000000', 's')
    const mutated = {
      ...base,
      centralStageProbabilities: base.centralStageProbabilities.map((item, index) => index === 0 ? { stageId: item.stageId, observed: { provenance: 'ASSUMPTION', value: '0.500000000000', source: { authorityVersion: 'M10_E_ASSUMPTION_V1', decisionRef: 'd', rationale: 'r', canonicalHash: HASH } } } : item),
    }
    expect(() => runCumulativeModel(mutated as unknown as CumulativeModelInput)).toThrow(/assumed/)
  })

  it('rejects missing central probabilities', () => {
    const base = buildInput('0.500000000000', 's')
    const mutated = {
      ...base,
      centralStageProbabilities: base.centralStageProbabilities.map((item, index) => index === 0
        ? { stageId: item.stageId, observed: observedValue(missingMeasurement<CanonicalDecimal<'PROBABILITY'>>('OBSERVATION_COVERAGE_INCOMPLETE', 'fixture missing'), [`obs-${item.stageId}`]) }
        : item),
    }
    expect(() => runCumulativeModel(mutated)).toThrow(/PRESENT/)
  })

  it('rejects per-cell duplicate and unknown stage central probabilities', () => {
    const base = buildInput('0.500000000000', 's')
    const first = base.centralStageProbabilities[0]!
    const duplicate = { ...base, centralStageProbabilities: [...base.centralStageProbabilities.slice(0, 10), first] }
    expect(() => runCumulativeModel(duplicate)).toThrow(/Duplicate/)
    const unknown = base.centralStageProbabilities.map((item) => item)
    unknown[0] = { stageId: 'FAKE_STAGE' as StageId, observed: first.observed }
    expect(() => runCumulativeModel({ ...base, centralStageProbabilities: unknown })).toThrow(/Unknown stage/)
  })

  it('rejects a partial central stage set', () => {
    const base = buildInput('0.500000000000', 's')
    expect(() => runCumulativeModel({ ...base, centralStageProbabilities: base.centralStageProbabilities.slice(0, STAGE_IDS.length - 1) })).toThrow(/one observed stage probability per stage/)
  })

  it('rejects missing exchangeability authorities and profile mismatches', () => {
    const base = buildInput('0.500000000000', 's')
    expect(() => runCumulativeModel({ ...base, exchangeabilityAuthorities: [] })).toThrow()
    const wrongProfile = createChapterStageExchangeabilityAuthorities('RELEASE_EVIDENCE', stratum)
    expect(() => runCumulativeModel({ ...base, exchangeabilityAuthorities: wrongProfile })).toThrow()
  })

  it('rejects stratum version/hash pairs that do not match the frozen catalog', () => {
    const base = buildInput('0.500000000000', 's')
    expect(() => runCumulativeModel({ ...base, compatibleStratum: { ...stratum, stageCatalogHash: 'b'.repeat(64) } })).toThrow(/stage catalog/i)
    expect(() => runCumulativeModel({ ...base, compatibleStratum: { ...stratum, topologyVersion: 'M10_E_TOPOLOGY_V2' } })).toThrow(/topology/i)
    expect(() => runCumulativeModel({ ...base, compatibleStratum: { ...stratum, taskMappingHash: 'c'.repeat(64) } })).toThrow(/task mapping/i)
  })

  it('rejects missing generation and judge cost distributions', () => {
    const base = buildInput('0.500000000000', 's')
    const generationWithoutOne = new Map(base.costDistributions.distributions)
    const generationKey = formatCostDistributionKey(getAllGenerationCostKeys(POLICY)[0]!)
    generationWithoutOne.delete(generationKey)
    expect(() => runCumulativeModel({ ...base, costDistributions: { currency: CURRENCY, distributions: generationWithoutOne } })).toThrow(/Missing generation cost distribution/)
    const judgeWithoutOne = new Map(base.costDistributions.distributions)
    judgeWithoutOne.delete(formatCostDistributionKey(getAllJudgeCostKeys(POLICY)[0]!))
    expect(() => runCumulativeModel({ ...base, costDistributions: { currency: CURRENCY, distributions: judgeWithoutOne } })).toThrow(/Missing judge cost distribution/)
  })

  it('rejects empty, pricing-fallback, and mixed-provenance distributions', () => {
    const base = buildInput('0.500000000000', 's')
    const empty = fullDistributionMap()
    const firstKey = [...empty.keys()][0]!
    empty.set(firstKey, { ...empty.get(firstKey)!, entries: [] })
    expect(() => runCumulativeModel({ ...base, costDistributions: { currency: CURRENCY, distributions: empty } })).toThrow(/not be empty/)

    // MODELED_FROM_PRICING is now valid by design (R1-C proof)
    // Test that mixed provenance within same distribution correctly rejects
    const mixed = fullDistributionMap()
    const thirdKey = [...mixed.keys()][2]!
    const obsEntry = mixed.get(thirdKey)!.entries[0]!
    const priceEntry = { ...obsEntry, provenance: 'MODELED_FROM_PRICING' as const, pricingSnapshotHash: 'c'.repeat(64) }
    mixed.set(thirdKey, { 
      ...mixed.get(thirdKey)!,
      entries: [obsEntry, priceEntry],
    })
    expect(() => runCumulativeModel({ ...base, costDistributions: { currency: CURRENCY, distributions: mixed } })).toThrow(/mixes.*provenance/i)
  })

  it('rejects currency mismatches inside distributions and the judge plan', () => {
    const base = buildInput('0.500000000000', 's')
    const mismatched = fullDistributionMap()
    const foreignKey = [...mismatched.keys()][0]!
    mismatched.set(foreignKey, { ...mismatched.get(foreignKey)!, currency: 'USD' })
    expect(() => runCumulativeModel({ ...base, costDistributions: { currency: CURRENCY, distributions: mismatched } })).toThrow(/currency mismatch/)
    expect(() => runCumulativeModel({ ...base, judgePlan: createJudgePlanAuthority(POLICY, 'USD') })).toThrow(/currency/)
  })

  it('ignores a smuggled fault-schedule frequency field', () => {
    const base = buildInput('0.500000000000', 's')
    const smuggled = { ...base, faultScheduleFrequency: 0.5 } as unknown as CumulativeModelInput
    expect(() => runCumulativeModel(smuggled)).not.toThrow()
  })
})

describe('cumulative model deterministic vectors', () => {
  it('maps exact probabilities to exact failure thresholds', () => {
    expect(failureProbabilityThreshold('0.000000000000')).toBe(BigInt(0))
    expect(failureProbabilityThreshold('0.000000000001')).toBe(BigInt(0))
    expect(failureProbabilityThreshold('0.500000000000')).toBe(BigInt(2147483648))
    expect(failureProbabilityThreshold('0.999999999999')).toBe(BigInt(4294967295))
    expect(failureProbabilityThreshold('1.000000000000')).toBe(BigInt(4294967296))
  })

  it('fails iff the draw word is strictly below the threshold', () => {
    const threshold = failureProbabilityThreshold('0.999999999999')
    expect(BigInt(4294967294) < threshold).toBe(true)
    expect(BigInt(4294967295) < threshold).toBe(false)
    const half = failureProbabilityThreshold('0.500000000000')
    expect(BigInt(2147483647) < half).toBe(true)
    expect(BigInt(2147483648) < half).toBe(false)
    const none = failureProbabilityThreshold('0.000000000000')
    expect(BigInt(0) < none).toBe(false)
  })

  it('completes every iteration with p=0 and pins exact cost, count, and draw vectors', () => {
    const output = runCumulativeModel(buildInput('0.000000000000', 'm10-e-golden'))
    const result = output.result
    expect(result.completionProbability).toBe('1.000000000000')
    expect(result.completionCount).toBe(100000)
    expect(result.terminalFailureCount).toBe(0)
    expect(result.terminalFailureProbability).toBe('0.000000000000')
    expect(result.iterations).toBe(100000)
    expect(result.modelVersion).toBe('M10_E_CUMULATIVE_MODEL_V1')
    expect(result.executionProfile).toBe('CONTRACT_FIXTURE')
    expect(result.seed).toBe('m10-e-golden')
    expect(result.expectedRetryCount).toBe(expectedCount(successPath.retryCount * 50 * 100000, 100000))
    expect(result.expectedGenerationProviderCallCount).toBe(expectedCount(successPath.providerCount * 50 * 100000, 100000))
    expect(result.expectedJudgeProviderCallCount).toBe('24.000000')
    expect(result.expectedTotalProviderCallCount).toBe(expectedCount((successPath.providerCount * 50 + 24) * 100000, 100000))
    expect(result.totalOutcomeDrawCount).toBe(successPath.stageCount * 50 * 100000)
    expect(result.totalCostDrawCount).toBe(successPath.providerCount * 50 * 100000)
    expect(result.totalJudgeCostDrawCount).toBe(24 * 100000)
    expect(failurePath.providerCount).toBeLessThan(failurePath.stageCount)
    for (let chapterIndex = 0; chapterIndex < 50; chapterIndex += 1) {
      const chapterMean = result.chapterMeans[chapterIndex]!
      expect(chapterMean.state).toBe('PRESENT')
      if (chapterMean.state === 'PRESENT') {
        expect(chapterMean.value).toBe(moneyScaled(2.5 * successPath.providerCount))
      }
      expect(result.chapterMeanDenominators[chapterIndex]).toBe(100000)
      expect(result.chapterCostP50[chapterIndex]!.state).toBe('PRESENT')
      expect(result.chapterCostP95[chapterIndex]!.state).toBe('PRESENT')
    }
    if (result.maxExpectedCostPerChapter.state === 'PRESENT') {
      expect(result.maxExpectedCostPerChapter.value).toBe(moneyScaled(2.5 * successPath.providerCount))
    }
    if (result.successfulRunGenerationMean.state === 'PRESENT') {
      expect(result.successfulRunGenerationMean.value).toBe(moneyScaled(2.5 * successPath.providerCount * 50))
    }
    expect(result.startedAttemptGenerationSpendDiagnostic).toBe(moneyScaled(2.5 * successPath.providerCount * 50))
    expect(result.startedAttemptCount).toBe(100000)
    if (result.modeledJudgeTotal.state === 'PRESENT') expect(result.modeledJudgeTotal.value).toBe('60.00000000')
    if (result.generationCostP50.state === 'PRESENT') expect(result.generationCostP50.value).toBe(moneyScaled(2.5 * successPath.providerCount * 50))
    if (result.generationCostP95.state === 'PRESENT') expect(result.generationCostP95.value).toBe(moneyScaled(2.5 * successPath.providerCount * 50))
    if (result.combinedTotalNovelCostP50.state === 'PRESENT') expect(result.combinedTotalNovelCostP50.value).toBe(moneyScaled(2.5 * successPath.providerCount * 50 + 60))
    if (result.combinedTotalNovelCostP95.state === 'PRESENT') expect(result.combinedTotalNovelCostP95.value).toBe(moneyScaled(2.5 * successPath.providerCount * 50 + 60))
  })

  it('terminates every iteration with p=1, skips later chapters and the judge plan, and still samples the failing provider node cost', () => {
    const output = runCumulativeModel(buildInput('1.000000000000', 'm10-e-golden'))
    const result = output.result
    expect(result.completionCount).toBe(0)
    expect(result.completionProbability).toBe('0.000000000000')
    expect(result.terminalFailureCount).toBe(100000)
    expect(result.terminalFailureProbability).toBe('1.000000000000')
    expect(result.totalOutcomeDrawCount).toBe(failurePath.stageCount * 100000)
    expect(result.totalCostDrawCount).toBe(failurePath.providerCount * 100000)
    expect(result.totalJudgeCostDrawCount).toBe(0)
    expect(result.expectedJudgeProviderCallCount).toBe('0.000000')
    expect(result.expectedGenerationProviderCallCount).toBe(expectedCount(failurePath.providerCount * 100000, 100000))
    expect(result.expectedRetryCount).toBe(expectedCount(failurePath.retryCount * 100000, 100000))
    expect(result.modeledJudgeTotal.state).toBe('MISSING')
    expect(result.successfulRunGenerationMean.state).toBe('MISSING')
    expect(result.generationCostP50.state).toBe('MISSING')
    expect(result.generationCostP95.state).toBe('MISSING')
    expect(result.combinedTotalNovelCostP50.state).toBe('MISSING')
    expect(result.combinedTotalNovelCostP95.state).toBe('MISSING')
    const chapterOneMean = result.chapterMeans[0]!
    expect(chapterOneMean.state).toBe('PRESENT')
    if (chapterOneMean.state === 'PRESENT') expect(chapterOneMean.value).toBe(moneyScaled(2.5 * failurePath.providerCount))
    expect(result.chapterMeanDenominators[0]).toBe(100000)
    for (let chapterIndex = 1; chapterIndex < 50; chapterIndex += 1) {
      expect(result.chapterMeans[chapterIndex]!.state).toBe('MISSING')
      expect(result.chapterMeanDenominators[chapterIndex]).toBe(0)
    }
    if (result.maxExpectedCostPerChapter.state === 'PRESENT') {
      expect(result.maxExpectedCostPerChapter.value).toBe(moneyScaled(2.5 * failurePath.providerCount))
    }
    expect(result.startedAttemptGenerationSpendDiagnostic).toBe(moneyScaled(2.5 * failurePath.providerCount))
    expect(result.startedAttemptCount).toBe(100000)
  })

  it('aggregates linkage between draws, completions, and expected counts with rare failures', () => {
    const output = runCumulativeModel(buildInput('0.000001000000', 'm10-e-golden'))
    const result = output.result
    const terminal = result.terminalFailureCount
    const completed = result.completionCount
    expect(completed + terminal).toBe(100000)
    expect(completed).toBe(100000)
    expect(result.completionProbability).toBe(ratioOf(BigInt(completed), BigInt(100000)))
    expect(result.expectedJudgeProviderCallCount).toBe(expectedCount(24 * completed, 100000))
    expect(result.totalJudgeCostDrawCount).toBe(24 * completed)
    expect(result.totalCostDrawCount).toBeGreaterThanOrEqual(successPath.providerCount * 50 * completed)
    expect(result.totalOutcomeDrawCount).toBeGreaterThanOrEqual(successPath.stageCount * 50 * completed)
    expect(result.chapterMeanDenominators[0]).toBe(100000)
    expect(result.chapterMeanDenominators[49]).toBe(completed)
    for (let chapterIndex = 1; chapterIndex < 50; chapterIndex += 1) {
      expect(result.chapterMeanDenominators[chapterIndex]!).toBeLessThanOrEqual(result.chapterMeanDenominators[chapterIndex - 1]!)
    }
    if (result.successfulRunGenerationMean.state === 'PRESENT') {
      const generationMean = Number(result.successfulRunGenerationMean.value)
      expect(generationMean).toBeGreaterThanOrEqual(250)
      expect(generationMean).toBeLessThan(250.1)
    }
    if (result.modeledJudgeTotal.state === 'PRESENT') expect(result.modeledJudgeTotal.value).toBe('60.00000000')
  })

  it('binds provenance, authority, and hashes on the modeled output', () => {
    const output = runCumulativeModel(buildInput('0.000000000000', 'm10-e-golden'))
    expect(output.provenance).toBe('MODELED')
    expect(output.modelAuthority).toBe(M10_E_CUMULATIVE_MODEL_V1)
    expect(output.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(output.outputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(output.result)).toBe(JSON.stringify(output.result))
  })
}, 180000)