/**
 * Explicit stages inside generateNextChapterReal for structured ops logs.
 * Bounded codes only — never free-form prose.
 */

export const GENERATION_STAGES = [
  'ACQUIRE_LEASE',
  'LOAD_CANON',
  'LOAD_NARRATIVE_CONTEXT',
  'COMPILE_CONTEXT',
  'GENERATE_PROSE',
  'VALIDATE_PROSE',
  'CONSUMER_SAFE',
  'BUILD_CHOICE_CONTEXT',
  'BUILD_CHOICES',
  'GENERATE_CHOICES_INITIAL',
  'VALIDATE_CHOICES_INITIAL',
  'REPAIR_CHOICES',
  'VALIDATE_CHOICES',
  'VALIDATE_CHOICES_FINAL',
  'PUBLISH_CHAPTER',
  'RECORD_TERMINAL_ATTEMPT',
  'COMPLETE',
] as const

export type GenerationStage = (typeof GENERATION_STAGES)[number]

/** Bounded choice failure codes for ops logs (never free-form prose). */
export const CHOICE_ERROR_CODES = [
  'CHOICE_PROVIDER_FAILED',
  'CHOICE_INVALID_RESPONSE',
  'CHOICE_SCHEMA_REJECTED',
  'CHOICE_UNGROUNDED',
  'CHOICE_NOT_ACTIONABLE',
  'CHOICE_NOT_DISTINCT',
  'CHOICE_EFFECT_INVALID',
  'CHOICE_INTERNAL_LEAK',
  'CHOICE_REPAIR_EXHAUSTED',
  'CHOICE_FINAL_CHAPTER',
  'CHOICE_GENERATION_FAILED',
] as const

export type ChoiceErrorCode = (typeof CHOICE_ERROR_CODES)[number]

export function mapChoiceFailureReasonToErrorCode(reason: string): ChoiceErrorCode {
  switch (reason) {
    case 'PROVIDER_FAILED':
    case 'INVALID_RESPONSE':
      return reason === 'INVALID_RESPONSE' ? 'CHOICE_INVALID_RESPONSE' : 'CHOICE_PROVIDER_FAILED'
    case 'SCHEMA_REJECTED':
      return 'CHOICE_SCHEMA_REJECTED'
    case 'UNGROUNDED':
      return 'CHOICE_UNGROUNDED'
    case 'NOT_ACTIONABLE':
      return 'CHOICE_NOT_ACTIONABLE'
    case 'NOT_DISTINCT':
      return 'CHOICE_NOT_DISTINCT'
    case 'UNSAFE':
      return 'CHOICE_INTERNAL_LEAK'
    case 'REPAIR_EXHAUSTED':
      return 'CHOICE_REPAIR_EXHAUSTED'
    case 'FINAL_CHAPTER':
      return 'CHOICE_FINAL_CHAPTER'
    default:
      return 'CHOICE_GENERATION_FAILED'
  }
}

export const GENERATION_RUNTIME_FAILED_EVENT = 'GENERATION_RUNTIME_FAILED' as const
