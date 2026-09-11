import { describe, expect, it } from 'vitest'
import {
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  createE0BudgetAuthority,
  evaluateBudgetGate,
  evaluateEngineeringGate,
  missingMeasurement,
  presentMeasurement,
  type BudgetEvaluationResult,
  type CompatibleStratumIdentity,
  type EngineeringGateInput,
  type MeasurementState,
} from '../../lib/narrative-qa/reliability'
import type { CanonicalDecimal } from '../../lib/narrative-qa/reliability'

type Money = CanonicalDecimal<'MONEY'>
type Percentage = CanonicalDecimal<'PERCENTAGE'>

const HASH = 'a'.repeat(64)
const CURRENCY = 'IDR'

function stratum(): CompatibleStratumIdentity {
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
  }
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

function approvedBudget(): BudgetEvaluationResult {
  return evaluateBudgetGate({
    e0Authority: createE0BudgetAuthority({
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
    }),
    currency: CURRENCY,
    compatibleStratum: stratum(),
    modeledComparators: {
      maxExpectedCostPerChapter: present<Money>(money('250.00000000')),
      maxExpectedCostPerNovel: present<Money>(money('250.00000000')),
      maxJudgeEvaluationCostPerNovel: present<Money>(money('60.00000000')),
      maxRetryOverheadPercentage: present<Percentage>(percentage('12.000000')),
      combinedTotalNovelCostP95: present<Money>(money('400.00000000')),
    },
    observedComparators: {
      maxObservedMeanGenerationCostPerChapter: { value: present<Money>(money('240.00000000')) },
      meanGenerationCostPerSuccessfulCompleteNovel: { value: present<Money>(money('240.00000000')) },
      observedJudgeCostMaximum: { value: present<Money>(money('60.00000000')) },
      observedRetryOverheadMaximum: { value: present<Percentage>(percentage('10.000000')) },
      observedCombinedNovelCostP95: { value: present<Money>(money('380.00000000')) },
    },
  })
}

function blockedBudget(): BudgetEvaluationResult {
  return evaluateBudgetGate({
    e0Authority: undefined,
    currency: CURRENCY,
    compatibleStratum: stratum(),
    modeledComparators: {
      maxExpectedCostPerChapter: present<Money>(money('250.00000000')),
      maxExpectedCostPerNovel: present<Money>(money('250.00000000')),
      maxJudgeEvaluationCostPerNovel: present<Money>(money('60.00000000')),
      maxRetryOverheadPercentage: present<Percentage>(percentage('12.000000')),
      combinedTotalNovelCostP95: present<Money>(money('400.00000000')),
    },
    observedComparators: {
      maxObservedMeanGenerationCostPerChapter: { value: present<Money>(money('240.00000000')) },
      meanGenerationCostPerSuccessfulCompleteNovel: { value: present<Money>(money('240.00000000')) },
      observedJudgeCostMaximum: { value: present<Money>(money('60.00000000')) },
      observedRetryOverheadMaximum: { value: present<Percentage>(percentage('10.000000')) },
      observedCombinedNovelCostP95: { value: present<Money>(money('380.00000000')) },
    },
  })
}

function budgetWithBreach(): BudgetEvaluationResult {
  return evaluateBudgetGate({
    ...blockedBudgetInputBase(),
  })
}

function blockedBudgetInputBase() {
  return {
    e0Authority: createE0BudgetAuthority({
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
    }),
    currency: CURRENCY,
    compatibleStratum: stratum(),
    modeledComparators: {
      maxExpectedCostPerChapter: present<Money>(money('1000.00000001')),
      maxExpectedCostPerNovel: present<Money>(money('250.00000000')),
      maxJudgeEvaluationCostPerNovel: present<Money>(money('60.00000000')),
      maxRetryOverheadPercentage: present<Percentage>(percentage('12.000000')),
      combinedTotalNovelCostP95: present<Money>(money('400.00000000')),
    },
    observedComparators: {
      maxObservedMeanGenerationCostPerChapter: { value: present<Money>(money('240.00000000')) },
      meanGenerationCostPerSuccessfulCompleteNovel: { value: present<Money>(money('240.00000000')) },
      observedJudgeCostMaximum: { value: present<Money>(money('60.00000000')) },
      observedRetryOverheadMaximum: { value: present<Percentage>(percentage('10.000000')) },
      observedCombinedNovelCostP95: { value: present<Money>(money('380.00000000')) },
    },
  }
}

function verdict(input: Partial<EngineeringGateInput> = {}) {
  const base: EngineeringGateInput = {
    executionProfile: 'CONTRACT_FIXTURE',
    evidence: { engineeringGate: 'PASS', reasonCodes: [] },
    modeledOutputPresent: true,
    modeledComparatorsComplete: true,
    sensitivityBandsComplete: true,
    modelRunDefect: null,
    budget: blockedBudget(),
    artifactPairValid: true,
    determinismVerified: true,
    e1E2ClosureRegression: false,
    requiredHumanAuthorityPresent: true,
  }
  return evaluateEngineeringGate({ ...base, ...input })
}

describe('engineering gate precedence and fixture mapping', () => {
  it('maps complete valid fixture evidence to engineering PASS with release HOLD and blocked budget', () => {
    const result = verdict()
    expect(result.engineeringGate).toBe('PASS')
    expect(result.releaseReadiness).toBe('HOLD')
    expect(result.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    expect(result.e0BudgetStatus).toBe('NOT_APPROVED_BLOCKED')
    expect(result.reasonCodes).toEqual([])
    expect(result.error).toBeNull()
  })

  it('never maps any engineering outcome to release readiness READY', () => {
    expect(verdict().releaseReadiness).toBe('HOLD')
    const releasePass = verdict({ executionProfile: 'RELEASE_EVIDENCE' })
    expect(releasePass.releaseReadiness).toBe('HOLD')
    const hold = verdict({ evidence: { engineeringGate: 'HOLD', reasonCodes: ['STAGE_POOL_THRESHOLD_NOT_MET'] } })
    expect(hold.releaseReadiness).toBe('HOLD')
    const fail = verdict({ evidence: { engineeringGate: 'FAIL', reasonCodes: ['MALFORMED_EVIDENCE'] } })
    expect(fail.releaseReadiness).toBe('BLOCKED')
  })

  it('never closes G2-BUDGET or M10-E on any verdict', () => {
    const results = [
      verdict(),
      verdict({ budget: approvedBudget() }),
      verdict({ evidence: { engineeringGate: 'FAIL', reasonCodes: ['DUPLICATE_PUBLICATION_DETECTED'] } }),
    ]
    for (const result of results) {
      expect(result.closure.G2_BUDGET).toBe('OPEN')
      expect(result.closure.M10_E).toBe('OPEN')
    }
  })

  it('holds release threshold gaps while fixture engineering may still be complete', () => {
    const result = verdict({
      executionProfile: 'RELEASE_EVIDENCE',
      evidence: { engineeringGate: 'HOLD', reasonCodes: ['STAGE_POOL_THRESHOLD_NOT_MET', 'COMPLETE_NOVEL_THRESHOLD_NOT_MET'] },
    })
    expect(result.engineeringGate).toBe('HOLD')
    expect(result.reasonCodes).toEqual(['PROFILE_THRESHOLD_NOT_MET'])
    expect(result.releaseReadiness).toBe('HOLD')
  })

  it('fails on safety-counter breach from duplicate publication or canonical corruption', () => {
    const duplicate = verdict({ evidence: { engineeringGate: 'FAIL', reasonCodes: ['DUPLICATE_PUBLICATION_DETECTED'] } })
    expect(duplicate.engineeringGate).toBe('FAIL')
    expect(duplicate.reasonCodes).toEqual(['SAFETY_COUNTER_BREACH'])
    expect(duplicate.releaseReadiness).toBe('BLOCKED')
    const corruption = verdict({ evidence: { engineeringGate: 'FAIL', reasonCodes: ['CANONICAL_CORRUPTION_DETECTED'] } })
    expect(corruption.reasonCodes).toEqual(['SAFETY_COUNTER_BREACH'])
  })

  it('fails on malformed evidence with the evidence error surfaced', () => {
    const result = verdict({ evidence: { engineeringGate: 'FAIL', reasonCodes: ['MALFORMED_EVIDENCE'], error: 'Cannot parse observation set' } })
    expect(result.engineeringGate).toBe('FAIL')
    expect(result.reasonCodes).toEqual(['MALFORMED_EVIDENCE'])
    expect(result.error).toBe('Cannot parse observation set')
  })

  it('fails on E1/E2 closure regression', () => {
    const result = verdict({ e1E2ClosureRegression: true })
    expect(result.engineeringGate).toBe('FAIL')
    expect(result.reasonCodes).toEqual(['E1_E2_CLOSURE_REGRESSION'])
  })

  it('classifies missing exchangeability authority as FAIL, never HOLD', () => {
    const result = verdict({ modelRunDefect: 'Missing exchangeability authority for PROSE_PRIMARY' })
    expect(result.engineeringGate).toBe('FAIL')
    expect(result.reasonCodes).toEqual(['SEMANTIC_IDENTITY_CONFLICT'])
  })

  it('classifies authority hash defects from the model run as FAIL', () => {
    const result = verdict({ modelRunDefect: 'Stratum stage catalog identity does not match frozen V1 authority' })
    expect(result.engineeringGate).toBe('FAIL')
    expect(result.reasonCodes).toEqual(['SEMANTIC_IDENTITY_CONFLICT'])
  })

  it('fails on supplied invalid E0 authority and never collapses it into blocked classification', () => {
    const result = verdict({ budget: { status: 'SUPPLIED_E0_INVALID' as const, budgetGate: 'FAIL' as const, error: 'Canonical E0 authority hash mismatch' } })
    expect(result.engineeringGate).toBe('FAIL')
    expect(result.reasonCodes).toEqual(['AUTHORITY_HASH_MISMATCH'])
    expect(result.budgetGate).toBe('FAIL')
  })

  it('fails on determinism mismatch and artifact pair mismatch', () => {
    const determinism = verdict({ determinismVerified: false })
    expect(determinism.engineeringGate).toBe('FAIL')
    expect(determinism.reasonCodes).toEqual(['NON_DETERMINISTIC_MODEL_OUTPUT'])
    const artifact = verdict({ artifactPairValid: false })
    expect(artifact.engineeringGate).toBe('FAIL')
    expect(artifact.reasonCodes).toEqual(['ARTIFACT_PAIR_MISMATCH'])
  })

  it('holds when the model output or modeled comparators are unavailable', () => {
    const noModel = verdict({ modeledOutputPresent: false })
    expect(noModel.engineeringGate).toBe('HOLD')
    expect(noModel.reasonCodes).toEqual(['MODEL_UNAVAILABLE'])
    const incomplete = verdict({ modeledComparatorsComplete: false })
    expect(incomplete.engineeringGate).toBe('HOLD')
    expect(incomplete.reasonCodes).toEqual(['MISSING_MEASUREMENT'])
  })

  it('holds when determinism or artifact verification has not yet run', () => {
    const determinism = verdict({ determinismVerified: null })
    expect(determinism.engineeringGate).toBe('HOLD')
    expect(determinism.reasonCodes).toEqual(['DETERMINISM_UNVERIFIED'])
    const artifact = verdict({ artifactPairValid: null })
    expect(artifact.engineeringGate).toBe('HOLD')
    expect(artifact.reasonCodes).toEqual(['ARTIFACT_PAIR_UNAVAILABLE'])
  })

  it('holds when required human authority is absent', () => {
    const result = verdict({ requiredHumanAuthorityPresent: false })
    expect(result.engineeringGate).toBe('HOLD')
    expect(result.reasonCodes).toEqual(['HUMAN_AUTHORITY_UNAVAILABLE'])
  })

  it('gives defect reasons precedence over hold reasons', () => {
    const result = verdict({
      evidence: { engineeringGate: 'HOLD', reasonCodes: ['STAGE_POOL_THRESHOLD_NOT_MET'] },
      modelRunDefect: 'Missing exchangeability authority for PROSE_PRIMARY',
      modeledOutputPresent: false,
      determinismVerified: null,
    })
    expect(result.engineeringGate).toBe('FAIL')
    expect(result.reasonCodes).toEqual(['SEMANTIC_IDENTITY_CONFLICT'])
  })

  it('keeps approved budget evaluation independent from engineering PASS and fails on ceiling breach', () => {
    const breached = budgetWithBreach()
    expect(breached.budgetGate).toBe('FAIL')
    const result = verdict({ budget: breached })
    expect(result.engineeringGate).toBe('PASS')
    expect(result.budgetGate).toBe('FAIL')
    expect(result.e0BudgetStatus).toBe('APPROVED_EVALUATED')
    expect(result.comparisons.length).toBeGreaterThan(0)
  })

  it('reports engineering HOLD with budget FAIL when a modeled comparator is incomplete', () => {
    const incomplete = evaluateBudgetGate({
      ...blockedBudgetInputBase(),
      modeledComparators: {
        maxExpectedCostPerChapter: present<Money>(money('250.00000000')),
        maxExpectedCostPerNovel: missingMeasurement('AUTHORITY_UNAVAILABLE', 'successful-novel mean not available'),
        maxJudgeEvaluationCostPerNovel: present<Money>(money('60.00000000')),
        maxRetryOverheadPercentage: present<Percentage>(percentage('12.000000')),
        combinedTotalNovelCostP95: present<Money>(money('400.00000000')),
      },
    })
    expect(incomplete.budgetGate).toBe('FAIL')
    const result = verdict({ budget: incomplete })
    expect(result.engineeringGate).toBe('HOLD')
    expect(result.reasonCodes).toContain('MISSING_MEASUREMENT')
    expect(result.budgetGate).toBe('FAIL')
  })

  it('keeps engineering PASS while the budget stays blocked without an E0 authority', () => {
    const result = verdict()
    expect(result.engineeringGate).toBe('PASS')
    expect(result.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    expect(result.e0BudgetStatus).toBe('NOT_APPROVED_BLOCKED')
  })

  it('passes engineering with fully evaluated approved budget under every ceiling', () => {
    const result = verdict({ budget: approvedBudget() })
    expect(result.engineeringGate).toBe('PASS')
    expect(result.budgetGate).toBe('PASS')
    expect(result.e0BudgetStatus).toBe('APPROVED_EVALUATED')
    expect(result.error).toBeNull()
  })
})