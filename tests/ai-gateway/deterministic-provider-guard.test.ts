import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Prosa deterministik pernah terbit ke cerita pembaca nyata (Bab 2 & Bab 5
 * "pulang-ke-tanah-yang-masih-marah-o9bple") karena selectProvider() diam-diam
 * jatuh ke fixture ketika NARRATIVE_PROVIDER tidak diset. Output fixture
 * membocorkan instruksi prompt ke pembaca. Guard ini harus fail-closed.
 */
describe('assertDeterministicProviderAllowed', () => {
  const originalAllow = process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER

  beforeEach(() => {
    delete process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER
  })

  afterEach(() => {
    if (originalAllow === undefined) {
      delete process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER
    } else {
      process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER = originalAllow
    }
  })

  it('menolak provider deterministik tanpa opt-in eksplisit', async () => {
    const { assertDeterministicProviderAllowed } = await import(
      '@/lib/ai-gateway/select-provider'
    )
    expect(() => assertDeterministicProviderAllowed()).toThrowError(
      /DETERMINISTIC_PROVIDER_FORBIDDEN/,
    )
  })

  it('mengizinkan provider deterministik untuk harness yang opt-in', async () => {
    process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER = '1'
    const { assertDeterministicProviderAllowed } = await import(
      '@/lib/ai-gateway/select-provider'
    )
    expect(() => assertDeterministicProviderAllowed()).not.toThrow()
  })

  it('selectProviderSync fail-closed tanpa gateway maupun opt-in', async () => {
    const originalProvider = process.env.NARRATIVE_PROVIDER
    delete process.env.NARRATIVE_PROVIDER
    try {
      const { selectProviderSync } = await import('@/lib/ai-gateway/select-provider')
      expect(() => selectProviderSync()).toThrowError(
        /DETERMINISTIC_PROVIDER_FORBIDDEN/,
      )
    } finally {
      if (originalProvider === undefined) delete process.env.NARRATIVE_PROVIDER
      else process.env.NARRATIVE_PROVIDER = originalProvider
    }
  })
})
