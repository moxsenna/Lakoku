import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import type { AuthorObjectGenerate } from '@/lib/authoring/model'

vi.mock('server-only', () => ({}))

describe('resolveAuthoringModels', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.NINEROUTER_BASE_URL
    delete process.env.NINEROUTER_API_KEY
    delete process.env.CUSTOM_LLM_BASE_URL
    delete process.env.CUSTOM_LLM_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.AUTHORING_MODELS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('resolves 9router candidates when NINEROUTER env is present', async () => {
    process.env.NINEROUTER_BASE_URL = 'https://9router.example.com/v1'
    process.env.NINEROUTER_API_KEY = 'nr-test-key'

    const { resolveAuthoringModels } = await import('@/lib/authoring/model')
    const candidates = resolveAuthoringModels()

    expect(candidates.length).toBe(2)
    expect(candidates[0].label).toBe('9router:ag/claude-sonnet-4-6')
    expect(candidates[1].label).toBe('9router:ag/claude-opus-4-6-thinking')
  })

  it('respects AUTHORING_MODELS override with 9router', async () => {
    process.env.NINEROUTER_BASE_URL = 'https://9router.example.com/v1'
    process.env.NINEROUTER_API_KEY = 'nr-test-key'
    process.env.AUTHORING_MODELS = 'ag/claude-sonnet-4-6'

    const { resolveAuthoringModels } = await import('@/lib/authoring/model')
    const candidates = resolveAuthoringModels()

    expect(candidates.length).toBe(1)
    expect(candidates[0].label).toBe('9router:ag/claude-sonnet-4-6')
  })

  it('resolves openrouter when only OPENROUTER_API_KEY is present', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'

    const { resolveAuthoringModels } = await import('@/lib/authoring/model')
    const candidates = resolveAuthoringModels()

    expect(candidates.length).toBe(3)
    expect(candidates[0].label).toBe('openrouter:openai/gpt-4.1-mini')
    expect(candidates[1].label).toBe('openrouter:deepseek/deepseek-v3.2')
    expect(candidates[2].label).toBe('openrouter:google/gemini-2.5-flash-lite')
  })

  it('falls back to gateway when no openai-compatible providers configured', async () => {
    const { resolveAuthoringModels } = await import('@/lib/authoring/model')
    const candidates = resolveAuthoringModels()

    expect(candidates.length).toBe(1)
    expect(candidates[0].label).toBe('gateway:openai/gpt-4.1-mini')
  })

  it('authorObjectFromCandidates falls back to next candidate when first fails', async () => {
    const { authorObjectFromCandidates } = await import('@/lib/authoring/model')
    const { z } = await import('zod')

    const fakeModel = {} as unknown as LanguageModel
    const fakeCandidates = [
      { model: fakeModel, label: 'mock:failing' },
      { model: fakeModel, label: 'mock:succeeding' },
    ]

    const mockGenerate = vi.fn()
      .mockRejectedValueOnce(new Error('First candidate crashed'))
      .mockResolvedValueOnce({ object: { title: 'Lolos' } })

    const res = await authorObjectFromCandidates(
      {
        schema: z.object({ title: z.string() }),
        system: 'sys',
        prompt: 'prompt',
      },
      fakeCandidates,
      mockGenerate as unknown as AuthorObjectGenerate,
    )

    expect(res.usedModel).toBe('mock:succeeding')
    expect(res.object).toEqual({ title: 'Lolos' })
  })
})
