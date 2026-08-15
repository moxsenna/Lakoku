import { describe, expect, it } from 'vitest'
import {
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  createE0BudgetAuthority,
  evaluateBudgetGate,
  missingMeasurement,
  presentMeasurement,
  type BudgetGateInput,
  type CompatibleStratumIdentity,
  type E0BudgetAuthority,
  type MeasurementState,
} from '../../lib/narrative-qa/reliability'
import type { CanonicalDecimal } from '../../lib/narrative-qa/reliability'

type Money = CanonicalDecimal<'MONEY'>
type Percentage = CanonicalDecimal<'PERCENTAGE'>

const HASH = 'a'.repeat(64)
const CURRENCY = 'IDR'

function stratum(overrides: Partial<CompatibleStratumIdentity> = {}): CompatibleStratumIdentity {
  return {
    retryFallbackPolicyId: 'retry_v1',
    retryFallbackPolicyHash: HASH,
    topologyVersion: M10_E_TOPOLOGY_V1.authorityVersion,
    topologyHash: M10_E_TOPOLOGY_V1.canonicalHash,
    stageCatalogVersion: M10_E_STAGE_CATALOG_V1.authorityVersion,
    stageCatalogHash: M10_E_STAGE_CATALOG_V1.canonicalHash,
    taskMappingVersion: M10_E_TASK_MAPPING_V1.authorityVersion,
    taskMappingHash: M10_E_TASK_MAPPING_V1.canonicalHash,
    providerModelPolicyId: 'provider_v1',
    pricingPolicyVersion: 'pricing_v1',
    pricingSnapshotHash: HASH,
    ...overrides,
  }
}

function e0(overrides: Partial<Parameters<typeof createE0BudgetAuthority>[0]> = {}): E0BudgetAuthority {
  return createE0BudgetAuthority({
    policyId: 'e0_budget_v1',
    policyVersion: '1.0.0',
    currency: CURRENCY,
    approvalStatus: 'APPROVED',
    reviewer: 'reviewer-1',
    effectiveDate: '2026-08-01',
    approvalArtifactHash: HASH,
    pricing: { policyVersion: 'pricing_v1', snapshotHash: HASH },
    measuredTokenEvidence: { schemaVersion: 'token_v1', observationSetVersion: 'obs_v1' },
    retryFallbackPolicy: { policyId: 'retry_v1', policyVersion: '1.0.0', canonicalHash: HASH },
    productUnitEconomicsBasis: { basisId: 'unit_econ_v1', basisVersion: '1.0.0' },
    ceilings: {
      maxExpectedCostPerChapter: '1000.00000000',
      maxExpectedCostPerNovel: '10000.00000000',
      maxJudgeEvaluationCostPerNovel: '500.00000000',
      maxRetryOverheadPercentage: '200.000000',
      p95CostGuardrail: '15000.00000000',
    },
    ...overrides,
  })
}

function money(value: string): Money {
  return value as Money
}

function percentage(value: string): Percentage {
  return value as Percentage
}

function present<T>(value: T): MeasurementState<T> {
  return presentMeasurement(value)
}

function completeModeled(overrides: Partial<BudgetGateInput['modeledComparators']> = {}) {
  return {
    maxExpectedCostPerChapter: present<Money>(money('250.00000000')),
    maxExpectedCostPerNovel: present<Money>(money('250.00000000')),
    maxJudgeEvaluationCostPerNovel: present<Money>(money('60.00000000')),
    maxRetryOverheadPercentage: present<Percentage>(percentage('12.000000')),
    combinedTotalNovelCostP95: present<Money>(money('400.00000000')),
    ...overrides,
  }
}

function completeObserved(overrides: Partial<BudgetGateInput['observedComparators']> = {}) {
  return {
    maxObservedMeanGenerationCostPerChapter: { value: present<Money>(money('240.00000000')) },
    meanGenerationCostPerSuccessfulCompleteNovel: { value: present<Money>(money('240.00000000')) },
    observedJudgeCostMaximum: { value: present<Money>(money('60.00000000')) },
    observedRetryOverheadMaximum: { value: present<Percentage>(percentage('10.000000')) },
    observedCombinedNovelCostP95: { value: present<Money>(money('380.00000000')) },
    ...overrides,
  }
}

function input(overrides: Partial<BudgetGateInput> = {}): BudgetGateInput {
  const base: BudgetGateInput = {
    e0Authority: e0(),
    currency: CURRENCY,
    compatibleStratum: stratum(),
    modeledComparators: completeModeled(),
    observedComparators: completeObserved(),
  }
  return { ...base, ...overrides }
}

function expectBlocked(result: ReturnType<typeof evaluateBudgetGate>) {
  if (result.status !== 'NOT_APPROVED_BLOCKED') throw new Error('unreachable')
  expect(result.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
  return result
}

function expectInvalid(result: ReturnType<typeof evaluateBudgetGate>) {
  if (result.status !== 'SUPPLIED_E0_INVALID') throw new Error('unreachable')
  expect(result.budgetGate).toBe('FAIL')
  return result
}

function expectApproved(result: ReturnType<typeof evaluateBudgetGate>) {
  if (result.status !== 'APPROVED_EVALUATED') throw new Error('unreachable')
  return result
}

describe('E0 budget authority classification and budget gate', () => {
  it('classifies absent E0 authority as blocked with no comparisons', () => {
    const blocked = expectBlocked(evaluateBudgetGate({ ...input(), e0Authority: undefined }))
    expect(blocked.comparisons).toEqual([])
  })

  it('classifies null and structurally valid explicit non-approved statuses as blocked', () => {
    const nullBlocked = expectBlocked(evaluateBudgetGate({ ...input(), e0Authority: null }))
    expect(nullBlocked.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    const pending = expectBlocked(evaluateBudgetGate({ ...input(), e0Authority: e0({ approvalStatus: 'PENDING_REVIEW' }) }))
    expect(pending.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    expectBlocked(evaluateBudgetGate({ ...input(), e0Authority: e0({ approvalStatus: 'WITHDRAWN' }) }))
  })

  it('never normalizes supplied malformed E0 authority into blocked classification', () => {
    const malformed = expectInvalid(evaluateBudgetGate({ ...input(), e0Authority: { definitely: 'not-an-authority' } }))
    expect(malformed.error).toBeTruthy()
  })

  it('fails on canonical hash mismatch', () => {
    const authority = e0()
    const mutated = { ...authority, canonicalHash: 'b'.repeat(64) }
    expectInvalid(evaluateBudgetGate({ ...input(), e0Authority: mutated }))
  })

  it('fails on supplied superseded authority and on supersededBy reference', () => {
    expectInvalid(evaluateBudgetGate({ ...input(), e0Authority: e0({ approvalStatus: 'SUPERSEDED' }) }))
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: e0({ supersededBy: { policyId: 'e0_budget_v2', policyVersion: '2.0.0', canonicalHash: HASH } }),
    }))
  })

  it('fails on wrong novel cost conditioning', () => {
    const authority = e0()
    const mutated = { ...authority, novelCostConditioning: 'EVERY_STARTED_ATTEMPT' }
    expectInvalid(evaluateBudgetGate({ ...input(), e0Authority: mutated }))
  })

  it('fails when pricing binding does not match the compatible stratum', () => {
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: e0({ pricing: { policyVersion: 'pricing_v1', snapshotHash: 'b'.repeat(64) } }),
    }))
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: e0({ pricing: { policyVersion: 'pricing_v2', snapshotHash: HASH } }),
    }))
  })

  it('fails when retry/fallback policy binding does not match the compatible stratum', () => {
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: e0({ retryFallbackPolicy: { policyId: 'retry_v2', policyVersion: '1.0.0', canonicalHash: HASH } }),
    }))
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: e0({ retryFallbackPolicy: { policyId: 'retry_v1', policyVersion: '1.0.0', canonicalHash: 'b'.repeat(64) } }),
    }))
  })

  it('fails when E0 currency does not match the selected comparator currency', () => {
    expectInvalid(evaluateBudgetGate({ ...input(), e0Authority: e0({ currency: 'USD' }) }))
  })

  it('fails when measured token evidence or unit economics canonical hash is broken', () => {
    const authority = e0()
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: { ...authority, measuredTokenEvidence: { ...authority.measuredTokenEvidence, canonicalHash: 'b'.repeat(64) } },
    }))
    expectInvalid(evaluateBudgetGate({
      ...input(),
      e0Authority: { ...authority, productUnitEconomicsBasis: { ...authority.productUnitEconomicsBasis, canonicalHash: 'b'.repeat(64) } },
    }))
  })

  it('evaluates each modeled comparator with exact below, equal, and above semantics', () => {
    const below = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxExpectedCostPerChapter: present(money('999.99999999')) }) })))
    expect(below.budgetGate).toBe('PASS')

    const equal = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxExpectedCostPerChapter: present(money('1000.00000000')) }) })))
    expect(equal.budgetGate).toBe('PASS')

    const above = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxExpectedCostPerChapter: present(money('1000.00000001')) }) })))
    expect(above.budgetGate).toBe('FAIL')
    expect(above.error).toContain('MAX_EXPECTED_COST_PER_CHAPTER')
  })

  it('applies the same exact semantics to novel, judge, retry, and p95 modeled comparators', () => {
    const novelAbove = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxExpectedCostPerNovel: present(money('10000.00000001')) }) })))
    expect(novelAbove.budgetGate).toBe('FAIL')
    const judgeAbove = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxJudgeEvaluationCostPerNovel: present(money('500.00000001')) }) })))
    expect(judgeAbove.budgetGate).toBe('FAIL')
    const retryAbove = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxRetryOverheadPercentage: present(percentage('200.000001')) }) })))
    expect(retryAbove.budgetGate).toBe('FAIL')
    const p95Above = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ combinedTotalNovelCostP95: present(money('15000.00000001')) }) })))
    expect(p95Above.budgetGate).toBe('FAIL')
    const retryEqual = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxRetryOverheadPercentage: present(percentage('200.000000')) }) })))
    expect(retryEqual.budgetGate).toBe('PASS')
  })

  it('fails on observed expected-cost mean breach only with complete comparable observations; equality passes', () => {
    const breached = expectApproved(evaluateBudgetGate(input({
      observedComparators: completeObserved({ maxObservedMeanGenerationCostPerChapter: { value: present(money('1000.00000001')) } }),
    })))
    expect(breached.budgetGate).toBe('FAIL')
    const equal = expectApproved(evaluateBudgetGate(input({
      observedComparators: completeObserved({ maxObservedMeanGenerationCostPerChapter: { value: present(money('1000.00000000')) } }),
    })))
    expect(equal.budgetGate).toBe('PASS')
  })

  it('fails on observed judge maximum, retry overhead maximum, and p95 breach when complete', () => {
    const judge = expectApproved(evaluateBudgetGate(input({ observedComparators: completeObserved({ observedJudgeCostMaximum: { value: present(money('500.00000001')) } }) })))
    expect(judge.budgetGate).toBe('FAIL')
    const retry = expectApproved(evaluateBudgetGate(input({ observedComparators: completeObserved({ observedRetryOverheadMaximum: { value: present(percentage('200.000001')) } }) })))
    expect(retry.budgetGate).toBe('FAIL')
    const p95 = expectApproved(evaluateBudgetGate(input({ observedComparators: completeObserved({ observedCombinedNovelCostP95: { value: present(money('15000.00000001')) } }) })))
    expect(p95.budgetGate).toBe('FAIL')
  })

  it('treats absent observed comparators as not compared and still passes on complete modeled comparators', () => {
    const result = expectApproved(evaluateBudgetGate(input({ observedComparators: {
      maxObservedMeanGenerationCostPerChapter: { value: missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'no complete chapter observations') },
      meanGenerationCostPerSuccessfulCompleteNovel: { value: missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'no complete novel observations') },
      observedJudgeCostMaximum: { value: missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'no complete judge observations') },
      observedRetryOverheadMaximum: { value: missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'no complete retry observations') },
      observedCombinedNovelCostP95: { value: missingMeasurement('OBSERVATION_COVERAGE_INCOMPLETE', 'no complete combined observations') },
    } })))
    expect(result.budgetGate).toBe('PASS')
    expect(result.comparisons.every((comparison) => comparison.observed.outcome === 'NOT_COMPARED')).toBe(true)
  })

  it('marks the p95 dimension not applicable when the approved authority omits the guardrail', () => {
    const result = expectApproved(evaluateBudgetGate(input({ e0Authority: e0({ ceilings: {
      maxExpectedCostPerChapter: '1000.00000000',
      maxExpectedCostPerNovel: '10000.00000000',
      maxJudgeEvaluationCostPerNovel: '500.00000000',
      maxRetryOverheadPercentage: '200.000000',
    } }) })))
    expect(result.budgetGate).toBe('PASS')
    const p95 = result.comparisons.find((comparison) => comparison.dimension === 'COMBINED_TOTAL_NOVEL_COST_P95')
    expect(p95?.applicability).toBe('NOT_APPLICABLE')
  })

  it('never passes with a missing modeled comparator; reports the incomplete dimension', () => {
    const result = expectApproved(evaluateBudgetGate(input({ modeledComparators: completeModeled({ maxExpectedCostPerNovel: missingMeasurement('AUTHORITY_UNAVAILABLE', 'successful-novel mean not available') }) })))
    expect(result.budgetGate).toBe('FAIL')
    const novel = result.comparisons.find((comparison) => comparison.dimension === 'MAX_EXPECTED_COST_PER_NOVEL')
    expect(novel?.modeled.outcome).toBe('INCOMPLETE')
    expect(result.error).toContain('MAX_EXPECTED_COST_PER_NOVEL')
  })

  it('keeps started-attempt spend diagnostic and observed single-sample maxima out of budget comparisons', () => {
    const smuggled = input()
    const withDiagnostics = {
      ...smuggled,
      startedAttemptGenerationSpendDiagnostic: present(money('80000.00000000')),
      observedChapterSingleSampleMaximum: present(money('99999.00000000')),
    } as unknown as BudgetGateInput
    const result = expectApproved(evaluateBudgetGate(withDiagnostics))
    expect(result.budgetGate).toBe('PASS')
    expect(result.comparisons.map((comparison) => comparison.dimension)).toEqual([
      'MAX_EXPECTED_COST_PER_CHAPTER',
      'MAX_EXPECTED_COST_PER_NOVEL',
      'MAX_JUDGE_EVALUATION_COST_PER_NOVEL',
      'MAX_RETRY_OVERHEAD_PERCENTAGE',
      'COMBINED_TOTAL_NOVEL_COST_P95',
    ])
  })
})