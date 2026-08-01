import 'server-only'

export const DEFAULT_CHOICE_CANDIDATE_TIMEOUT_MS = 45_000
export const DEFAULT_CHOICE_WORKFLOW_TIMEOUT_MS = 120_000
export const CHOICE_DEADLINE_RESERVE_MS = 1_000
export const MINIMUM_RETRY_EXECUTION_WINDOW_MS = DEFAULT_CHOICE_CANDIDATE_TIMEOUT_MS

export type ChoiceWorkflowDeadlineSource = 'LOCAL_POLICY' | 'PARENT_JOB'

export type ResolvedChoiceDeadline = Readonly<{
  deadlineAtMs: number
  source: ChoiceWorkflowDeadlineSource
}>

export type ChoiceExecutionBudget = {
  usedCalls: number
  maxCalls: number
  maxCandidates: number
  perCandidateTimeoutMs: number
  deadlineAtMs: number
  deadlineSource: ChoiceWorkflowDeadlineSource
}

export type ChoiceAbortCause =
  | 'PARENT_CANCELLED'
  | 'WORKFLOW_DEADLINE'
  | 'CANDIDATE_TIMEOUT'

export class ChoiceWorkflowError extends Error {
  readonly code: 'CHOICE_CANDIDATE_TIMEOUT' | 'CHOICE_WORKFLOW_TIMEOUT' | 'GENERATION_JOB_DEADLINE_EXCEEDED'
  readonly causeType: ChoiceAbortCause

  constructor(
    code: 'CHOICE_CANDIDATE_TIMEOUT' | 'CHOICE_WORKFLOW_TIMEOUT' | 'GENERATION_JOB_DEADLINE_EXCEEDED',
    causeType: ChoiceAbortCause,
  ) {
    super(code)
    this.name = 'ChoiceWorkflowError'
    this.code = code
    this.causeType = causeType
  }
}

export function resolveChoiceDeadlineAt(args: {
  nowMs: number
  parentDeadlineAtMs?: number | null
  policyWorkflowMs?: number
}): ResolvedChoiceDeadline {
  const policyWorkflowMs = args.policyWorkflowMs ?? DEFAULT_CHOICE_WORKFLOW_TIMEOUT_MS
  const localDeadline = args.nowMs + policyWorkflowMs
  const parent = args.parentDeadlineAtMs
  if (typeof parent === 'number' && Number.isFinite(parent)) {
    const deadlineAtMs = Math.min(localDeadline, parent)
    const source = parent <= localDeadline + CHOICE_DEADLINE_RESERVE_MS
      ? 'PARENT_JOB'
      : 'LOCAL_POLICY'
    return { deadlineAtMs, source }
  }
  return { deadlineAtMs: localDeadline, source: 'LOCAL_POLICY' }
}

export function candidateTimeoutMs(
  budget: Pick<ChoiceExecutionBudget, 'deadlineAtMs' | 'perCandidateTimeoutMs'>,
  nowMs: number,
): number | null {
  const remainingMs = budget.deadlineAtMs - nowMs
  if (remainingMs <= CHOICE_DEADLINE_RESERVE_MS) return null
  return Math.min(budget.perCandidateTimeoutMs, remainingMs - CHOICE_DEADLINE_RESERVE_MS)
}

export function retryWindowFitsJobDeadline(args: {
  availableAtMs: number
  jobDeadlineAtMs: number
}): boolean {
  return args.availableAtMs + CHOICE_DEADLINE_RESERVE_MS + MINIMUM_RETRY_EXECUTION_WINDOW_MS
    < args.jobDeadlineAtMs
}
