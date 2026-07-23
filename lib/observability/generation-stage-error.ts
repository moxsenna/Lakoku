/**
 * Typed generation-stage errors that track whether a terminal failure
 * event was already recorded, so outer catch does not double-log.
 */

const FAILURE_RECORDED = Symbol.for('lakoku.generation.failureRecorded')

export type GenerationStageErrorOptions = {
  errorCode: string
  stage: string
  alreadyRecorded?: boolean
  cause?: unknown
}

export class GenerationStageError extends Error {
  readonly errorCode: string
  readonly stage: string
  readonly alreadyRecorded: boolean

  constructor(message: string, options: GenerationStageErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'GenerationStageError'
    this.errorCode = options.errorCode
    this.stage = options.stage
    this.alreadyRecorded = options.alreadyRecorded ?? false
    if (this.alreadyRecorded) {
      markFailureRecorded(this)
    }
  }
}

export function markFailureRecorded(error: unknown): void {
  if (error && typeof error === 'object') {
    Object.defineProperty(error, FAILURE_RECORDED, {
      value: true,
      enumerable: false,
      configurable: true,
    })
  }
}

export function isFailureRecorded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if (error instanceof GenerationStageError && error.alreadyRecorded) return true
  return Boolean((error as Record<symbol, unknown>)[FAILURE_RECORDED])
}
