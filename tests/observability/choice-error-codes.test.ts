import { describe, expect, it } from 'vitest'
import {
  CHOICE_ERROR_CODES,
  GENERATION_STAGES,
  mapChoiceFailureReasonToErrorCode,
} from '@/lib/observability/generation-stages'

describe('Phase 8 — choice observability codes', () => {
  it('includes choice-related generation stages', () => {
    expect(GENERATION_STAGES).toContain('BUILD_CHOICE_CONTEXT')
    expect(GENERATION_STAGES).toContain('GENERATE_CHOICES_INITIAL')
    expect(GENERATION_STAGES).toContain('REPAIR_CHOICES')
    expect(GENERATION_STAGES).toContain('VALIDATE_CHOICES_FINAL')
    expect(GENERATION_STAGES).toContain('BUILD_CHOICES')
  })

  it('maps failure reasons to bounded error codes', () => {
    expect(mapChoiceFailureReasonToErrorCode('PROVIDER_FAILED')).toBe('CHOICE_PROVIDER_FAILED')
    expect(mapChoiceFailureReasonToErrorCode('UNGROUNDED')).toBe('CHOICE_UNGROUNDED')
    expect(mapChoiceFailureReasonToErrorCode('NOT_ACTIONABLE')).toBe('CHOICE_NOT_ACTIONABLE')
    expect(mapChoiceFailureReasonToErrorCode('NOT_DISTINCT')).toBe('CHOICE_NOT_DISTINCT')
    expect(mapChoiceFailureReasonToErrorCode('REPAIR_EXHAUSTED')).toBe('CHOICE_REPAIR_EXHAUSTED')
    expect(mapChoiceFailureReasonToErrorCode('UNSAFE')).toBe('CHOICE_INTERNAL_LEAK')
    expect(mapChoiceFailureReasonToErrorCode('FINAL_CHAPTER')).toBe('CHOICE_FINAL_CHAPTER')
    expect(mapChoiceFailureReasonToErrorCode('SOMETHING_ELSE')).toBe('CHOICE_GENERATION_FAILED')
  })

  it('exports a stable set of choice error codes', () => {
    expect(CHOICE_ERROR_CODES).toContain('CHOICE_REPAIR_EXHAUSTED')
    expect(CHOICE_ERROR_CODES).toContain('CHOICE_UNGROUNDED')
  })
})
