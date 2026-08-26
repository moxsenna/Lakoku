import { describe, expect, it } from 'vitest'
import {
  aggregateReliabilityObservations,
  evaluateBudgetGate,
  evaluateEngineeringGate,
  runCumulativeModel,
  toCumulativeModelInput,
  type ModeledBudgetComparators,
  type ObservedBudgetComparators,
} from '../../lib/narrative-qa/reliability'
import {
  buildApprovedE0BudgetAuthority,
  E0_APPROVAL_ARTIFACT_HASH,
  E0_APPROVAL_RATIFICATION_PAYLOAD,
  E0_MEASURED_OBSERVATION_SET_VERSION,
  E0_RATIFICATION_CURRENCY,
  E0_RATIFICATION_DECISION_REF,
  E0_RATIFICATION_EFFECTIVE_DATE,
  E0_RATIFICATION_REVIEWER,
} from '../../fixtures/m10-e/e0-budget-authority'
import {
  buildModelInputRecordFixture,
  buildReliabilityObservationFixture,
  contractPricingSnapshot,
  FIXTURE_E0_AUTHORITY,
  fixtureStratum,
} from '../../fixtures/m10-e/reliability-contract-fixture'
import { buildSemanticPayloadFixture } from '../../fixtures/m10-e/reliability-contract-fixture'

const HEX64 = /^[0-9a-f]{64}$/
const MODEL_TIMEOUT = 600_000

/** Frozen counted modeled comparators (E3A/E4 counted pair, report lines 209-214). */
const COUNTED_MODELED = {
  maxExpectedCostPerChapter: '2.04001674',
  maxExpectedCostPerNovel: '102.50000000',
  maxJudgeEvaluationCostPerNovel: '2.40000000',
  maxRetryOverheadPercentage: '173.684249',
  combinedTotalNovelCostP95: '104.90000000',
} as const

interface DerivedComparators {
  modeled: ModeledBudgetComparators
  observed: ObservedBudgetComparators
}

let derivedCache: DerivedComparators | null = null

function deriveCountedComparators(): DerivedComparators {
  if (derivedCache !== null) return derivedCache
  const observations = buildReliabilityObservationFixture()
  const modelInput = toCumulativeModelInput(buildModelInputRecordFixture(observations))
  const modelOutput = runCumulativeModel(modelInput)
  const aggregate = aggregateReliabilityObservations(observations)
  derivedCache = {
    modeled: {
      maxExpectedCostPerChapter: modelOutput.result.maxExpectedCostPerChapter,
      maxExpectedCostPerNovel: modelOutput.result.successfulRunGenerationMean,
      maxJudgeEvaluationCostPerNovel: modelOutput.result.modeledJudgeTotal,
      maxRetryOverheadPercentage: modelOutput.result.modeledRetryOverheadPercentage,
      combinedTotalNovelCostP95: modelOutput.result.combinedTotalNovelCostP95,
    },
    observed: aggregate.observedCostComparators,
  }
  return derivedCache
}

function evaluatedWithApprovedAuthority() {
  return evaluateBudgetGate({
    e0Authority: buildApprovedE0BudgetAuthority(),
    currency: E0_RATIFICATION_CURRENCY,
    compatibleStratum: fixtureStratum(),
    modeledComparators: deriveCountedComparators().modeled,
    observedComparators: deriveCountedComparators().observed,
  })
}

describe('E0 ratified budget authority artifact', () => {
  it('binds the exact project-lead ratification and validates as APPROVED', () => {
    expect(E0_APPROVAL_RATIFICATION_PAYLOAD).toEqual({
      sourcePacket: 'M10E-E0-DECISION-PACKET.md',
      decisionRef: 'LAKOKU-E0-2026-08-26-LOOSE-200',
      reviewer: 'Lakoku Project Lead',
      effectiveDate: '2026-08-26',
      currency: 'USD',
      novelCostConditioning: 'SUCCESSFUL_50_CHAPTER_RUN',
      ceilings: {
        maxExpectedCostPerChapter: '2.04001674',
        maxExpectedCostPerNovel: '200.00000000',
        maxJudgeEvaluationCostPerNovel: '2.40000000',
        maxRetryOverheadPercentage: '173.684249',
        p95CostGuardrail: '200.00000000',
      },
    })
    expect(E0_APPROVAL_ARTIFACT_HASH).toMatch(HEX64)

    const authority = buildApprovedE0BudgetAuthority()
    expect(authority.approvalStatus).toBe('APPROVED')
    expect(authority.authorityVersion).toBe('M10_E_BUDGET_AUTHORITY_V1')
    expect(authority.reviewer).toBe(E0_RATIFICATION_REVIEWER)
    expect(authority.decisionRef).toBe(E0_RATIFICATION_DECISION_REF)
    expect(authority.effectiveDate).toBe(E0_RATIFICATION_EFFECTIVE_DATE)
    expect(authority.currency).toBe('USD')
    expect(authority.approvalArtifactHash).toBe(E0_APPROVAL_ARTIFACT_HASH)
    expect(authority.measuredTokenEvidence.observationSetVersion).toBe(E0_MEASURED_OBSERVATION_SET_VERSION)
    expect(authority.pricing.snapshotHash).toBe(contractPricingSnapshot().canonicalHash)
    expect(Object.isFrozen(authority)).toBe(true)
  })

  it('keeps the frozen contract fixture evidence blocked and untouched', () => {
    expect(FIXTURE_E0_AUTHORITY).toBeNull()
    const payload = buildSemanticPayloadFixture()
    expect(payload.budget.result.status).toBe('NOT_APPROVED_BLOCKED')
    expect(payload.budget.input.e0Authority).toBeNull()
    expect(payload.budget.input.currency).toBe('IDR')
  }, MODEL_TIMEOUT)
})

describe('E0 authority evaluation against the counted comparators', () => {
  it('reproduces the counted modeled comparators exactly', () => {
    const { modeled } = deriveCountedComparators()
    expect(modeled.maxExpectedCostPerChapter).toEqual({ state: 'PRESENT', value: COUNTED_MODELED.maxExpectedCostPerChapter })
    expect(modeled.maxExpectedCostPerNovel).toEqual({ state: 'PRESENT', value: COUNTED_MODELED.maxExpectedCostPerNovel })
    expect(modeled.maxJudgeEvaluationCostPerNovel).toEqual({ state: 'PRESENT', value: COUNTED_MODELED.maxJudgeEvaluationCostPerNovel })
    expect(modeled.maxRetryOverheadPercentage).toEqual({ state: 'PRESENT', value: COUNTED_MODELED.maxRetryOverheadPercentage })
    expect(modeled.combinedTotalNovelCostP95).toEqual({ state: 'PRESENT', value: COUNTED_MODELED.combinedTotalNovelCostP95 })
  }, MODEL_TIMEOUT)

  it('classifies the approved USD authority as APPROVED_EVALUATED bound to the fixture stratum', () => {
    const result = evaluatedWithApprovedAuthority()
    if (result.status !== 'APPROVED_EVALUATED') throw new Error(`unexpected ${result.status}: ${JSON.stringify(result, null, 2)}`)
    expect(result.status).toBe('APPROVED_EVALUATED')
    expect(result.authority.decisionRef).toBe(E0_RATIFICATION_DECISION_REF)
    expect(result.comparisons.map((comparison) => comparison.dimension)).toEqual([
      'MAX_EXPECTED_COST_PER_CHAPTER',
      'MAX_EXPECTED_COST_PER_NOVEL',
      'MAX_JUDGE_EVALUATION_COST_PER_NOVEL',
      'MAX_RETRY_OVERHEAD_PERCENTAGE',
      'COMBINED_TOTAL_NOVEL_COST_P95',
    ])
  })

  it('passes every modeled comparator including exact equalities, and records the honest chapter observed breach', () => {
    const result = evaluatedWithApprovedAuthority()
    if (result.status !== 'APPROVED_EVALUATED') throw new Error('unreachable')

    // Modeled (authoritative projections): all five within ceiling; chapter, judge, and retry are exact equalities.
    expect(result.budgetGate).toBe('FAIL')
    expect(result.error).toContain('MAX_EXPECTED_COST_PER_CHAPTER')

    const byDimension = new Map(result.comparisons.map((comparison) => [comparison.dimension, comparison]))
    const chapter = byDimension.get('MAX_EXPECTED_COST_PER_CHAPTER')!
    expect(chapter.ceiling).toBe('2.04001674')
    expect(chapter.modeled.outcome).toBe('PASS')
    expect(chapter.observed.value).toEqual({ state: 'PRESENT', value: '2.05000000' })
    expect(chapter.observed.outcome).toBe('FAIL')

    expect(byDimension.get('MAX_EXPECTED_COST_PER_NOVEL')!.modeled.outcome).toBe('PASS')
    expect(byDimension.get('MAX_EXPECTED_COST_PER_NOVEL')!.ceiling).toBe('200.00000000')

    const judge = byDimension.get('MAX_JUDGE_EVALUATION_COST_PER_NOVEL')!
    expect(judge.ceiling).toBe('2.40000000')
    expect(judge.modeled.outcome).toBe('PASS')
    expect(judge.observed.value).toEqual({ state: 'PRESENT', value: '2.40000000' })
    expect(judge.observed.outcome).toBe('PASS')

    const retry = byDimension.get('MAX_RETRY_OVERHEAD_PERCENTAGE')!
    expect(retry.ceiling).toBe('173.684249')
    expect(retry.modeled.outcome).toBe('PASS')
    expect(retry.observed.outcome).toBe('PASS')

    const p95 = byDimension.get('COMBINED_TOTAL_NOVEL_COST_P95')!
    expect(p95.applicability).toBe('REQUIRED')
    expect(p95.ceiling).toBe('200.00000000')
    expect(p95.modeled.outcome).toBe('PASS')
    expect(p95.observed.outcome).toBe('PASS')
  }, MODEL_TIMEOUT)

  it('keeps the engineering gate PASS with release HOLD while surfacing the evaluated budget verdict', () => {
    const payload = buildSemanticPayloadFixture()
    const budgetResult = evaluatedWithApprovedAuthority()
    const verdict = evaluateEngineeringGate({
      executionProfile: payload.executionProfile,
      evidence: { engineeringGate: 'PASS', reasonCodes: [] },
      modeledOutputPresent: true,
      modeledComparatorsComplete: true,
      sensitivityBandsComplete: true,
      modelRunDefect: null,
      budget: budgetResult,
      artifactPairValid: true,
      determinismVerified: true,
      e1E2ClosureRegression: false,
      requiredHumanAuthorityPresent: true,
    })
    expect(verdict.engineeringGate).toBe('PASS')
    expect(verdict.releaseReadiness).toBe('HOLD')
    expect(verdict.reasonCodes).toEqual([])
    expect(verdict.e0BudgetStatus).toBe('APPROVED_EVALUATED')
    expect(verdict.budgetGate).toBe('FAIL')
    // Closure remains a governance act recorded in the ledger, never an evaluator output.
    expect(verdict.closure).toEqual({ G2_BUDGET: 'OPEN', M10_E: 'OPEN' })
  }, MODEL_TIMEOUT)
})
