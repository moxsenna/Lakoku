import { describe, expect, it } from 'vitest'
import {
  updateAiModelRouteSchema,
  updateGenerationPolicySchema,
} from '../../lib/admin/settings-schemas'

const baseRoute = {
  useCase: 'chapter_prose',
  provider: 'openrouter' as const,
  modelId: 'anthropic/claude-sonnet-4',
  temperature: 0.7,
  maxOutputTokens: 4096,
  isActive: true,
  routeVersion: 'v1.0.0',
  notes: null,
  reason: 'update model route',
}

describe('updateAiModelRouteSchema', () => {
  it('accepts structured fallbacks', () => {
    const result = updateAiModelRouteSchema.safeParse({
      ...baseRoute,
      fallbackModels: [
        { provider: 'gateway', modelId: 'google/gemini-2.5-flash' },
        { provider: '9router', modelId: 'openai/gpt-4o-mini' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects string[] fallbacks', () => {
    const result = updateAiModelRouteSchema.safeParse({
      ...baseRoute,
      fallbackModels: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects fallback equal to primary model', () => {
    const result = updateAiModelRouteSchema.safeParse({
      ...baseRoute,
      fallbackModels: [
        { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('primary'))).toBe(
        true,
      )
    }
  })

  it('rejects duplicate fallbacks', () => {
    const result = updateAiModelRouteSchema.safeParse({
      ...baseRoute,
      fallbackModels: [
        { provider: 'gateway', modelId: 'google/gemini-2.5-flash' },
        { provider: 'gateway', modelId: 'google/gemini-2.5-flash' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('duplikat'))).toBe(
        true,
      )
    }
  })
})

describe('updateGenerationPolicySchema', () => {
  const fullPolicy = {
    targetWordsMin: 800,
    targetWordsMax: 1200,
    targetScenes: 4,
    leaseTtlSeconds: 300,
    maxConcurrentGenerations: 8,
    maxConcurrentGenerationsPerUser: 2,
    generationMaxQueue: 50,
    reason: 'tune generation policy',
  }

  it('accepts full generation policy with lease/concurrency fields', () => {
    const result = updateGenerationPolicySchema.safeParse(fullPolicy)
    expect(result.success).toBe(true)
  })

  it('rejects missing leaseTtlSeconds', () => {
    const { leaseTtlSeconds: _omit, ...withoutLease } = fullPolicy
    const result = updateGenerationPolicySchema.safeParse(withoutLease)
    expect(result.success).toBe(false)
  })
})
