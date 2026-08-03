import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  normalizeGenerationDispatchResult,
  isRetryableGenerationReason,
} from '@/lib/runtime/generation-job-execution'
import { SEMANTIC_JUDGE_UNAVAILABLE } from '@/lib/ai-gateway/semantic-continuation-judge'

describe('semantic judge retryability contract', () => {
  it('identifies SEMANTIC_JUDGE_UNAVAILABLE as retryable', () => {
    expect(isRetryableGenerationReason(SEMANTIC_JUDGE_UNAVAILABLE)).toBe(true)
  })

  it('normalizes failed dispatch with SEMANTIC_JUDGE_UNAVAILABLE as retryable', () => {
    const normalized = normalizeGenerationDispatchResult({
      ok: false,
      reason: SEMANTIC_JUDGE_UNAVAILABLE,
      mode: 'personalized_ai',
    })

    expect(normalized.ok).toBe(false)
    if (!normalized.ok) {
      expect(normalized.reason).toBe(SEMANTIC_JUDGE_UNAVAILABLE)
      expect(normalized.retryable).toBe(true)
      expect(normalized.stage).toBe('DISPATCH')
    }
  })
})
