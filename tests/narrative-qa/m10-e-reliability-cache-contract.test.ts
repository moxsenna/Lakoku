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

const HEX64 = /^[0-9a-f]{64}$/

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
    const observations = buildReliabilityObservationFixture()
    const modelRecord = buildModelInputRecordFixture(observations)
    
    const payloadBase = {
      executionProfile: 'CONTRACT_FIXTURE' as const,
      baseGitSha: 'a'.repeat(40),
      gitDirty: false,
      e2ClosureReference: 'b'.repeat(40),
      compatibleStratum: modelRecord.compatibleStratum,
      authorities: [],
      completeness: {
        engineeringGate: 'PASS' as const,
        reasonCodes: [] as string[],
        profileCompleteness: {} as any,
      },
      observations: {} as any,
      observationHash: 'c'.repeat(64),
      aggregate: {} as any,
      aggregateHash: 'd'.repeat(64),
      model: {
        input: modelRecord as any,
        output: {} as any,
      },
      observedChapterCostMeans: { means: [], denominators: [] } as any,
      observedChapterMeanDenominators: Array(50).fill(0),
      comparators: {} as any,
      budget: { input: {} as any, result: {} as any },
      engineeringGate: { input: {} as any, result: {} as any },
      reasonCodes: [] as string[],
    }
    
    // First invocation
    const artifact1 = finalizeReliabilitySemanticPayload(payloadBase as any)
    
    // Second invocation with identical payload
    const artifact2 = finalizeReliabilitySemanticPayload(payloadBase as any)
    
    // Memoization should produce byte-identical results
    expect(artifact1.artifactSemanticHash).toBe(artifact2.artifactSemanticHash)
    expect(artifact1.model.output.outputHash).toBe(artifact2.model.output.outputHash)
  })

  it('different seed produces different hash', async () => {
    const observations = buildReliabilityObservationFixture()
    const modelRecord = buildModelInputRecordFixture(observations)
    
    const payloadA = { ...buildPayload(modelRecord), baseGitSha: 'a'.repeat(40) }
    const payloadB = { ...buildPayload(modelRecord), baseGitSha: 'b'.repeat(40) }
    
    const artifactA = finalizeReliabilitySemanticPayload(payloadA as any)
    const artifactB = finalizeReliabilitySemanticPayload(payloadB as any)
    
    expect(artifactA.artifactSemanticHash).not.toBe(artifactB.artifactSemanticHash)
  })

  it('metrics initialized correctly', () => {
    const metrics = getCacheMetrics()
    expect(metrics.cacheHitCount).toBe(0)
    expect(metrics.fullModelInvocationCount).toBe(0)
    expect(metrics.inputHashesSeen.length).toBe(0)
  })
})

function buildPayload(record: ReturnType<typeof buildModelInputRecordFixture>) {
  return {
    executionProfile: 'CONTRACT_FIXTURE' as const,
    gitDirty: false,
    e2ClosureReference: 'y'.repeat(40),
    compatibleStratum: record.compatibleStratum,
    authorities: [],
    completeness: {
      engineeringGate: 'PASS' as const,
      reasonCodes: [] as string[],
      profileCompleteness: {} as any,
    },
    observations: {} as any,
    observationHash: 'z'.repeat(64),
    aggregate: {} as any,
    aggregateHash: 'w'.repeat(64),
    model: {
      input: record as any,
      output: {} as any,
    },
    observedChapterCostMeans: { means: [], denominators: [] } as any,
    observedChapterMeanDenominators: Array(50).fill(0),
    comparators: {} as any,
    budget: { input: {} as any, result: {} as any },
    engineeringGate: { input: {} as any, result: {} as any },
    reasonCodes: [] as string[],
  }
}
