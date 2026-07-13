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

    expect(publicMessage).toBe('Cerita belum dapat disimpan. Coba ulang sebentar lagi.')
    expect(publicMessage).not.toContain(message)
  })
})
