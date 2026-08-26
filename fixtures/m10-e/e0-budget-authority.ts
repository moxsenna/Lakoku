/**
 * Ratified M10-E E0 budget authority (business authority record).
 *
 * Materializes the exact product/finance approval supplied by the project lead:
 * Loose $200, USD, effective 2026-08-26. Numeric ceilings are bound to the
 * frozen counted comparators at artifact semantic hash 97596b71... (E3A/E4
 * counted pair, SHA 65053607) and the contract fixture pricing snapshot.
 *
 * The ratification payload below is the approval artifact; its SHA-256 is the
 * `approvalArtifactHash` carried inside the validated authority.
 */
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import { createE0BudgetAuthority, type E0BudgetAuthority } from '../../lib/narrative-qa/reliability'
import { contractPricingSnapshot } from './reliability-contract-fixture'

export const E0_RATIFICATION_REVIEWER = 'Lakoku Project Lead'
export const E0_RATIFICATION_DECISION_REF = 'LAKOKU-E0-2026-08-26-LOOSE-200'
export const E0_RATIFICATION_EFFECTIVE_DATE = '2026-08-26'
export const E0_RATIFICATION_CURRENCY = 'USD'
export const E0_RATIFICATION_SOURCE_PACKET = 'M10E-E0-DECISION-PACKET.md'

export const E0_RATIFICATION_CEILINGS = {
  maxExpectedCostPerChapter: '2.04001674',
  maxExpectedCostPerNovel: '200.00000000',
  maxJudgeEvaluationCostPerNovel: '2.40000000',
  maxRetryOverheadPercentage: '173.684249',
  p95CostGuardrail: '200.00000000',
} as const

/** Frozen counted artifact semantic hash (E3A/E4 counted pair comparator basis). */
export const E0_MEASURED_OBSERVATION_SET_VERSION = '97596b719c880eaccdc6abb680e753203eef8c68bc38a81922e8e828696c233b'

export const E0_APPROVAL_RATIFICATION_PAYLOAD = {
  sourcePacket: E0_RATIFICATION_SOURCE_PACKET,
  decisionRef: E0_RATIFICATION_DECISION_REF,
  reviewer: E0_RATIFICATION_REVIEWER,
  effectiveDate: E0_RATIFICATION_EFFECTIVE_DATE,
  currency: E0_RATIFICATION_CURRENCY,
  novelCostConditioning: 'SUCCESSFUL_50_CHAPTER_RUN' as const,
  ceilings: E0_RATIFICATION_CEILINGS,
}

export const E0_APPROVAL_ARTIFACT_HASH = computeSha256(stableStringify(E0_APPROVAL_RATIFICATION_PAYLOAD))

export function buildApprovedE0BudgetAuthority(): E0BudgetAuthority {
  return createE0BudgetAuthority({
    policyId: 'e0_loose_budget_v1',
    policyVersion: '1.0.0',
    currency: E0_RATIFICATION_CURRENCY,
    approvalStatus: 'APPROVED',
    reviewer: E0_RATIFICATION_REVIEWER,
    decisionRef: E0_RATIFICATION_DECISION_REF,
    effectiveDate: E0_RATIFICATION_EFFECTIVE_DATE,
    approvalArtifactHash: E0_APPROVAL_ARTIFACT_HASH,
    pricing: { policyVersion: 'pricing_v1', snapshotHash: contractPricingSnapshot().canonicalHash },
    measuredTokenEvidence: {
      schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1',
      observationSetVersion: E0_MEASURED_OBSERVATION_SET_VERSION,
    },
    retryFallbackPolicy: { policyId: 'retry_v1', policyVersion: '1.0.0', canonicalHash: 'a'.repeat(64) },
    productUnitEconomicsBasis: { basisId: 'lakoku_unit_economics_v1', basisVersion: '1.0.0' },
    ceilings: E0_RATIFICATION_CEILINGS,
  })
}
