import { afterEach, describe, expect, it, vi } from 'vitest'

describe('feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_TASTE_PROFILE_V2', '')
    vi.stubEnv('NEXT_PUBLIC_STORY_CREATIVE_DIRECTION_V1', '')
    const flags = await import('@/lib/feature-flags')
    expect(flags.isTasteProfileV2Enabled()).toBe(true)
    expect(flags.isStoryCreativeDirectionV1Enabled()).toBe(true)
  })

  it('disables on 0/false', async () => {
    vi.stubEnv('NEXT_PUBLIC_TASTE_PROFILE_V2', '0')
    vi.stubEnv('NEXT_PUBLIC_STORY_CREATIVE_DIRECTION_V1', 'false')
    const flags = await import('@/lib/feature-flags')
    expect(flags.isTasteProfileV2Enabled()).toBe(false)
    expect(flags.isStoryCreativeDirectionV1Enabled()).toBe(false)
  })
})
