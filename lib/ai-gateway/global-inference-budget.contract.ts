export type GlobalInferenceKind = 'prose' | 'semantic' | 'choice'

export type GlobalInferenceProvenance = Readonly<{
  workflowPhase: string
  providerId?: string
  modelId?: string
  fallbackIndex?: number
}>

export interface GlobalInferenceBudget {
  readonly runId: string
  readonly hardLimit: number
  consumed: number
  reserve(kind: GlobalInferenceKind, provenance: GlobalInferenceProvenance): void
}

export type GlobalInferenceBudgetErrorCode =
  | 'M10G_GLOBAL_INFERENCE_BUDGET_REQUIRED'
  | 'M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED'

export class GlobalInferenceBudgetError extends Error {
  readonly code: GlobalInferenceBudgetErrorCode

  constructor(code: GlobalInferenceBudgetErrorCode) {
    super(code)
    this.name = 'GlobalInferenceBudgetError'
    this.code = code
  }
}

export function isGlobalInferenceBudgetError(
  error: unknown,
): error is Error & { code: GlobalInferenceBudgetErrorCode } {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'M10G_GLOBAL_INFERENCE_BUDGET_REQUIRED'
    || code === 'M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED'
}

/**
 * Run-level counter for one isolated Node proof-run process.
 * `reserve` mutates synchronously, so competing async tasks cannot interleave the
 * limit check and increment inside this process. This is not a fleet quota.
 */
export function createGlobalInferenceBudget(input: Readonly<{
  runId: string
  hardLimit: number
}>): GlobalInferenceBudget {
  const runId = input.runId.trim()
  if (!runId) throw new Error('GLOBAL_INFERENCE_BUDGET_RUN_ID_REQUIRED')
  if (!Number.isSafeInteger(input.hardLimit) || input.hardLimit < 1) {
    throw new Error('GLOBAL_INFERENCE_BUDGET_HARD_LIMIT_INVALID')
  }

  return {
    runId,
    hardLimit: input.hardLimit,
    consumed: 0,
    reserve(_kind, _provenance) {
      if (this.consumed >= this.hardLimit) {
        throw new GlobalInferenceBudgetError('M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED')
      }
      this.consumed += 1
    },
  }
}
