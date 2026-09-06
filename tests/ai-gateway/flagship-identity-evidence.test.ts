import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { evaluateFlagshipIdentity } from '@/lib/ai-gateway/flagship-identity-evidence'

const canonical = 'openai/gpt-5.6-sol-20260709'
describe('flagship authoritative identity', () => {
  it.each([
    [canonical, 'openrouter', 'PROVEN'],
    ['openai/gpt-5.6-sol', 'openrouter', 'UNPROVEN'],
    ['other/model', 'openrouter', 'MISMATCH'],
    [canonical, 'other-provider', 'MISMATCH'],
    [null, null, 'UNAVAILABLE'],
    [canonical, null, 'UNPROVEN'],
  ] as const)('%s / %s is %s', (responseModel, providerObserved, expected) => {
    expect(evaluateFlagshipIdentity({
      requestedModel: 'openai/gpt-5.6-sol', configuredModel: 'openai/gpt-5.6-sol',
      responseModel, providerRequested: 'openrouter', providerObserved,
      canonicalResolution: responseModel === canonical ? 'EXACT_FROZEN_MATCH' : null,
    })).toBe(expected)
  })
})
