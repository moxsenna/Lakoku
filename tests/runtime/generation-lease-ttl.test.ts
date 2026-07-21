import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getGenerationPolicy: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ops/generation-policy', () => ({
  getGenerationPolicy: mocks.getGenerationPolicy,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getGenerationPolicy.mockReset()
})

describe('resolveGenerationLeaseTtlSeconds', () => {
  it('clamps policy value into 60..1800', async () => {
    mocks.getGenerationPolicy.mockResolvedValue({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 900,
      maxConcurrentGenerations: 10,
      maxConcurrentGenerationsPerUser: 1,
      generationMaxQueue: 40,
    })
    const { resolveGenerationLeaseTtlSeconds } = await import(
      '@/lib/runtime/generation-lease-ttl'
    )
    await expect(resolveGenerationLeaseTtlSeconds()).resolves.toBe(900)
  })

  it('clamps below min to 60', async () => {
    mocks.getGenerationPolicy.mockResolvedValue({
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
      leaseTtlSeconds: 10,
      maxConcurrentGenerations: 10,
      maxConcurrentGenerationsPerUser: 1,
      generationMaxQueue: 40,
    })
    const { resolveGenerationLeaseTtlSeconds } = await import(
      '@/lib/runtime/generation-lease-ttl'
    )
    await expect(resolveGenerationLeaseTtlSeconds()).resolves.toBe(60)
  })
})
