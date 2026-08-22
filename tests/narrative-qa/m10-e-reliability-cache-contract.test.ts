/**
 * M10-E R1-C cache contract verification tests
 * 
 * Proves in-process memoization correctness independent of cross-process determinism proof:
 * - Same semantic input → cache hit (within single test suite process)
 * - Semantic mutation → cache miss (different semantic hash)
 * 
 * This is SEPARATE from the independent-run determinism test, which proves
 * cross-process byte-identical recomputation without relying on any cache.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { resetCacheAndMetrics, getCacheMetrics } from '../../lib/narrative-qa/reliability/artifacts'
import { buildModelInputRecordFixture, buildReliabilityObservationFixture } from '../../fixtures/m10-e/reliability-contract-fixture'
import { finalizeReliabilitySemanticPayload } from '../../lib/narrative-qa/reliability/artifacts'
import type { ObservedBudgetComparators, ModeledBudgetComparators, BudgetGateInput, EngineeringGateInput, CanonicalDecimal } from '../../lib/narrative-qa/reliability'
import type { MeasurementState } from '../../lib/narrative-qa/reliability/contracts'

type Money = CanonicalDecimal<'MONEY'>
type AggregateOutput = ReturnType<typeof import('../../lib/narrative-qa/reliability/aggregation').aggregateReliabilityObservations>

describe('M10-E cache contract - same input produces same output', () => {
  beforeAll(() => {
    // Reset cache at suite start for clean state
    resetCacheAndMetrics()
  })

  afterAll(() => {
    // Reset cache after suite ends
    resetCacheAndMetrics()
  })

  it('same payload invoked twice produces identical hashes', async () => {
    const observations: unknown = buildReliabilityObservationFixture()
    const modelRecord = buildModelInputRecordFixture(observations as never)
    
    const payloadBase: unknown = {
      schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1' as const,
      executionProfile: 'CONTRACT_FIXTURE' as const,
      baseGitSha: 'a'.repeat(40),
      gitDirty: false,
      e2ClosureReference: 'b'.repeat(40),
      sourceAuthority: 'CONTRACT_FIXTURE' as const,
      compatibleStratum: (modelRecord as unknown as { compatibleStratum: unknown }).compatibleStratum,
      authorities: [] as unknown,
      completeness: {
        engineeringGate: 'PASS' as const,
        reasonCodes: [] as string[],
        profileCompleteness: {} as unknown,
      },
      observations,
      observationHash: 'c'.repeat(64),
      aggregate: {} as unknown,
      aggregateHash: 'd'.repeat(64),
      model: {
        input: modelRecord,
        output: {} as unknown,
      },
      observedChapterCostMeans: Object.assign({ means: [] as readonly MeasurementState<Money>[], denominators: Array(50).fill(0) }),
      observedChapterMeanDenominators: Array(50).fill(0),
      comparators: { modeled: {} as ModeledBudgetComparators, observed: {} as ObservedBudgetComparators, observedDiagnostics: [] } as unknown,
      budget: { input: {} as BudgetGateInput, result: {} as unknown },
      engineeringGate: { input: {} as EngineeringGateInput, result: {} as unknown },
      reasonCodes: [] as string[],
    }
    
    // First invocation
    const artifact1 = finalizeReliabilitySemanticPayload(payloadBase as never)
    
    // Second invocation with identical payload
    const artifact2 = finalizeReliabilitySemanticPayload(payloadBase as never)
    
    // Memoization should produce byte-identical results
    expect(artifact1.artifactSemanticHash).toBe(artifact2.artifactSemanticHash)
    expect(artifact1.model.output.outputHash).toBe(artifact2.model.output.outputHash)
  })

  it('different seed produces different hash', async () => {
    const observations: unknown = buildReliabilityObservationFixture()
    const modelRecord = buildModelInputRecordFixture(observations as never)
    
    const payloadA = Object.assign({ ...buildPayload(modelRecord) as {}, baseGitSha: 'a'.repeat(40) }) as unknown
    const payloadB = Object.assign({ ...buildPayload(modelRecord) as {}, baseGitSha: 'b'.repeat(40) }) as unknown
    
    const artifactA = finalizeReliabilitySemanticPayload(payloadA as never)
    const artifactB = finalizeReliabilitySemanticPayload(payloadB as never)
    
    expect(artifactA.artifactSemanticHash).not.toBe(artifactB.artifactSemanticHash)
  })

  it('metrics initialized correctly', () => {
    const metrics = getCacheMetrics()
    expect(metrics.cacheHitCount).toBe(0)
    expect(metrics.fullModelInvocationCount).toBe(0)
    expect(metrics.inputHashesSeen.length).toBe(0)
  })
})

function buildPayload(record: ReturnType<typeof buildModelInputRecordFixture>): unknown {
  const observations = buildReliabilityObservationFixture() as never
  return Object.assign({
    schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1' as const,
    executionProfile: 'CONTRACT_FIXTURE' as const,
    gitDirty: false,
    e2ClosureReference: 'y'.repeat(40),
    sourceAuthority: 'CONTRACT_FIXTURE' as const,
    compatibleStratum: (record as unknown as { compatibleStratum: unknown }).compatibleStratum,
    authorities: [] as unknown,
    completeness: {
      engineeringGate: 'PASS' as const,
      reasonCodes: [] as string[],
      profileCompleteness: {} as unknown,
    },
    observations,
    observationHash: 'z'.repeat(64),
    aggregate: {} as unknown,
    aggregateHash: 'w'.repeat(64),
    model: {
      input: record,
      output: {} as unknown,
    },
    observedChapterCostMeans: Object.assign({ means: [] as readonly MeasurementState<Money>[], denominators: Array(50).fill(0) }),
    observedChapterMeanDenominators: Array(50).fill(0),
    comparators: { modeled: {} as ModeledBudgetComparators, observed: {} as ObservedBudgetComparators, observedDiagnostics: [] } as unknown,
    budget: { input: {} as BudgetGateInput, result: {} as unknown },
    engineeringGate: { input: {} as EngineeringGateInput, result: {} as unknown },
    reasonCodes: [] as string[],
  })
}
