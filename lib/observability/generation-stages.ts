/**
 * Explicit stages inside generateNextChapterReal for structured ops logs.
 * Bounded codes only — never free-form prose.
 */

export const GENERATION_STAGES = [
  'ACQUIRE_LEASE',
  'LOAD_CANON',
  'COMPILE_CONTEXT',
  'GENERATE_PROSE',
  'VALIDATE_PROSE',
  'CONSUMER_SAFE',
  'BUILD_CHOICES',
  'VALIDATE_CHOICES',
  'PUBLISH_CHAPTER',
  'RECORD_TERMINAL_ATTEMPT',
  'COMPLETE',
] as const

export type GenerationStage = (typeof GENERATION_STAGES)[number]

export const GENERATION_RUNTIME_FAILED_EVENT = 'GENERATION_RUNTIME_FAILED' as const
