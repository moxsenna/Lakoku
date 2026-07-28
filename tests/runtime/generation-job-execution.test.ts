import { describe, expect, it, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  choiceRetryBackoffSeconds,
  isGenerationWorkerEnabled,
  isRetryableGenerationReason,
  mapModeToGenerationKind,
  normalizeGenerationDispatchResult,
} from '@/lib/runtime/generation-job-execution'

afterEach(() => {
  delete process.env.LAKOKU_GENERATION_WORKER
})

describe('isGenerationWorkerEnabled', () => {
  it('defaults OFF', () => {
    expect(isGenerationWorkerEnabled()).toBe(false)
  })

  it('accepts on/true/1/yes', () => {
    for (const v of ['on', 'true', '1', 'yes', 'ON', 'True']) {
      process.env.LAKOKU_GENERATION_WORKER = v
      expect(isGenerationWorkerEnabled()).toBe(true)
    }
  })

  it('rejects off/false/empty', () => {
    for (const v of ['off', 'false', '0', '', 'no']) {
      process.env.LAKOKU_GENERATION_WORKER = v
      expect(isGenerationWorkerEnabled()).toBe(false)
    }
  })
})

describe('mapModeToGenerationKind', () => {
  it('maps personalized_ai → personalized', () => {
    expect(mapModeToGenerationKind('personalized_ai')).toBe('personalized')
  })
  it('maps standard → standard', () => {
    expect(mapModeToGenerationKind('standard')).toBe('standard')
  })
})

describe('normalizeGenerationDispatchResult', () => {
  it('outer ok:false is failure', () => {
    const n = normalizeGenerationDispatchResult({
      ok: false,
      reason: 'GENERATION_CONTRACT_INVALID',
    })
    expect(n.ok).toBe(false)
    if (!n.ok) {
      expect(n.reason).toBe('GENERATION_CONTRACT_INVALID')
      expect(n.retryable).toBe(false)
    }
  })

  it('outer ok:true + inner ok:false is NOT success (CHOICE_GENERATION_FAILED)', () => {
    const n = normalizeGenerationDispatchResult({
      ok: true,
      mode: 'standard',
      result: { ok: false, reason: 'CHOICE_GENERATION_FAILED' },
    })
    expect(n.ok).toBe(false)
    if (!n.ok) {
      expect(n.reason).toBe('CHOICE_GENERATION_FAILED')
      expect(n.retryable).toBe(true)
      expect(n.mode).toBe('standard')
    }
  })

  it('outer ok:true + inner ok:true is success', () => {
    const n = normalizeGenerationDispatchResult({
      ok: true,
      mode: 'standard',
      result: {
        ok: true,
        chapterNumber: 3,
        seq: 12,
        fromCheckpoint: true,
      },
    })
    expect(n.ok).toBe(true)
    if (n.ok) {
      expect(n.chapterNumber).toBe(3)
      expect(n.seq).toBe(12)
      expect(n.fromCheckpoint).toBe(true)
    }
  })

  it('inner ok:true without committed publication metadata is terminal failure', () => {
    const n = normalizeGenerationDispatchResult({
      ok: true,
      mode: 'standard',
      result: { ok: true },
    })
    expect(n.ok).toBe(false)
    if (!n.ok) {
      expect(n.reason).toBe('GENERATOR_RESULT_INVALID')
      expect(n.retryable).toBe(false)
    }
  })

  it('unexpected result shape is terminal failure', () => {
    const n = normalizeGenerationDispatchResult({
      ok: true,
      mode: 'personalized_ai',
      result: 'wat',
    })
    expect(n.ok).toBe(false)
    if (!n.ok) {
      expect(n.reason).toBe('GENERATOR_RESULT_INVALID')
      expect(n.retryable).toBe(false)
    }
  })
})

describe('isRetryableGenerationReason', () => {
  it('marks terminal reasons non-retryable', () => {
    expect(isRetryableGenerationReason('CANON_MISSING')).toBe(false)
    expect(isRetryableGenerationReason('CHAPTER_EXISTS')).toBe(false)
    expect(isRetryableGenerationReason('FAILED_REVIEW_REQUIRED')).toBe(false)
  })
  it('marks choice/capacity failures retryable', () => {
    expect(isRetryableGenerationReason('CHOICE_GENERATION_FAILED')).toBe(true)
    expect(isRetryableGenerationReason('CAPACITY_BUSY')).toBe(true)
  })
})

describe('choiceRetryBackoffSeconds', () => {
  it('grows then caps at 300', () => {
    expect(choiceRetryBackoffSeconds(1)).toBe(30)
    expect(choiceRetryBackoffSeconds(2)).toBe(60)
    expect(choiceRetryBackoffSeconds(3)).toBe(120)
    expect(choiceRetryBackoffSeconds(10)).toBe(300)
  })
})
