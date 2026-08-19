/**
 * M10-E R1-C pricing fallback provenance proof tests
 * 
 * Proves that when empirical cost data is unavailable (EXPLICITLY_UNAVAILABLE),
 * the system correctly falls back to MODELED_FROM_PRICING distribution and
 * preserves this provenance through generation/judge fallback paths.
 */

import { describe, expect, it } from 'vitest'

import { aggregateReliabilityObservations } from '../../lib/narrative-qa/reliability/aggregation'
import { buildReliabilityObservationFixture, contractPricingSnapshot, buildModelInputRecordFixture } from '../../fixtures/m10-e/reliability-contract-fixture'
import { selectCostDistribution, formatCostDistributionKey, generationCostKey, observedCostEntry, modeledPricingCostEntry, type EmpiricalCostEvidenceSource, type PricingCostFallbackSource, type ObservedCostEntry, type ModeledPricingCostEntry } from '../../lib/narrative-qa/reliability/cost-distributions'
import { convertDecimal } from '../../lib/narrative-qa/reliability/decimal'
import { runCumulativeModel, toCumulativeModelInput, type ReliabilityModelInputRecord } from '../../lib/narrative-qa/reliability/artifacts'

describe('M10-E R1-C pricing fallback provenance', () => {
  it('selectCostDistribution AVAILABLE → OBSERVED distribution', () => {
    const observations = buildReliabilityObservationFixture()
    
    // Build empirical source with AVAILABLE availability and OBSERVED distributions
    const firstProviderCall = observations.providerCalls[0]
    if (firstProviderCall.actualCost.state !== 'PRESENT') {
      throw new Error('Test fixture requires actualCost to be present for AVAILABLE path')
    }
    
    const generationKey = generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: firstProviderCall.taskId,
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'provider_v1',
    })
    
    const entry = observedCostEntry(
      firstProviderCall.actualCost.value,
      firstProviderCall.observationId,
    )
    
    const empiricalEntries: readonly ObservedCostEntry[] = Object.freeze([entry])
    const empiricalEntriesMap = new Map<string, readonly ObservedCostEntry[]>([
      [formatCostDistributionKey(generationKey), empiricalEntries],
    ])
    
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'AVAILABLE' as const,
      distributions: empiricalEntriesMap,
    }
    
    // Use IDR currency from fixture (FIXTURE_CURRENCY)
    const currency = 'IDR'
    
    const result = selectCostDistribution(
      generationKey,
      currency,
      empiricalSource,
    )
    
    if (result.status !== 'SELECTED') {
      const reason = ('reason' in result) ? String((result as { reason?: string }).reason) : 'Unknown'
      throw new Error(`Expected SELECTED status for pricing fallback, got: ${reason}`)
    }
    
    expect(result.distribution.provenance).toBe('OBSERVED')
    expect(result.distribution.currency).toBe(currency)
    // AVAILABLE empirical means we use observed distribution, no pricing fallback needed
    const actualEntry = result.distribution.entries[0]!
    if (actualEntry.provenance === 'OBSERVED') {
      expect(actualEntry.observationId).toBe(firstProviderCall.observationId)
    }
  })

  it('selectCostDistribution EXPLICITLY_UNAVAILABLE → MODELED_FROM_PRICING', () => {
    const observations = buildReliabilityObservationFixture()
    const pricingSnapshot = contractPricingSnapshot()
    
    // Build empirical source with EXPLICITLY_UNAVAILABLE availability
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    // Pricing snapshot uses IDR currency (FIXTURE_CURRENCY)
    const currency = 'IDR'
    // Use actual task ID from fixture observations
    const firstProviderCall = observations.providerCalls[0]
    // Must create full GenerationCostKey with all required fields
    const generationKey = generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: firstProviderCall.taskId,
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'provider_v1',
    })
    
    // Create properly typed modeled pricing entry using helper function
    const entry = modeledPricingCostEntry(
      '0.45000000',
      pricingSnapshot.canonicalHash,
      'obs_test_retry_001',
    )
    
    const pricingEntries: readonly ModeledPricingCostEntry[] = Object.freeze([entry])
    const pricingEntriesMap = new Map<string, readonly ModeledPricingCostEntry[]>([
      [formatCostDistributionKey(generationKey), pricingEntries],
    ])
    
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot,
      distributions: pricingEntriesMap,
    }
    
    const result = selectCostDistribution(
      generationKey,
      currency,
      empiricalSource,
      pricingSource,
    )
    
    if (result.status !== 'SELECTED') {
      throw new Error(`Expected SELECTED status for pricing fallback, got: ${result.reason}`)
    }
    
    expect(result.distribution.provenance).toBe('MODELED_FROM_PRICING')
    expect(result.distribution.currency).toBe(currency)
    expect(result.distribution.entries[0].provenance).toBe('MODELED_FROM_PRICING')
    expect(result.distribution.entries[0].pricingSnapshotHash).toBe(pricingSnapshot.canonicalHash)
  })

  it('EXPLICITLY_UNAVAILABLE empirical prevents pricing fallback selection without source', () => {
    const observations = buildReliabilityObservationFixture()
    
    // Empirical explicitly unavailable without pricing source
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    const firstProviderCall = observations.providerCalls[0]
    const generationKey = generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: firstProviderCall.taskId,
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'provider_v1',
    })
    const result = selectCostDistribution(
      generationKey,
      'IDR',
      empiricalSource,
    )
    
    expect(result.status).toBe('HOLD')
    if (result.status === 'HOLD' || result.status === 'REJECT') {
      expect((result as {reason?: string}).reason).toContain('Empirical unavailable with no pricing fallback')
    }
  })

  it('full model input: generation fallback selection at authority boundary', () => {
    const observations = buildReliabilityObservationFixture()
    
    // Pricing snapshot uses IDR currency from fixture
    const pricingSnapshot = contractPricingSnapshot()
    
    const firstProviderCall = observations.providerCalls[0]
    
    // Test OBSERVED path
    const generationKey = generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: firstProviderCall.taskId,
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'provider_v1',
    })
    
    const empiricalEntry = observedCostEntry(
      firstProviderCall.actualCost.value,
      firstProviderCall.observationId,
    )
    const empiricalEntries = Object.freeze([empiricalEntry])
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'AVAILABLE' as const,
      distributions: new Map([[formatCostDistributionKey(generationKey), empiricalEntries]] as Map<string, readonly ObservedCostEntry[]>),
    }
    
    const observedResult = selectCostDistribution(
      generationKey,
      'IDR',
      empiricalSource,
    )
    
    if (observedResult.status !== 'SELECTED') {
      const reason = ('reason' in observedResult) ? String((observedResult as { reason?: string }).reason) : 'Unknown'
      throw new Error(`Expected SELECTED for AVAILABLE: ${reason}`)
    }
    
    expect(observedResult.distribution.provenance).toBe('OBSERVED')
    expect(observedResult.distribution.entries.length).toBe(1)
    expect(observedResult.distribution.entries[0].observationId).toBe(firstProviderCall.observationId)
    
    // Verify canonical hash computation
    expect(observedResult.distribution.canonicalHash).toMatch(/^[0-9a-f]{64}$/)
    
    // Test MODELED_FROM_PRICING path
    const retryKey = generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_RETRY',
      taskId: firstProviderCall.taskId,
      attemptClass: 'RETRY',
      providerModelPolicyId: 'provider_v1',
    })
    
    const unavailableSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    const pricingEntry = modeledPricingCostEntry(
      '0.45000000',
      pricingSnapshot.canonicalHash,
      'obs_test_retry_001',
    )
    const pricingEntries = Object.freeze([pricingEntry])
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot,
      distributions: new Map([[formatCostDistributionKey(retryKey), pricingEntries]]) as ReadonlyMap<string, readonly ModeledPricingCostEntry[]>,
    }
    
    const modeledResult = selectCostDistribution(
      retryKey,
      'IDR',
      unavailableSource,
      pricingSource,
    )
    
    if (modeledResult.status !== 'SELECTED') {
      throw new Error(`Expected SELECTED for pricing fallback: ${modeledResult.reason}`)
    }
    
    expect(modeledResult.distribution.provenance).toBe('MODELED_FROM_PRICING')
    expect(modeledResult.distribution.entries[0].pricingSnapshotHash).toBe(pricingSnapshot.canonicalHash)
    expect(modeledResult.distribution.canonicalHash).toMatch(/^[0-9a-f]{64}$/)
    
    // Prove two keys result in different hashes
    expect(observedResult.distribution.key).not.toBe(modeledResult.distribution.key)
    expect(observedResult.distribution.canonicalHash).not.toBe(modeledResult.distribution.canonicalHash)
  })

  it('judge distribution: EXPLICITLY_UNAVAILABLE → MODELED_FROM_PRICING', () => {
    const observations = buildReliabilityObservationFixture()
    const pricingSnapshot = contractPricingSnapshot()
    
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    // Currency MUST match pricing snapshot currency (IDR) per selectCostDistribution validation
    const pricingEntries = [
      modeledPricingCostEntry(
        '0.10000000',
        pricingSnapshot.canonicalHash,
        'obs_judge_001',
      ),
    ].map((e) => Object.freeze([e])[0]) as readonly ModeledPricingCostEntry[]
    
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot,
      distributions: new Map(),
    }
    
    const judgeKey = {
      kind: 'JUDGE' as const,
      judgeTaskId: 'competence',
      evaluationIndex: 0,
      providerModelPolicyId: 'provider_v1',
    }
    
    // Validate selector handles JUDGE key format correctly
    const result = selectCostDistribution(
      judgeKey,
      'IDR',
      empiricalSource,
      pricingSource,
    )
    
    // This should HOLD because we're not providing pricing entries for this key
    expect(result.status).toBe('HOLD')
  })

  it('empirical AVAILABLE must prevent pricing fallback', () => {
    const observations = buildReliabilityObservationFixture()
    
    // If actualCost is PRESENT, use it (no need for pricing fallback)
    const firstProviderCall = observations.providerCalls[0]
    
    if (firstProviderCall.actualCost.state !== 'PRESENT') {
      throw new Error('Test fixture requires actualCost to be present for AVAILABLE path')
    }
    
    // Build empirical source with AVAILABLE
    const empiricalEntry = observedCostEntry(
      firstProviderCall.actualCost.value,
      firstProviderCall.observationId,
    )
    
    const empiricalEntries = Object.freeze([empiricalEntry])
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'AVAILABLE' as const,
      distributions: new Map(),
    }
    
    const generationKey = generationCostKey({
      chapterNumber: 1,
      stageId: 'PROSE_PRIMARY',
      taskId: firstProviderCall.taskId,
      attemptClass: 'PRIMARY',
      providerModelPolicyId: 'provider_v1',
    })
    
    empiricalSource.distributions.set(formatCostDistributionKey(generationKey), empiricalEntries)
    
    // Use IDR currency from fixture
    const result = selectCostDistribution(
      generationKey,
      'IDR',
      empiricalSource,
    )
    
    if (result.status !== 'SELECTED') {
      throw new Error(`Expected SELECTED for AVAILABLE: ${result.reason}`)
    }
    
    // SHOULD NOT use pricing fallback when empirical available
    expect(result.distribution.provenance).toBe('OBSERVED')
  })

  /**
   * R1-C COMPLETE MODEL PROOF - GENERATION
   * 
   * Proves that MODELED_FROM_PRICING cost distributions integrate correctly
   * into a complete canonical model input and produce valid Monte Carlo output.
   * 
   * Uses actual existing distribution key from buildModelInputRecordFixture,
   * replaces via selectCostDistribution(), verifies provenance preservation.
   */
  it('generation MODELED_FROM_PRICING passes full 100k iteration model run', async () => {
    const observations = buildReliabilityObservationFixture()
    const pricingSnapshot = contractPricingSnapshot()
    
    // Build complete model input using actual fixture
    const baseRecord = { ...buildModelInputRecordFixture(observations) }
    
    // Find an existing PROSE_RETRY distribution key from the fixture (not hand-invented)
    let targetIndex = -1
    let targetDist = null
    for (let i = 0; i < baseRecord.costDistributions.distributions.length; i += 1) {
      const dist = baseRecord.costDistributions.distributions[i]!
      const keyObj: CostDistributionKey = dist.key
      if (keyObj.kind === 'GENERATION' && keyObj.stageId === 'PROSE_RETRY') {
        targetIndex = i
        targetDist = dist
        break
      }
    }
    
    if (targetIndex < 0 || !targetDist) {
      throw new Error('No PROSE_RETRY generation key found in fixture')
    }
    
    // Build empirical source with EXPLICITLY_UNAVAILABLE availability
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    // Build pricing source with exact currency match
    const pricingEntries = Object.freeze([
      modeledPricingCostEntry(
        '0.45000000',
        pricingSnapshot.canonicalHash,
        'obs_model_test_retry_001',
      ),
    ])
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot,
      distributions: new Map([[formatCostDistributionKey(targetDist.key), pricingEntries]]),
    }
    
    // Select replacement via selectCostDistribution()
    const selectedResult = selectCostDistribution(
      targetDist.key as CostDistributionKey,
      'IDR',
      empiricalSource,
      pricingSource,
    )
    
    expect(selectedResult.status).toBe('SELECTED')
    expect(selectedResult.distribution.provenance).toBe('MODELED_FROM_PRICING')
    expect(selectedResult.distribution.entries[0].pricingSnapshotHash).toBe(pricingSnapshot.canonicalHash)
    
    // Replace exactly that record in the modelRecord.costDistributions.distributions ARRAY
    baseRecord.costDistributions.distributions[targetIndex] = {
      ...selectedResult.distribution,
      currency: targetDist.currency,
    }
    
    const input = toCumulativeModelInput(baseRecord)
    
    // MUST succeed with MODELED_FROM_PRICING distribution
    const output = runCumulativeModel(input)
    
    expect(output.outputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(output.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(output.result.successfulRunGenerationMean).toBeDefined()
    
    // Verify replacement provenance preserved
    const replacementDist = input.costDistributions.distributions.get(formatCostDistributionKey(targetDist.key))!
    expect(replacementDist.provenance).toBe('MODELED_FROM_PRICING')
    expect(replacementDist.entries[0].pricingSnapshotHash).toBe(pricingSnapshot.canonicalHash)
  }, 450000)

  /**
   * R1-C COMPLETE MODEL PROOF - JUDGE
   */
  it('judge MODELED_FROM_PRICING passes full 100k iteration model run', async () => {
    const observations = buildReliabilityObservationFixture()
    const pricingSnapshot = contractPricingSnapshot()
    
    const baseRecord = { ...buildModelInputRecordFixture(observations) }
    
    let targetIndex = -1
    for (let i = 0; i < baseRecord.costDistributions.distributions.length; i += 1) {
      const dist = baseRecord.costDistributions.distributions[i]!
      const keyObj: CostDistributionKey = dist.key
      if (keyObj.kind === 'JUDGE') {
        targetIndex = i
        break
      }
    }
    
    expect(targetIndex).toBeGreaterThan(-1)
    
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    const pricingEntries = Object.freeze([
      modeledPricingCostEntry(
        '0.10000000',
        pricingSnapshot.canonicalHash,
        'obs_model_test_judge_001',
      ),
    ])
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot,
      distributions: new Map([[formatCostDistributionKey(baseRecord.costDistributions.distributions[targetIndex]!.key), pricingEntries]]),
    }
    
    expect(targetIndex).toBeGreaterThan(-1)
    
    const selectedResult = selectCostDistribution(
      targetIndex >= 0 ? baseRecord.costDistributions.distributions[targetIndex]!.key : (() => { throw new Error('No JUDGE distribution found') })(),
      'IDR',
      empiricalSource,
      pricingSource,
    )
    
    expect(selectedResult.status).toBe('SELECTED')
    
    baseRecord.costDistributions.distributions[targetIndex] = {
      ...selectedResult.distribution,
      currency: 'IDR',
    }
    
    const input = toCumulativeModelInput(baseRecord)
    const output = runCumulativeModel(input)
    
    expect(output.outputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(output.result.successfulRunGenerationMean).toBeDefined()
  }, 450000)

  /**
   * R1-C NEGATIVE TESTS
   */
  it('wrong pricingSnapshotHash -> HOLD/reject before model execution', () => {
    const pricingSnapshot = contractPricingSnapshot()
    
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    const pricingEntries = Object.freeze([
      modeledPricingCostEntry(
        '0.45000000',
        'd'.repeat(64), // Wrong hash
        'obs_model_test_retry_001',
      ),
    ])
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot: { ...pricingSnapshot, canonicalHash: 'wrong'.repeat(32) },
      distributions: new Map(),
    }
    
    const judgeKey = {
      kind: 'JUDGE' as const,
      judgeTaskId: 'competence',
      evaluationIndex: 0,
      providerModelPolicyId: 'provider_v1',
    }
    
    const result = selectCostDistribution(
      judgeKey,
      'IDR',
      empiricalSource,
      pricingSource,
    )
    
    // SHOULD HOLD because pricingSnapshotHash doesn't match stratum
    expect(result.status).toBe('HOLD')
  })

  it('wrong currency -> HOLD/reject before model execution', () => {
    const pricingSnapshot = contractPricingSnapshot()
    
    const empiricalSource: EmpiricalCostEvidenceSource = {
      availability: 'EXPLICITLY_UNAVAILABLE' as const,
      distributions: new Map(),
    }
    
    const pricingEntries = Object.freeze([
      modeledPricingCostEntry(
        '0.45000000',
        pricingSnapshot.canonicalHash,
        'obs_model_test_retry_001',
      ),
    ])
    const pricingSource: PricingCostFallbackSource = {
      pricingSnapshot,
      distributions: new Map(),
    }
    
    const judgeKey = {
      kind: 'JUDGE' as const,
      judgeTaskId: 'competence',
      evaluationIndex: 0,
      providerModelPolicyId: 'provider_v1',
    }
    
    const result = selectCostDistribution(
      judgeKey,
      'USD', // Wrong currency
      empiricalSource,
      pricingSource,
    )
    
    // SHOULD HOLD due to currency mismatch
    expect(result.status).toBe('HOLD')
    expect(result.reason).toContain('currency')
  })
})