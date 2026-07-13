import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('publicAuthoringErrorMessage', () => {
  it.each([
    'stories claim: function public.claim_authoring_story_shell_v1 missing',
    'persistStoryBible: story owner mismatch',
    'delete characters: relation public.characters missing',
    'insert characters: permission denied for table characters',
    'ensureReaderStateStarted: column reader_states.route_state missing',
  ])('hides persistence implementation detail: %s', async (message) => {
    const { publicAuthoringErrorMessage } = await import('@/lib/authoring/model')

    const publicMessage = publicAuthoringErrorMessage(new Error(message))

    expect(publicMessage).toBe('Terjadi kesalahan tak terduga.')
    expect(publicMessage).not.toContain(message)
  })

  it.each([
    new Error('provider secret sk-live-do-not-leak'),
    new Error('DATABASE_URL=postgresql://internal-secret'),
    new Error('OPENROUTER_API_KEY=secret'),
    { message: 'plain object secret' },
    'configuration secret',
  ])('fails closed for unknown error: %o', async (error) => {
    const { publicAuthoringErrorMessage } = await import('@/lib/authoring/model')

    const publicMessage = publicAuthoringErrorMessage(error)

    expect(publicMessage).toBe('Terjadi kesalahan tak terduga.')
    expect(publicMessage).not.toContain('secret')
  })

  it('preserves intended message from typed public authoring errors', async () => {
    const { PublicAuthoringError, publicAuthoringErrorMessage } = await import('@/lib/authoring/model')

    expect(publicAuthoringErrorMessage(new PublicAuthoringError('Input cerita tidak valid.')))
      .toBe('Input cerita tidak valid.')
  })
})
