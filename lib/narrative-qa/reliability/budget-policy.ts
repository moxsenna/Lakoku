import { z } from 'zod'
import {
  SAFE_ALIAS_SCHEMA,
  SHA256_SCHEMA,
  canonicalAuthorityHash,
  type CompatibleStratumIdentity,
  type MeasurementState,
} from './contracts'
import { canonicalizeDecimal, compareDecimals, type CanonicalDecimal } from './decimal'
import { missingMeasurement } from './contracts'

const AUTHORITY_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
const CURRENCY_SCHEMA = z.string().regex(/^[A-Z]{3}$/)
const EFFECTIVE_DATE_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const CANONICAL_MONEY_SCHEMA = z.string().regex(/^(0|[1-9][0-9]*)\.\d{8}$/)
const CANONICAL_PERCENTAGE_SCHEMA = z.string().regex(/^(0|[1-9][0-9]*)\.\d{6}$/)

export const E0_BUDGET_AUTHORITY_VERSION = 'M10_E_BUDGET_AUTHORITY_V1'
export const E0_NOVEL_COST_CONDITIONING = 'SUCCESSFUL_50_CHAPTER_RUN'

export const E0_APPROVAL_STATUSES = ['APPROVED', 'PENDING_REVIEW', 'WITHDRAWN', 'SUPERSEDED', 'REJECTED'] as const
export type E0ApprovalStatus = (typeof E0_APPROVAL_STATUSES)[number]

export const BUDGET_DIMENSION_IDS = [
  'MAX_EXPECTED_COST_PER_CHAPTER',
  'MAX_EXPECTED_COST_PER_NOVEL',
  'MAX_JUDGE_EVALUATION_COST_PER_NOVEL',
  'MAX_RETRY_OVERHEAD_PERCENTAGE',
  'COMBINED_TOTAL_NOVEL_COST_P95',
] as const
export type BudgetDimensionId = (typeof BUDGET_DIMENSION_IDS)[number]

type Money = CanonicalDecimal<'MONEY'>
type Percentage = CanonicalDecimal<'PERCENTAGE'>

const E0_REF_SCHEMA = z.strictObject({
  policyId: SAFE_ALIAS_SCHEMA,
  policyVersion: z.string().min(1),
  canonicalHash: SHA256_SCHEMA,
})

const E0_BUDGET_AUTHORITY_SCHEMA = z.strictObject({
  authorityVersion: z.literal(E0_BUDGET_AUTHORITY_VERSION),
  policyId: SAFE_ALIAS_SCHEMA,
  policyVersion: z.string().min(1),
  currency: CURRENCY_SCHEMA,
  approvalStatus: z.enum(E0_APPROVAL_STATUSES),
  reviewer: z.string().min(1),
  decisionRef: z.string().min(1),
  effectiveDate: EFFECTIVE_DATE_SCHEMA,
  approvalArtifactHash: SHA256_SCHEMA,
  supersedes: E0_REF_SCHEMA.optional(),
  supersededBy: E0_REF_SCHEMA.optional(),
  pricing: z.strictObject({
    policyVersion: z.string().min(1),
    snapshotHash: SHA256_SCHEMA,
  }),
  measuredTokenEvidence: z.strictObject({
    schemaVersion: z.string().min(1),
    observationSetVersion: z.string().min(1),
    canonicalHash: SHA256_SCHEMA,
  }),
  retryFallbackPolicy: E0_REF_SCHEMA,
  productUnitEconomicsBasis: z.strictObject({
    basisId: SAFE_ALIAS_SCHEMA,
    basisVersion: z.string().min(1),
    canonicalHash: SHA256_SCHEMA,
  }),
  novelCostConditioning: z.literal(E0_NOVEL_COST_CONDITIONING),
  ceilings: z.strictObject({
    maxExpectedCostPerChapter: CANONICAL_MONEY_SCHEMA,
    maxExpectedCostPerNovel: CANONICAL_MONEY_SCHEMA,
    maxJudgeEvaluationCostPerNovel: CANONICAL_MONEY_SCHEMA,
    maxRetryOverheadPercentage: CANONICAL_PERCENTAGE_SCHEMA,
    p95CostGuardrail: CANONICAL_MONEY_SCHEMA.optional(),
  }),
  canonicalHash: SHA256_SCHEMA,
}).superRefine(verifyE0AuthorityHash)

export interface E0BudgetAuthority {
  readonly authorityVersion: 'M10_E_BUDGET_AUTHORITY_V1'
  readonly policyId: string
  readonly policyVersion: string
  readonly currency: string
  readonly approvalStatus: E0ApprovalStatus
  readonly reviewer: string
  readonly decisionRef: string
  readonly effectiveDate: string
  readonly approvalArtifactHash: string
  readonly supersedes?: Readonly<{ policyId: string; policyVersion: string; canonicalHash: string }>
  readonly supersededBy?: Readonly<{ policyId: string; policyVersion: string; canonicalHash: string }>
  readonly pricing: Readonly<{ policyVersion: string; snapshotHash: string }>
  readonly measuredTokenEvidence: Readonly<{ schemaVersion: string; observationSetVersion: string; canonicalHash: string }>
  readonly retryFallbackPolicy: Readonly<{ policyId: string; policyVersion: string; canonicalHash: string }>
  readonly productUnitEconomicsBasis: Readonly<{ basisId: string; basisVersion: string; canonicalHash: string }>
  readonly novelCostConditioning: 'SUCCESSFUL_50_CHAPTER_RUN'
  readonly ceilings: Readonly<{
    maxExpectedCostPerChapter: Money
    maxExpectedCostPerNovel: Money
    maxJudgeEvaluationCostPerNovel: Money
    maxRetryOverheadPercentage: Percentage
    p95CostGuardrail?: Money
  }>
  readonly canonicalHash: string
}

function verifyE0AuthorityHash(value: { canonicalHash: string }, context: z.RefinementCtx): void {
  if (canonicalAuthorityHash(value) !== value.canonicalHash) {
    context.addIssue({ code: 'custom', message: 'Canonical E0 authority hash mismatch', path: ['canonicalHash'] })
  }
}

export function createE0BudgetAuthority(params: {
  policyId: string
  policyVersion: string
  currency: string
  approvalStatus: E0ApprovalStatus
  reviewer: string
  effectiveDate: string
  approvalArtifactHash: string
  supersedes?: Readonly<{ policyId: string; policyVersion: string; canonicalHash: string }>
  supersededBy?: Readonly<{ policyId: string; policyVersion: string; canonicalHash: string }>
  pricing: Readonly<{ policyVersion: string; snapshotHash: string }>
  measuredTokenEvidence: Readonly<{ schemaVersion: string; observationSetVersion: string }>
  retryFallbackPolicy: Readonly<{ policyId: string; policyVersion: string; canonicalHash: string }>
  productUnitEconomicsBasis: Readonly<{ basisId: string; basisVersion: string }>
  ceilings: Readonly<{
    maxExpectedCostPerChapter: string
    maxExpectedCostPerNovel: string
    maxJudgeEvaluationCostPerNovel: string
    maxRetryOverheadPercentage: string
    p95CostGuardrail?: string
  }>
  decisionRef?: string
}): E0BudgetAuthority {
  const ceilings = {
    maxExpectedCostPerChapter: canonicalizeDecimal(params.ceilings.maxExpectedCostPerChapter, 'MONEY'),
    maxExpectedCostPerNovel: canonicalizeDecimal(params.ceilings.maxExpectedCostPerNovel, 'MONEY'),
    maxJudgeEvaluationCostPerNovel: canonicalizeDecimal(params.ceilings.maxJudgeEvaluationCostPerNovel, 'MONEY'),
    maxRetryOverheadPercentage: canonicalizeDecimal(params.ceilings.maxRetryOverheadPercentage, 'PERCENTAGE'),
    ...(params.ceilings.p95CostGuardrail === undefined
      ? {}
      : { p95CostGuardrail: canonicalizeDecimal(params.ceilings.p95CostGuardrail, 'MONEY') }),
  }
  const measuredTokenEvidence = {
    schemaVersion: params.measuredTokenEvidence.schemaVersion,
    observationSetVersion: params.measuredTokenEvidence.observationSetVersion,
    canonicalHash: canonicalAuthorityHash({
      schemaVersion: params.measuredTokenEvidence.schemaVersion,
      observationSetVersion: params.measuredTokenEvidence.observationSetVersion,
    }),
  }
  const productUnitEconomicsBasis = {
    basisId: params.productUnitEconomicsBasis.basisId,
    basisVersion: params.productUnitEconomicsBasis.basisVersion,
    canonicalHash: canonicalAuthorityHash({
      basisId: params.productUnitEconomicsBasis.basisId,
      basisVersion: params.productUnitEconomicsBasis.basisVersion,
    }),
  }
  const payload = {
    authorityVersion: 'M10_E_BUDGET_AUTHORITY_V1' as const,
    policyId: params.policyId,
    policyVersion: params.policyVersion,
    currency: params.currency,
    approvalStatus: params.approvalStatus,
    reviewer: params.reviewer,
    decisionRef: params.decisionRef ?? AUTHORITY_DECISION_REF,
    effectiveDate: params.effectiveDate,
    approvalArtifactHash: params.approvalArtifactHash,
    ...(params.supersedes === undefined ? {} : { supersedes: params.supersedes }),
    ...(params.supersededBy === undefined ? {} : { supersededBy: params.supersededBy }),
    pricing: params.pricing,
    measuredTokenEvidence,
    retryFallbackPolicy: params.retryFallbackPolicy,
    productUnitEconomicsBasis,
    novelCostConditioning: 'SUCCESSFUL_50_CHAPTER_RUN' as const,
    ceilings,
  }
  return validateE0BudgetAuthority({
    ...payload,
    canonicalHash: canonicalAuthorityHash(payload),
  })
}

export function validateE0BudgetAuthority(value: unknown): E0BudgetAuthority {
  const parsed = E0_BUDGET_AUTHORITY_SCHEMA.parse(value)
  assertCanonicalCeiling(parsed.ceilings.maxExpectedCostPerChapter, 'MONEY', 'maxExpectedCostPerChapter')
  assertCanonicalCeiling(parsed.ceilings.maxExpectedCostPerNovel, 'MONEY', 'maxExpectedCostPerNovel')
  assertCanonicalCeiling(parsed.ceilings.maxJudgeEvaluationCostPerNovel, 'MONEY', 'maxJudgeEvaluationCostPerNovel')
  assertCanonicalCeiling(parsed.ceilings.maxRetryOverheadPercentage, 'PERCENTAGE', 'maxRetryOverheadPercentage')
  if (parsed.ceilings.p95CostGuardrail !== undefined) {
    assertCanonicalCeiling(parsed.ceilings.p95CostGuardrail, 'MONEY', 'p95CostGuardrail')
  }
  if (canonicalAuthorityHash(parsed.measuredTokenEvidence) !== parsed.measuredTokenEvidence.canonicalHash) {
    throw new Error('Measured token-evidence canonical hash mismatch')
  }
  if (canonicalAuthorityHash(parsed.productUnitEconomicsBasis) !== parsed.productUnitEconomicsBasis.canonicalHash) {
    throw new Error('Product unit-economics basis canonical hash mismatch')
  }
  return deepFreeze(parsed) as E0BudgetAuthority
}

function assertCanonicalCeiling<D extends 'MONEY' | 'PERCENTAGE'>(value: string, domain: D, label: string): void {
  const canonical = canonicalizeDecimal(value, domain)
  if (canonical !== value) throw new Error(`E0 ceiling ${label} must be canonical scale ${domain === 'MONEY' ? 8 : 6}`)
}

export interface ModeledBudgetComparators {
  readonly maxExpectedCostPerChapter: MeasurementState<Money>
  readonly maxExpectedCostPerNovel: MeasurementState<Money>
  readonly maxJudgeEvaluationCostPerNovel: MeasurementState<Money>
  readonly maxRetryOverheadPercentage: MeasurementState<Percentage>
  readonly combinedTotalNovelCostP95: MeasurementState<Money>
}

export type ObservedBudgetComparatorValue<T> = Readonly<{ value: MeasurementState<T> }>

export interface ObservedBudgetComparators {
  readonly maxObservedMeanGenerationCostPerChapter: ObservedBudgetComparatorValue<Money>
  readonly meanGenerationCostPerSuccessfulCompleteNovel: ObservedBudgetComparatorValue<Money>
  readonly observedJudgeCostMaximum: ObservedBudgetComparatorValue<Money>
  readonly observedRetryOverheadMaximum: ObservedBudgetComparatorValue<Percentage>
  readonly observedCombinedNovelCostP95: ObservedBudgetComparatorValue<Money>
}

export interface BudgetGateInput {
  readonly e0Authority: unknown
  readonly currency: string
  readonly compatibleStratum: CompatibleStratumIdentity
  readonly modeledComparators: ModeledBudgetComparators
  readonly observedComparators: ObservedBudgetComparators
}

export interface BudgetComparison {
  readonly dimension: BudgetDimensionId
  readonly applicability: 'REQUIRED' | 'NOT_APPLICABLE'
  readonly ceiling: CanonicalDecimal | null
  readonly modeled: Readonly<{ value: MeasurementState<CanonicalDecimal>; outcome: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'NOT_APPLICABLE' }>
  readonly observed: Readonly<{ value: MeasurementState<CanonicalDecimal>; outcome: 'PASS' | 'FAIL' | 'NOT_COMPARED' | 'NOT_APPLICABLE' }>
}

export type BudgetEvaluationResult = Readonly<
  | { status: 'NOT_APPROVED_BLOCKED'; budgetGate: 'BLOCKED_E0_COST_CEILING_NOT_APPROVED'; comparisons: readonly [] }
  | { status: 'SUPPLIED_E0_INVALID'; budgetGate: 'FAIL'; error: string }
  | {
    status: 'APPROVED_EVALUATED'
    budgetGate: 'PASS' | 'FAIL'
    error: string | null
    authority: E0BudgetAuthority
    comparisons: readonly BudgetComparison[]
  }
>

export function evaluateBudgetGate(input: BudgetGateInput): BudgetEvaluationResult {
  if (input.e0Authority === undefined || input.e0Authority === null) {
    return deepFreeze({ status: 'NOT_APPROVED_BLOCKED' as const, budgetGate: 'BLOCKED_E0_COST_CEILING_NOT_APPROVED' as const, comparisons: [] })
  }
  let authority: E0BudgetAuthority
  try {
    authority = validateE0BudgetAuthority(input.e0Authority)
  } catch (error) {
    return deepFreeze({ status: 'SUPPLIED_E0_INVALID' as const, budgetGate: 'FAIL' as const, error: error instanceof Error ? error.message : 'Malformed E0 budget authority' })
  }
  try {
    assertCurrentAuthority(authority, input)
  } catch (error) {
    return deepFreeze({ status: 'SUPPLIED_E0_INVALID' as const, budgetGate: 'FAIL' as const, error: error instanceof Error ? error.message : 'Unverifiable E0 budget authority bindings' })
  }
  if (authority.approvalStatus !== 'APPROVED') {
    return deepFreeze({ status: 'NOT_APPROVED_BLOCKED' as const, budgetGate: 'BLOCKED_E0_COST_CEILING_NOT_APPROVED' as const, comparisons: [] })
  }
  const comparisons = evaluateComparators(authority, input)
  let budgetGate: 'PASS' | 'FAIL' = 'PASS'
  let error: string | null = null
  for (const comparison of comparisons) {
    if (comparison.applicability === 'NOT_APPLICABLE') continue
    if (comparison.modeled.outcome === 'INCOMPLETE') {
      budgetGate = 'FAIL'
      error = `Modeled comparator ${comparison.dimension} is incomplete`
      break
    }
    if (comparison.modeled.outcome === 'FAIL' || comparison.observed.outcome === 'FAIL') {
      budgetGate = 'FAIL'
      error = `Budget comparator ${comparison.dimension} exceeds its approved ceiling`
      break
    }
  }
  return deepFreeze({ status: 'APPROVED_EVALUATED' as const, budgetGate, error, authority, comparisons })
}

function assertCurrentAuthority(authority: E0BudgetAuthority, input: BudgetGateInput): void {
  if (authority.approvalStatus === 'SUPERSEDED' || authority.supersededBy !== undefined) {
    throw new Error('Supplied E0 budget authority is superseded and cannot be the current authority')
  }
  if (authority.pricing.snapshotHash !== input.compatibleStratum.pricingSnapshotHash
    || authority.pricing.policyVersion !== input.compatibleStratum.pricingPolicyVersion) {
    throw new Error('E0 pricing binding does not match the compatible pricing authority')
  }
  if (authority.retryFallbackPolicy.policyId !== input.compatibleStratum.retryFallbackPolicyId
    || authority.retryFallbackPolicy.canonicalHash !== input.compatibleStratum.retryFallbackPolicyHash) {
    throw new Error('E0 retry/fallback policy binding does not match the compatible stratum')
  }
  if (authority.currency !== input.currency) {
    throw new Error('E0 currency does not match the selected comparator currency')
  }
}

function evaluateComparators(authority: E0BudgetAuthority, input: BudgetGateInput): BudgetComparison[] {
  const evaluatePair = (
    dimension: BudgetDimensionId,
    ceiling: CanonicalDecimal,
    domain: 'MONEY' | 'PERCENTAGE',
    modeled: MeasurementState<CanonicalDecimal>,
    observed: MeasurementState<CanonicalDecimal>,
  ): BudgetComparison => ({
    dimension,
    applicability: 'REQUIRED' as const,
    ceiling,
    modeled: { value: modeled, outcome: modeled.state === 'PRESENT'
      ? compareDecimals(modeled.value, ceiling as CanonicalDecimal<typeof domain>, domain) <= 0 ? 'PASS' as const : 'FAIL' as const
      : modeled.state === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' as const : 'INCOMPLETE' as const },
    observed: { value: observed, outcome: observed.state === 'PRESENT'
      ? compareDecimals(observed.value, ceiling as CanonicalDecimal<typeof domain>, domain) <= 0 ? 'PASS' as const : 'FAIL' as const
      : 'NOT_COMPARED' as const },
  })

  const comparisons: BudgetComparison[] = [
    evaluatePair('MAX_EXPECTED_COST_PER_CHAPTER', authority.ceilings.maxExpectedCostPerChapter, 'MONEY',
      input.modeledComparators.maxExpectedCostPerChapter,
      input.observedComparators.maxObservedMeanGenerationCostPerChapter.value),
    evaluatePair('MAX_EXPECTED_COST_PER_NOVEL', authority.ceilings.maxExpectedCostPerNovel, 'MONEY',
      input.modeledComparators.maxExpectedCostPerNovel,
      input.observedComparators.meanGenerationCostPerSuccessfulCompleteNovel.value),
    evaluatePair('MAX_JUDGE_EVALUATION_COST_PER_NOVEL', authority.ceilings.maxJudgeEvaluationCostPerNovel, 'MONEY',
      input.modeledComparators.maxJudgeEvaluationCostPerNovel,
      input.observedComparators.observedJudgeCostMaximum.value),
    evaluatePair('MAX_RETRY_OVERHEAD_PERCENTAGE', authority.ceilings.maxRetryOverheadPercentage, 'PERCENTAGE',
      input.modeledComparators.maxRetryOverheadPercentage,
      input.observedComparators.observedRetryOverheadMaximum.value),
  ]
  const p95Ceiling = authority.ceilings.p95CostGuardrail
  comparisons.push(p95Ceiling === undefined
    ? {
      dimension: 'COMBINED_TOTAL_NOVEL_COST_P95',
      applicability: 'NOT_APPLICABLE' as const,
      ceiling: null,
      modeled: { value: missingMeasurement<CanonicalDecimal>('AUTHORITY_UNAVAILABLE', 'P95 guardrail omitted by approved E0 authority'), outcome: 'NOT_APPLICABLE' as const },
      observed: { value: missingMeasurement<CanonicalDecimal>('AUTHORITY_UNAVAILABLE', 'P95 guardrail omitted by approved E0 authority'), outcome: 'NOT_APPLICABLE' as const },
    }
    : evaluatePair('COMBINED_TOTAL_NOVEL_COST_P95', p95Ceiling, 'MONEY',
      input.modeledComparators.combinedTotalNovelCostP95,
      input.observedComparators.observedCombinedNovelCostP95.value))

  return comparisons.map((comparison) => deepFreeze(comparison))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}