import {
  type BudgetGate,
  type ExecutionProfile,
  type ReleaseReadiness,
} from './contracts'
import type { P4EngineeringReason } from './aggregation'
import type { BudgetComparison, BudgetEvaluationResult } from './budget-policy'

export const ENGINEERING_GATE_DEFECT_REASONS = [
  'MALFORMED_EVIDENCE',
  'AUTHORITY_HASH_MISMATCH',
  'SEMANTIC_IDENTITY_CONFLICT',
  'DECIMAL_COEFFICIENT_OVERFLOW',
  'PROVENANCE_VIOLATION',
  'SAFETY_COUNTER_BREACH',
  'NON_DETERMINISTIC_MODEL_OUTPUT',
  'ARTIFACT_PAIR_MISMATCH',
  'SUPPLIED_E0_AUTHORITY_INVALID',
  'E1_E2_CLOSURE_REGRESSION',
] as const
export type EngineeringGateDefectReason = (typeof ENGINEERING_GATE_DEFECT_REASONS)[number]

export const ENGINEERING_GATE_HOLD_REASONS = [
  'MISSING_MEASUREMENT',
  'MODEL_UNAVAILABLE',
  'PROFILE_THRESHOLD_NOT_MET',
  'ARTIFACT_PAIR_UNAVAILABLE',
  'DETERMINISM_UNVERIFIED',
  'HUMAN_AUTHORITY_UNAVAILABLE',
] as const
export type EngineeringGateHoldReason = (typeof ENGINEERING_GATE_HOLD_REASONS)[number]

export type EngineeringGateReason = EngineeringGateDefectReason | EngineeringGateHoldReason

export interface EngineeringGateInput {
  readonly executionProfile: ExecutionProfile
  readonly evidence: Readonly<{
    engineeringGate: 'PASS' | 'HOLD' | 'FAIL'
    reasonCodes: readonly (P4EngineeringReason | 'MALFORMED_EVIDENCE')[]
    error?: string
  }>
  readonly modeledOutputPresent: boolean
  readonly modeledComparatorsComplete: boolean
  readonly sensitivityBandsComplete: boolean
  readonly modelRunDefect: string | null
  readonly budget: BudgetEvaluationResult
  readonly artifactPairValid: boolean | null
  readonly determinismVerified: boolean | null
  readonly e1E2ClosureRegression: boolean
  readonly requiredHumanAuthorityPresent: boolean
}

export interface EngineeringGateVerdict {
  readonly executionProfile: ExecutionProfile
  readonly engineeringGate: 'PASS' | 'FAIL' | 'HOLD'
  readonly releaseReadiness: ReleaseReadiness
  readonly reasonCodes: readonly EngineeringGateReason[]
  readonly error: string | null
  readonly budgetGate: BudgetGate
  readonly e0BudgetStatus: 'APPROVED_EVALUATED' | 'NOT_APPROVED_BLOCKED' | 'SUPPLIED_E0_INVALID'
  readonly comparisons: readonly BudgetComparison[]
  readonly closure: Readonly<{ G2_BUDGET: 'OPEN'; M10_E: 'OPEN' }>
}

const P4_TO_GATE_REASON: Readonly<Record<P4EngineeringReason, EngineeringGateReason>> = {
  DUPLICATE_PUBLICATION_DETECTED: 'SAFETY_COUNTER_BREACH',
  CANONICAL_CORRUPTION_DETECTED: 'SAFETY_COUNTER_BREACH',
  STAGE_POOL_THRESHOLD_NOT_MET: 'PROFILE_THRESHOLD_NOT_MET',
  APPLICABLE_CELL_COVERAGE_INCOMPLETE: 'PROFILE_THRESHOLD_NOT_MET',
  COMPLETE_NOVEL_THRESHOLD_NOT_MET: 'PROFILE_THRESHOLD_NOT_MET',
  RETRY_RECOVERY_FALLBACK_COVERAGE_INCOMPLETE: 'MISSING_MEASUREMENT',
  PUBLICATION_INVARIANT_COVERAGE_INCOMPLETE: 'MISSING_MEASUREMENT',
  LATENCY_COVERAGE_INCOMPLETE: 'MISSING_MEASUREMENT',
  TOKEN_COVERAGE_INCOMPLETE: 'MISSING_MEASUREMENT',
  PROVIDER_JUDGE_COUNT_COVERAGE_INCOMPLETE: 'MISSING_MEASUREMENT',
  COST_COVERAGE_INCOMPLETE: 'MISSING_MEASUREMENT',
}

export function evaluateEngineeringGate(input: EngineeringGateInput): EngineeringGateVerdict {
  const reasons: EngineeringGateReason[] = []
  let error: string | null = null

  if (input.evidence.engineeringGate === 'FAIL') {
    for (const reason of input.evidence.reasonCodes) {
      if (reason === 'MALFORMED_EVIDENCE') reasons.push('MALFORMED_EVIDENCE')
      else reasons.push(P4_TO_GATE_REASON[reason])
    }
    error = input.evidence.error ?? 'Malformed or unsafe reliability evidence'
  }
  if (input.modelRunDefect !== null) {
    reasons.push(classifyModelRunDefect(input.modelRunDefect))
    error = input.modelRunDefect
  }
  if (input.budget.status === 'SUPPLIED_E0_INVALID') {
    reasons.push(classifyE0Defect(input.budget.error))
    error = input.budget.error
  }
  if (input.determinismVerified === false) reasons.push('NON_DETERMINISTIC_MODEL_OUTPUT')
  if (input.artifactPairValid === false) reasons.push('ARTIFACT_PAIR_MISMATCH')
  if (input.e1E2ClosureRegression) reasons.push('E1_E2_CLOSURE_REGRESSION')

  if (reasons.length > 0) {
    return verdict(input, 'FAIL', dedupe(reasons), error)
  }

  const holds: EngineeringGateReason[] = []
  if (input.evidence.engineeringGate === 'HOLD') {
    for (const reason of input.evidence.reasonCodes) {
      if (reason !== 'MALFORMED_EVIDENCE') holds.push(P4_TO_GATE_REASON[reason])
    }
  }
  if (!input.modeledOutputPresent) holds.push('MODEL_UNAVAILABLE')
  if (!input.modeledComparatorsComplete) holds.push('MISSING_MEASUREMENT')
  if (!input.sensitivityBandsComplete) holds.push('MISSING_MEASUREMENT')
  if (input.budget.status === 'APPROVED_EVALUATED' && input.budget.comparisons.some((comparison) => comparison.modeled.outcome === 'INCOMPLETE')) {
    holds.push('MISSING_MEASUREMENT')
  }
  if (input.artifactPairValid === null) holds.push('ARTIFACT_PAIR_UNAVAILABLE')
  if (input.determinismVerified === null) holds.push('DETERMINISM_UNVERIFIED')
  if (!input.requiredHumanAuthorityPresent) holds.push('HUMAN_AUTHORITY_UNAVAILABLE')

  if (holds.length > 0) {
    return verdict(input, 'HOLD', dedupe(holds), error)
  }

  return verdict(input, 'PASS', [], error)
}

function verdict(
  input: EngineeringGateInput,
  engineeringGate: 'PASS' | 'FAIL' | 'HOLD',
  reasonCodes: readonly EngineeringGateReason[],
  error: string | null,
): EngineeringGateVerdict {
  return deepFreeze({
    executionProfile: input.executionProfile,
    engineeringGate,
    releaseReadiness: engineeringGate === 'FAIL' ? 'BLOCKED' as const : 'HOLD' as const,
    reasonCodes,
    error,
    budgetGate: input.budget.budgetGate,
    e0BudgetStatus: input.budget.status,
    comparisons: input.budget.status === 'APPROVED_EVALUATED' ? input.budget.comparisons : [],
    closure: { G2_BUDGET: 'OPEN' as const, M10_E: 'OPEN' as const },
  })
}

function classifyModelRunDefect(message: string): EngineeringGateDefectReason {
  if (/overflow|coefficient/i.test(message)) return 'DECIMAL_COEFFICIENT_OVERFLOW'
  if (/provenance/i.test(message)) return 'PROVENANCE_VIOLATION'
  if (/hash|binding/i.test(message)) return 'AUTHORITY_HASH_MISMATCH'
  if (/exchangeability|stratum|identity|frozen|version/i.test(message)) return 'SEMANTIC_IDENTITY_CONFLICT'
  return 'MALFORMED_EVIDENCE'
}

function classifyE0Defect(message: string): EngineeringGateDefectReason {
  if (/hash|binding|currency|conditioning|supersed/i.test(message)) return 'AUTHORITY_HASH_MISMATCH'
  return 'MALFORMED_EVIDENCE'
}

function dedupe(values: readonly EngineeringGateReason[]): EngineeringGateReason[] {
  const order = [...ENGINEERING_GATE_DEFECT_REASONS, ...ENGINEERING_GATE_HOLD_REASONS]
  return [...new Set(values)].sort((left, right) => order.indexOf(left) - order.indexOf(right))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}