import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const policyMock = vi.hoisted(() => ({
  getGenerationPolicy: vi.fn(),
}))

vi.mock('@/lib/ops/generation-policy', () => ({
  getGenerationPolicy: policyMock.getGenerationPolicy,
  DEFAULT_GENERATION_POLICY: {
    targetWordsMin: 800,
    targetWordsMax: 1000,
    targetScenes: 3,
    leaseTtlSeconds: 300,
    maxConcurrentGenerations: 10,
    maxConcurrentGenerationsPerUser: 1,
    generationMaxQueue: 40,
  },
}))

async function loadMod() {
  vi.resetModules()
  return import('@/lib/runtime/generation-concurrency')
}

describe('generation concurrency policy refresh', () => {
  beforeEach(() => {
    policyMock.getGenerationPolicy.mockReset()
    delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS
    delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER
    delete process.env.LAKOKU_GENERATION_MAX_QUEUE
  })
  afterEach(() => {
    vi.resetModules()
    delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS
    delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER
    delete process.env.LAKOKU_GENERATION_MAX_QUEUE
  })

  it('applies DB policy caps when env unset', async () => {
    policyMock.getGenerationPolicy.mockResolvedValue({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 300,
      maxConcurrentGenerations: 4,
      maxConcurrentGenerationsPerUser: 2,
      generationMaxQueue: 12,
    })
    const mod = await loadMod()
    await mod.refreshGenerationConcurrencyFromPolicy()
    expect(mod.getGenerationConcurrencyConfig()).toMatchObject({
      maxConcurrent: 4,
      maxPerUser: 2,
      maxQueue: 12,
    })
  })

  it('keeps env override over DB', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '3'
    policyMock.getGenerationPolicy.mockResolvedValue({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 300,
      maxConcurrentGenerations: 10,
      maxConcurrentGenerationsPerUser: 1,
      generationMaxQueue: 40,
    })
    const mod = await loadMod()
    await mod.refreshGenerationConcurrencyFromPolicy()
    expect(mod.getGenerationConcurrencyConfig().maxConcurrent).toBe(3)
  })
})
