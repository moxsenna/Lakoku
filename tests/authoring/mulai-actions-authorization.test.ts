import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  proposePremises: vi.fn(),
  getTasteProfileForUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/user-state', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/lib/api/taste-profile', () => ({
  getTasteProfileForUser: mocks.getTasteProfileForUser,
}))
vi.mock('@/lib/authoring/server', () => ({
  proposePremises: mocks.proposePremises,
  publicAuthoringErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga.',
}))

beforeEach(() => vi.clearAllMocks())

describe('mulai action authorization', () => {
  it('allows anonymous guests to generate premise proposals with valid setup', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    mocks.proposePremises.mockResolvedValue({
      proposals: [
        {
          title: 'Uji Cerita',
          tagline: 'Tagline uji',
          role: 'Tokoh utama',
          synopsis: 'Sinopsis uji.',
          tropes: ['Drama'],
        },
      ],
      usedModel: 'test-model',
    })
    const { actProposeStorySetupPremises } = await import('@/app/mulai/actions')

    const result = await actProposeStorySetupPremises({
      mode: 'quick',
      answers: { genre: { mode: 'selected', value: 'family_drama' } },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.proposals).toHaveLength(1)
    }
    expect(mocks.proposePremises).toHaveBeenCalled()
  })

  it('rejects anonymous guests when attempting to assemble and lock story bible', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { actAssembleAndLockStory } = await import('@/app/mulai/actions')

    const result = await actAssembleAndLockStory({
      title: 'Uji Cerita',
      tagline: 'Tagline uji',
      role: 'Tokoh utama',
      synopsis: 'Sinopsis uji.',
      tropes: ['Drama'],
    })

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
  })
})
