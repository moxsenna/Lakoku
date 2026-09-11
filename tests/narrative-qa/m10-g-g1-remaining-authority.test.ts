import { describe, expect, it } from 'vitest'
import pricingSnapshotJson from '../../fixtures/m10-g/pricing-snapshot-v1.json'
import { M10_G_G1_ROUTE_AUTHORITY } from '../../fixtures/m10-g/g1-route-authority'
import { evaluateM10GG1GenerationPolicyAuthority } from '../../lib/narrative-qa/evaluators/m10-g-g1-generation-policy-authority'
import {
  M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY,
  evaluateM10GG1PricingAuthority,
} from '../../lib/narrative-qa/evaluators/m10-g-g1-pricing-authority'
import { evaluateM10GG1TokenBoundDecision } from '../../lib/narrative-qa/judges/m10-g-g1-token-bound-decision'
import { evaluateM10GG1RemainingAuthority } from '../../lib/narrative-qa/judges/m10-g-g1-remaining-authority'
import { deriveM10GG1InferenceEconomicsProjection } from '../../lib/narrative-qa/harness/m10-g-g1-inference-projection'

const ROUTE_HASH = 'd1f96109596105f93b0c21accc8cbc52673f4a1e2eadc13a7c945700bd9e5a23'

describe('G1_GENERATION_POLICY_AUTHORITY_V1', () => {
  const decision = evaluateM10GG1GenerationPolicyAuthority()

  it('blocks on mutable policy source and emits no snapshot or hash', () => {
    expect(decision.status).toBe('BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE')
    expect(decision.policySnapshotEmitted).toBe(false)
    expect(decision.policySnapshotHash).toBeNull()
    expect(decision.dbAccessPerformed).toBe(false)
    expect(decision.inferencePerformed).toBe(false)
  })

  it('never promotes a default, seed, env fallback, or test literal to effective policy', () => {
    for (const field of decision.fields) {
      if (field.authorityState !== 'MUTABLE_RUNTIME_STATE') continue
      expect(field.currentEffectiveValue).toBeNull()
      expect(field.sourceIsImmutable).toBe(false)
      expect(['DEFAULT', 'MIGRATION_SEED', 'ENV_FALLBACK', 'NONE']).toContain(field.observedValueKind)
    }
  })

  it('lists every runtime-consumed field that stays unbound', () => {
    expect(decision.unboundFields).toEqual([
      'targetWordsMin',
      'targetWordsMax',
      'targetScenes',
      'leaseTtlSeconds',
      'maxConcurrentGenerations',
      'maxConcurrentGenerationsPerUser',
      'generationMaxQueue',
      'generationQueueWaitMs',
      'storyGenerationStatusAdmission',
    ])
  })

  it('separates already-frozen immutable fields from unbound policy', () => {
    expect(decision.frozenFields).toEqual([
      'writerSdkMaxRetries',
      'writerLengthRepairV1Enabled',
      'maximumChapterAttempts',
      'retryableStopReasons',
      'providerSelectionConstraint',
    ])
    for (const field of decision.fields) {
      if (field.authorityState !== 'FROZEN_IMMUTABLE_AUTHORITY') continue
      expect(field.sourceIsImmutable).toBe(true)
      expect(field.currentEffectiveValue).not.toBeNull()
    }
  })

  it('records the fail-closed guards that stop before admission and network', () => {
    expect(decision.failClosedGuards).toContain(
      'resolveM10GG1FrozenGenerationPolicy throws M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND',
    )
    expect(decision.failClosedGuards).toContain(
      'withGenerationSlot skips refreshGenerationConcurrencyFromPolicy when m10gMode is set',
    )
    expect(decision.requiredAdditionalAuthority.length).toBeGreaterThan(0)
  })
})

describe('G1_TOKEN_BOUND_AUTHORITY_DECISION_V1', () => {
  const decision = evaluateM10GG1TokenBoundDecision()

  it('stays blocked on tokenizer and provider billed-framing authority', () => {
    expect(decision.status).toBe('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')
    expect(decision.tokenizerImplemented).toBe(false)
    expect(decision.inferencePerformed).toBe(false)
    expect(decision.blockerCodes).toContain('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')
    expect(decision.candidatesWithoutInputAuthority).toHaveLength(6)
  })

  it('keeps the omitted long-horizon output cap blocked instead of inventing one', () => {
    expect(decision.outputAuthorityStatus).toBe('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
    expect(decision.blockerCodes).toContain('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
    expect(decision.candidatesWithoutOutputCap).toEqual([
      'LONG_HORIZON_SEMANTIC_JUDGE:deepseek/deepseek-v3.2:0',
    ])
  })

  it('resolves choice route binding from the ratified route authority', () => {
    expect(decision.choiceRouteBindingResolved).toBe(true)
    expect(decision.routeAuthorityHash).toBe(ROUTE_HASH)
    expect(decision.blockerCodes).not.toContain('BLOCKED_CHOICE_ROUTE_AUTHORITY_UNBOUND')
  })

  it('rejects every unsupported token heuristic', () => {
    expect(decision.rejectedHeuristics).toContain('characters divided by four')
    expect(decision.rejectedHeuristics).toContain('historical or average observed usage')
  })
})

describe('M10G_G1_PRICING_AUTHORITY_DECISION_V2', () => {
  const decision = evaluateM10GG1PricingAuthority(pricingSnapshotJson)

  it('keeps the snapshot unchanged and fetches no additional endpoint', () => {
    expect(decision.status).toBe('BLOCKED_PRICING_AUTHORITY_MISSING')
    expect(decision.snapshotUnchanged).toBe(true)
    expect(decision.additionalEndpointFetched).toBe(false)
    expect(decision.snapshotCanonicalHash).toBe(pricingSnapshotJson.normalized.canonicalHash)
  })

  it('names the exact authority still missing for worst-case routed billing', () => {
    expect(decision.requiredAdditionalAuthority).toBe(M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY)
    expect(decision.provesHiddenUpstreamProviderWorstCase).toBe(false)
    expect(decision.provesRoutingTierWorstCase).toBe(false)
    expect(decision.provesPerRequestMinimumCharges).toBe(false)
    expect(decision.provesReasoningBillingSemantics).toBe(false)
    expect(decision.provesCacheWriteBillingSemantics).toBe(false)
  })
})

describe('M10G_G1_REMAINING_AUTHORITY_CLOSURE_V1', () => {
  const status = evaluateM10GG1RemainingAuthority()

  it('reports three independent blocked subgates and keeps economics closed', () => {
    expect(status.status).toBe('BLOCKED')
    expect(status.economicsMayOpen).toBe(false)
    expect(status.hardInferenceLimit).toBeNull()
    expect(status.liveExecutionReady).toBe(false)
    expect(status.blockerCodes).toEqual([
      'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE',
      'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND',
      'BLOCKED_PRICING_AUTHORITY_MISSING',
      'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY',
    ])
    expect(status.subgates.tokenBound.choiceRouteBindingResolved).toBe(true)
  })

  it('leaves the ratified route hash and economics projection untouched', () => {
    expect(M10_G_G1_ROUTE_AUTHORITY.authorityHash).toBe(ROUTE_HASH)
    const projection = deriveM10GG1InferenceEconomicsProjection()
    expect(projection.hardInferenceLimit).toBeNull()
    expect(projection.minimumExpectedInferenceCount).toBe(184)
    expect(projection.maximumPolicyPermittedInferenceCount).toBe(2663)
    expect(projection.nominalProjectedCost.status).toBe('UNAVAILABLE')
    expect(projection.minimumTopologyCostUpperBound.status).toBe('UNAVAILABLE')
    expect(projection.maximumTopologyCostUpperBound.status).toBe('UNAVAILABLE')
  })
})
