import type { M10GG1PricingSnapshot } from '../contracts/m10-g-g1-pricing-snapshot.contract'
import { validateM10GG1PricingSnapshot } from '../contracts/m10-g-g1-pricing-snapshot.contract'

export const M10G_G1_PRICING_AUTHORITY_BLOCKER_REASON =
  'OpenRouter public /api/v1/models metadata reports model-level prices and top-provider summary only; it does not prove every hidden upstream provider, route selection, pricing tier, or worst-case routed price. Measurement snapshot is valid, but worst-case pricing authority is missing.' as const

export const M10G_G1_PRICING_DECISION_ID = 'M10G_G1_PRICING_AUTHORITY_DECISION_V2' as const

/**
 * Exact extra authority required before any endpoint amendment may be proposed.
 * Listing these is not authorization to fetch them.
 */
export const M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY: readonly string[] = Object.freeze([
  'Per-model endpoint metadata (/api/v1/models/{model_id}/endpoints) enumerating every hidden upstream provider able to serve each reachable alias, with that provider input, output, reasoning, and cache rates.',
  'The frozen routing and provider-pinning constraints the G-1 run will send, proving which endpoint permutations are actually reachable.',
  'Billing semantics for reasoning tokens on models whose catalog reasoning price is omitted or null.',
  'Billing semantics for cache-write and cache-read charges, including whether they can apply when caching is not requested.',
  'Per-request and provider-specific minimum charges for each reachable endpoint.',
  'A hashed worst-case unit-price ledger across all allowed routing permutations, computed with decimal, string, or BigInt arithmetic only.',
])

export type M10GG1PricingAuthorityVerdict = Readonly<{
  decisionId: typeof M10G_G1_PRICING_DECISION_ID
  status: 'BLOCKED_PRICING_AUTHORITY_MISSING'
  measurementSnapshotValid: true
  snapshotUnchanged: true
  additionalEndpointFetched: false
  snapshotCanonicalHash: string
  coveredReachableAliases: readonly string[]
  provesHiddenUpstreamProviderWorstCase: false
  provesRoutingTierWorstCase: false
  provesPerRequestMinimumCharges: false
  provesReasoningBillingSemantics: false
  provesCacheWriteBillingSemantics: false
  requiredAdditionalAuthority: readonly string[]
  reason: typeof M10G_G1_PRICING_AUTHORITY_BLOCKER_REASON
}>

export function evaluateM10GG1PricingAuthority(
  snapshotInput: M10GG1PricingSnapshot | unknown,
): M10GG1PricingAuthorityVerdict {
  const snapshot = validateM10GG1PricingSnapshot(snapshotInput)
  return Object.freeze({
    decisionId: M10G_G1_PRICING_DECISION_ID,
    status: 'BLOCKED_PRICING_AUTHORITY_MISSING' as const,
    measurementSnapshotValid: true as const,
    snapshotUnchanged: true as const,
    additionalEndpointFetched: false as const,
    snapshotCanonicalHash: snapshot.normalized.canonicalHash,
    coveredReachableAliases: Object.freeze(snapshot.normalized.models.map((model) => model.configuredAlias)),
    provesHiddenUpstreamProviderWorstCase: false as const,
    provesRoutingTierWorstCase: false as const,
    provesPerRequestMinimumCharges: false as const,
    provesReasoningBillingSemantics: false as const,
    provesCacheWriteBillingSemantics: false as const,
    requiredAdditionalAuthority: M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY,
    reason: M10G_G1_PRICING_AUTHORITY_BLOCKER_REASON,
  })
}
