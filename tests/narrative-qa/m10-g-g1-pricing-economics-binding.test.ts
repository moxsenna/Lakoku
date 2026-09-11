import { describe, expect, it } from 'vitest'
import pricingSnapshotJson from '../../fixtures/m10-g/pricing-snapshot-v1.json'
import { E0_R1_CEILINGS } from '../../fixtures/m10-e/e0-budget-authority'
import { evaluateM10GG1PricingAuthority } from '../../lib/narrative-qa/evaluators/m10-g-g1-pricing-authority'
import { deriveM10GG1InferenceEconomicsProjection } from '../../lib/narrative-qa/harness/m10-g-g1-inference-projection'

/**
 * Subgate C and D binding proof.
 *
 * A pricing snapshot that exists is not a pricing authority. These tests pin the
 * distinction: the snapshot covers every reachable model, and still cannot price
 * the run, because a per-model rate cannot be multiplied by a token count that
 * does not exist. Coverage is therefore never allowed to imply PASS.
 */

const projection = deriveM10GG1InferenceEconomicsProjection()

describe('Subgate C: snapshot coverage does not create pricing authority', () => {
  it('covers every reachable route model with no gaps left to fill', () => {
    expect(projection.pricingAuthority.missingReachableModels).toEqual([])
    expect(projection.pricingAuthority.coveredModels.length).toBe(
      pricingSnapshotJson.normalized.models.length,
    )
  })

  it('stays blocked despite full coverage, on hidden upstream routing', () => {
    const decision = evaluateM10GG1PricingAuthority(pricingSnapshotJson)

    expect(decision.status).toBe('BLOCKED_PRICING_AUTHORITY_MISSING')
    expect(projection.pricingAuthority.status).toBe('BLOCKED_PRICING_AUTHORITY_MISSING')
    expect(decision.provesHiddenUpstreamProviderWorstCase).toBe(false)
    expect(decision.provesRoutingTierWorstCase).toBe(false)
  })

  it('preserves OMITTED as absence rather than collapsing it to zero', () => {
    const omitted = pricingSnapshotJson.normalized.models.flatMap((model) => (
      [model.reasoning.per1MTokensUsd, model.input.per1MTokensUsd, model.output.per1MTokensUsd]
    )).filter((field) => field.state === 'OMITTED')

    // An omitted rate is unknown, not free. Any entry that silently gained a
    // value would be a fabricated price and must fail here.
    expect(omitted.every((field) => !('value' in field))).toBe(true)
  })

  it('holds every monetary field as a string, never a JS number', () => {
    for (const model of pricingSnapshotJson.normalized.models) {
      for (const component of [model.input, model.output, model.cacheRead, model.cacheWrite]) {
        if (component.per1MTokensUsd.state !== 'VALUE') continue
        expect(typeof component.per1MTokensUsd.value).toBe('string')
        expect(typeof component.sourcePerTokenUsd.value).toBe('string')
      }
    }
  })
})

describe('Subgate D: economics cannot open on a rate without a token count', () => {
  it('reports every cost projection as UNAVAILABLE with null amounts', () => {
    const costs = [
      projection.minimumTopologyCostUpperBound,
      projection.maximumTopologyCostUpperBound,
      projection.nominalProjectedCost,
      projection.worstCasePolicyPermittedCost,
    ]

    for (const cost of costs) {
      expect(cost.status).toBe('UNAVAILABLE')
      expect(cost.amountUsd ?? null).toBeNull()
      expect(cost.blockers).toContain('BLOCKED_TOKEN_ENVELOPE_UNBOUNDED')
      expect(cost.blockers).toContain('BLOCKED_PRICING_AUTHORITY_MISSING')
    }
  })

  it('leaves maximumInputTokens null for every call class', () => {
    for (const entry of projection.callClassBreakdown) {
      expect(entry.tokenEnvelope.maximumInputTokens).toBeNull()
      expect(entry.tokenEnvelope.status).toBe('BLOCKED_TOKEN_ENVELOPE_UNBOUNDED')
    }
  })

  it('never compares against the M10-E ceilings while inputs are unavailable', () => {
    expect(projection.economicsStatus.comparisonStatus).toBe('NOT_EVALUATED')
    expect(projection.economicsStatus.hardInferenceLimit).toBeNull()
  })

  it('keeps the M10-E ceilings byte-unchanged', () => {
    expect(projection.economicsStatus.frozenCeilings.maxExpectedCostPerChapterUsd)
      .toBe(E0_R1_CEILINGS.maxExpectedCostPerChapter)
    expect(projection.economicsStatus.frozenCeilings.maxExpectedCostPerNovelUsd)
      .toBe(E0_R1_CEILINGS.maxExpectedCostPerNovel)
    expect(projection.economicsStatus.frozenCeilings.maxRetryOverheadPercentage)
      .toBe(E0_R1_CEILINGS.maxRetryOverheadPercentage)
  })

  it('keeps the diagnostic topology counts out of the hard limit', () => {
    expect(projection.minimumExpectedInferenceCount).toBe(184)
    expect(projection.maximumPolicyPermittedInferenceCount).toBe(2663)

    // 184 and 2663 stay diagnostic. Copying either into hardInferenceLimit
    // before executor, route, token, and pricing authority are all bound is the
    // exact failure this assertion exists to catch.
    expect(projection.hardInferenceLimit).toBeNull()
  })

  it('reports the historical count as historical, never as live authority', () => {
    expect(projection.historicalInferenceCount.authority).toBe('HISTORICAL_ONLY')
    expect(projection.historicalInferenceCount.liveAuthority).toBe(false)
  })

  it('does not add the mutually exclusive writer repair maximum', () => {
    expect(projection.mutuallyExclusiveWriterTopology.writerLengthRepairEnabled).toBe(false)
    expect(projection.mutuallyExclusiveWriterTopology.writerLengthRepairMaximumTransportsContributed)
      .toBe(0)
    expect(projection.mutuallyExclusiveWriterTopology.rule).toBe('ALTERNATIVES_NOT_ADDITIVE')
  })
})
