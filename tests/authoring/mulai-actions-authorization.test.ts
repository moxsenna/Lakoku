import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  proposePremises: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/user-state', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/lib/authoring/server', () => ({
  proposePremises: mocks.proposePremises,
  publicAuthoringErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga.',
}))

beforeEach(() => vi.clearAllMocks())

describe('mulai action authorization', () => {
  it('rejects anonymous story setup before parsing or provider call', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { actProposeStorySetupPremises } = await import('@/app/mulai/actions')

    const result = await actProposeStorySetupPremises(null)

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(mocks.proposePremises).not.toHaveBeenCalled()
  })
})
