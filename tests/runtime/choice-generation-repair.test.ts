import { describe, expect, it } from 'vitest'
import {
  buildChoiceRepairNotes,
  choiceRetryAction,
  classifyChoiceProviderError,
} from '@/lib/runtime/choice-error-taxonomy'

describe('choice error taxonomy', () => {
  it('classifies timeout and rate limit as transient', () => {
    expect(classifyChoiceProviderError(new Error('Timeout after 90s'))).toBe('TIMEOUT')
    expect(classifyChoiceProviderError(new Error('429 rate limit'))).toBe('RATE_LIMITED')
    expect(choiceRetryAction('TIMEOUT')).toBe('transient_retry')
    expect(choiceRetryAction('RATE_LIMITED')).toBe('transient_retry')
    expect(choiceRetryAction('HTTP_5XX')).toBe('transient_retry')
    expect(choiceRetryAction('NETWORK_ERROR')).toBe('transient_retry')
  })

  it('routes invalid JSON to structural repair not identical retry', () => {
    expect(classifyChoiceProviderError(new Error('Invalid JSON from model'))).toBe('INVALID_JSON')
    expect(choiceRetryAction('INVALID_JSON')).toBe('structural_repair')
    expect(choiceRetryAction('SCHEMA_INVALID')).toBe('structural_repair')
  })

  it('routes quality findings to quality repair', () => {
    expect(classifyChoiceProviderError(new Error('CHOICE_UNRELATED'))).toBe('QUALITY_UNGROUNDED')
    expect(classifyChoiceProviderError(new Error('NOT_DISTINCT'))).toBe('QUALITY_NOT_DISTINCT')
    expect(choiceRetryAction('QUALITY_UNGROUNDED')).toBe('quality_repair')
  })
})

describe('choice repair notes', () => {
  it('does not echo PROVIDER_ERROR into narrative constraint list', () => {
    const notes = buildChoiceRepairNotes([
      { code: 'PROVIDER_ERROR', message: 'Choice provider threw an error.' },
      { code: 'UNGROUNDED', message: 'not grounded' },
      { code: 'NOT_DISTINCT', message: 'too similar' },
    ])
    expect(notes.some((n) => n.includes('PROVIDER_ERROR'))).toBe(false)
    expect(notes.some((n) => /parse|kosong|valid/i.test(n))).toBe(true)
    expect(notes.some((n) => /objek atau konflik|akhir bab/i.test(n))).toBe(true)
    expect(notes.some((n) => /serupa|bedakan/i.test(n))).toBe(true)
  })
})
