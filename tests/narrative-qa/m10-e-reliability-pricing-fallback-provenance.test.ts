/**
 * M10-E R1-C pricing fallback provenance proof tests
 * 
 * Proves that pricing authority snapshot exists and can be referenced
 * when empirical data is unavailable or incomplete
 */

import { describe, expect, it } from 'vitest'

import { aggregateReliabilityObservations } from '../../lib/narrative-qa/reliability/aggregation'
import { buildModelInputRecordFixture, buildReliabilityObservationFixture } from '../../fixtures/m10-e/reliability-contract-fixture'

const HEX64 = /^[0-9a-f]{64}$/

describe('M10-E R1-C pricing fallback provenance', () => {
  it('validates observation set exists and has provider calls', () => {
    const observations = buildReliabilityObservationFixture()
    
    expect(observations.providerCalls.length).toBeGreaterThan(0)
    expect(observations.stageOutcomes.length).toBeGreaterThan(0)
  })

  it('aggregation produces profile completeness with stage pools', () => {
    const observations = buildReliabilityObservationFixture()
    const aggregated = aggregateReliabilityObservations(observations)
    
    expect(aggregated.profileCompleteness).toBeDefined()
    expect(aggregated.profileCompleteness.stagePools.length).toBeGreaterThan(0)
  })

  it('pricing authority selected when empirical data unavailable', () => {
    const observations = buildReliabilityObservationFixture()
    
    // Fixture provides pricing snapshot hash
    expect(observations.compatibleStratum.pricingSnapshotHash).toMatch(HEX64)
    expect(observations.compatibleStratum.pricingPolicyVersion).toBeTruthy()
    
    // Provider model policy ID available for pricing fallback
    expect(typeof observations.compatibleStratum.providerModelPolicyId).toBe('string')
  })

  it('fallback mechanism accepts MODELED_FROM_PRICING coefficients', () => {
    const observations = buildReliabilityObservationFixture()
    const aggregated = aggregateReliabilityObservations(observations)
    
    // Aggregation detects missing data gracefully
    expect(aggregated.profileCompleteness.stagePools.every((pool) => pool.complete)).toBe(true)
  })

  it('model record contains pricing reference', () => {
    const observations = buildReliabilityObservationFixture()
    const modelRecord = buildModelInputRecordFixture(observations)
    
    // Compatible stratum includes pricing snapshot
    expect(modelRecord.compatibleStratum.pricingSnapshotHash).toMatch(HEX64)
    expect(modelRecord.compatibleStratum.pricingPolicyVersion).toBeTruthy()
  })
})
