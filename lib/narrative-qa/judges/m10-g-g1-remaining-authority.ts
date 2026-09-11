import pricingSnapshotJson from '../../../fixtures/m10-g/pricing-snapshot-v1.json'
import { evaluateM10GG1GenerationPolicyAuthority } from '../evaluators/m10-g-g1-generation-policy-authority'
import { evaluateM10GG1PricingAuthority } from '../evaluators/m10-g-g1-pricing-authority'
import { evaluateM10GG1TokenBoundDecision } from './m10-g-g1-token-bound-decision'

/**
 * M10G_G1_REMAINING_AUTHORITY_CLOSURE_V1 aggregate.
 *
 * Reports the three independent subgate decisions without recomputing
 * economics. Economics may only open once all three report PASS.
 */

export const M10G_G1_REMAINING_AUTHORITY_TRACK =
  'M10G_G1_REMAINING_AUTHORITY_CLOSURE_V1' as const

export type M10GG1RemainingAuthorityStatus = Readonly<{
  track: typeof M10G_G1_REMAINING_AUTHORITY_TRACK
  status: 'BLOCKED'
  economicsMayOpen: false
  hardInferenceLimit: null
  liveExecutionReady: false
  subgates: Readonly<{
    generationPolicy: Readonly<{ status: string; unboundFieldCount: number }>
    tokenBound: Readonly<{ status: string; outputAuthorityStatus: string; choiceRouteBindingResolved: boolean }>
    pricing: Readonly<{ status: string; snapshotCanonicalHash: string }>
  }>
  blockerCodes: readonly string[]
}>

export function evaluateM10GG1RemainingAuthority(): M10GG1RemainingAuthorityStatus {
  const generationPolicy = evaluateM10GG1GenerationPolicyAuthority()
  const tokenBound = evaluateM10GG1TokenBoundDecision()
  const pricing = evaluateM10GG1PricingAuthority(pricingSnapshotJson)

  const blockerCodes: string[] = []
  if (generationPolicy.status !== 'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE'
    || generationPolicy.unboundFields.length > 0) {
    blockerCodes.push(generationPolicy.status)
  }
  if (tokenBound.status !== 'TOKEN_BOUND_AUTHORITY_RATIFIABLE') {
    blockerCodes.push(tokenBound.status)
  }
  if (tokenBound.outputAuthorityStatus !== 'OUTPUT_TOKEN_AUTHORITY_BOUND') {
    blockerCodes.push(tokenBound.outputAuthorityStatus)
  }
  blockerCodes.push(pricing.status)

  return Object.freeze({
    track: M10G_G1_REMAINING_AUTHORITY_TRACK,
    status: 'BLOCKED' as const,
    economicsMayOpen: false as const,
    hardInferenceLimit: null,
    liveExecutionReady: false as const,
    subgates: Object.freeze({
      generationPolicy: Object.freeze({
        status: generationPolicy.status,
        unboundFieldCount: generationPolicy.unboundFields.length,
      }),
      tokenBound: Object.freeze({
        status: tokenBound.status,
        outputAuthorityStatus: tokenBound.outputAuthorityStatus,
        choiceRouteBindingResolved: tokenBound.choiceRouteBindingResolved,
      }),
      pricing: Object.freeze({
        status: pricing.status,
        snapshotCanonicalHash: pricing.snapshotCanonicalHash,
      }),
    }),
    blockerCodes: Object.freeze([...new Set(blockerCodes)].sort()),
  })
}
