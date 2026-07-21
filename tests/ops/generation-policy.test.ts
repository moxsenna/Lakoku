import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

beforeEach(() => {
  vi.resetModules()
  mocks.maybeSingle.mockReset()
  mocks.from.mockReset()
  mocks.adminFactory.mockReset()
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mocks.maybeSingle,
      }),
    }),
  })
  mocks.adminFactory.mockReturnValue({ from: mocks.from })
})

describe('getGenerationPolicy', () => {
  it('maps extended runtime columns from DB', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        target_words_min: 800,
        target_words_max: 1000,
        target_scenes: 3,
        lease_ttl_seconds: 600,
        max_concurrent_generations: 8,
        max_concurrent_generations_per_user: 2,
        generation_max_queue: 20,
      },
      error: null,
    })
    const { getGenerationPolicy } = await import('@/lib/ops/generation-policy')
    await expect(getGenerationPolicy()).resolves.toEqual({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 600,
      maxConcurrentGenerations: 8,
      maxConcurrentGenerationsPerUser: 2,
      generationMaxQueue: 20,
    })
  })

  it('falls back to defaults when DB empty', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    const { getGenerationPolicy, DEFAULT_GENERATION_POLICY } = await import(
      '@/lib/ops/generation-policy'
    )
    await expect(getGenerationPolicy()).resolves.toEqual(DEFAULT_GENERATION_POLICY)
  })
})
