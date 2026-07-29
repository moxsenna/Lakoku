export type GenerationJobErrorCode =
  | 'AUTH_REQUIRED'
  | 'STORY_NOT_FOUND'
  | 'GENERATION_JOB_CONFLICT'
  | 'GENERATION_JOB_OWNERSHIP_LOST'
  | 'LEASE_HELD'
  | 'CHAPTER_EXISTS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PROVENANCE_CONFLICT'
  | 'CHECKPOINT_CONFLICT'
  | 'CONTRACT_CONFLICT'
  | 'PLOT_DEBT_CONFLICT'
  | 'GENERATION_DEADLINE_EXCEEDED'
  | 'GENERATION_RETRY_EXHAUSTED'
  | 'GENERATION_PUBLICATION_CONFLICT'
  | 'INVALID_GENERATION_JOB_TRANSITION'
  | 'INTERNAL_ERROR'

export const GENERATION_JOB_ERROR_CODES: readonly GenerationJobErrorCode[] = [
  'AUTH_REQUIRED',
  'STORY_NOT_FOUND',
  'GENERATION_JOB_CONFLICT',
  'GENERATION_JOB_OWNERSHIP_LOST',
  'LEASE_HELD',
  'CHAPTER_EXISTS',
  'IDEMPOTENCY_CONFLICT',
  'PROVENANCE_CONFLICT',
  'CHECKPOINT_CONFLICT',
  'CONTRACT_CONFLICT',
  'PLOT_DEBT_CONFLICT',
  'GENERATION_DEADLINE_EXCEEDED',
  'GENERATION_RETRY_EXHAUSTED',
  'GENERATION_PUBLICATION_CONFLICT',
  'INVALID_GENERATION_JOB_TRANSITION',
  'INTERNAL_ERROR',
]

const GENERATION_JOB_ERROR_CODE_SET = new Set(GENERATION_JOB_ERROR_CODES)

const GENERATION_JOB_RPC_ERROR_ALIASES: ReadonlyArray<readonly [string, GenerationJobErrorCode]> = [
  ['GENERATION_JOB_DEADLINE_EXCEEDED', 'GENERATION_DEADLINE_EXCEEDED'],
  ['GENERATION_JOB_LEASE_INVALID', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_TARGET_MISMATCH', 'PROVENANCE_CONFLICT'],
  ['GENERATION_JOB_NOT_RUNNING', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_TERMINAL', 'INVALID_GENERATION_JOB_TRANSITION'],
  ['GENERATION_JOB_NOT_FOUND', 'STORY_NOT_FOUND'],
  ['CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH', 'CHECKPOINT_CONFLICT'],
  ['CHECKPOINT_INVALID_STATE', 'CHECKPOINT_CONFLICT'],
  ['CHECKPOINT_PUBLISH_FAILED', 'CHECKPOINT_CONFLICT'],
  ['CONTRACT_PROVENANCE_MISSING', 'CONTRACT_CONFLICT'],
  ['CONTRACT_VERSION_MISMATCH', 'CONTRACT_CONFLICT'],
  ['DEBT_CONTRACT_NOT_FOUND', 'PLOT_DEBT_CONFLICT'],
  ['DEBT_CONTRACT_INVALID', 'PLOT_DEBT_CONFLICT'],
  ['DEBT_CLOSURE_UNKNOWN_DEBT', 'PLOT_DEBT_CONFLICT'],
  ['DEBT_CLOSURE_NOT_INTRODUCED', 'PLOT_DEBT_CONFLICT'],
  ['DEBT_CLOSURE_ABANDONED_MAIN_MYSTERY', 'PLOT_DEBT_CONFLICT'],
  ['DEBT_CLOSURE_DEADLINE_VIOLATION', 'PLOT_DEBT_CONFLICT'],
  ['DEBT_CLOSURE_CONFLICT', 'PLOT_DEBT_CONFLICT'],
  ['OPEN_DEBT_AT_END', 'PLOT_DEBT_CONFLICT'],
  ['MAIN_MYSTERY_UNRESOLVED', 'PLOT_DEBT_CONFLICT'],
]

export const GENERATION_JOB_RPC_ERROR_TOKENS: ReadonlyArray<readonly [string, GenerationJobErrorCode]> = [
  ...GENERATION_JOB_RPC_ERROR_ALIASES,
  ...GENERATION_JOB_ERROR_CODES.map((code) => [code, code] as const),
].sort(([left], [right]) => right.length - left.length)

export class GenerationJobError extends Error {
  constructor(
    public readonly code: GenerationJobErrorCode,
    public readonly rpcToken: string = code,
  ) {
    super(code)
    this.name = 'GenerationJobError'
  }
}

export type AdaptedGenerationJobError = Readonly<{
  code: GenerationJobErrorCode
  rpcToken: string
}>

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isGenerationJobErrorCode(value: unknown): value is GenerationJobErrorCode {
  return typeof value === 'string' && GENERATION_JOB_ERROR_CODE_SET.has(value as GenerationJobErrorCode)
}

function isGenerationJobRpcToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 200
    && value === value.trim()
    && !/[\x00-\x1F\x7F]/.test(value)
}

export function extractGenerationJobRpcError(message: unknown): AdaptedGenerationJobError | null {
  if (typeof message !== 'string') return null
  const trimmed = message.trim()
  const matched = GENERATION_JOB_RPC_ERROR_TOKENS.find(
    ([token]) => trimmed === token || trimmed.startsWith(`${token}:`),
  )
  return matched ? { code: matched[1], rpcToken: matched[0] } : null
}

/** Restore typed identity only at boundaries where instanceof may not survive. */
export function adaptGenerationJobError(error: unknown): AdaptedGenerationJobError | null {
  if (typeof error !== 'object' || error === null) return null
  if (!hasOwn(error, 'name') || !hasOwn(error, 'code') || !hasOwn(error, 'rpcToken')) return null
  const candidate = error as Record<string, unknown>
  if (candidate.name !== 'GenerationJobError') return null
  if (!isGenerationJobErrorCode(candidate.code) || !isGenerationJobRpcToken(candidate.rpcToken)) return null
  return { code: candidate.code, rpcToken: candidate.rpcToken }
}

export type GenerationPublicationErrorClassification =
  | { kind: 'chapter_exists'; code: 'CHAPTER_EXISTS' }
  | { kind: 'ownership_lost'; code: 'GENERATION_JOB_OWNERSHIP_LOST' | 'LEASE_HELD' }
  | { kind: 'transient'; code: 'INTERNAL_ERROR' }
  | { kind: 'failed_review_required'; code: Exclude<GenerationJobErrorCode, 'INTERNAL_ERROR'> }

export function classifyGenerationPublicationError(
  error: unknown,
): GenerationPublicationErrorClassification {
  const adapted = adaptGenerationJobError(error)
  if (!adapted || adapted.code === 'INTERNAL_ERROR') {
    return { kind: 'transient', code: 'INTERNAL_ERROR' }
  }
  if (adapted.code === 'CHAPTER_EXISTS') return { kind: 'chapter_exists', code: adapted.code }
  if (adapted.code === 'GENERATION_JOB_OWNERSHIP_LOST' || adapted.code === 'LEASE_HELD') {
    return { kind: 'ownership_lost', code: adapted.code }
  }
  return { kind: 'failed_review_required', code: adapted.code }
}
