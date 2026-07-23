import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  generateNextChapterReal: vi.fn(),
  generateNextPersonalizedChapter: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/runtime/story-generation', () => ({
  generateNextChapterReal: mocks.generateNextChapterReal,
}))
vi.mock('@/lib/runtime/personalized-generation', () => ({
  generateNextPersonalizedChapter: mocks.generateNextPersonalizedChapter,
}))

function contractClient(row: { mode: string } | null, error: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: row, error })),
        })),
      })),
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.generateNextChapterReal.mockResolvedValue({ ok: true, chapterNumber: 1 })
  mocks.generateNextPersonalizedChapter.mockResolvedValue({ ok: true, chapterNumber: 1 })
})

describe('resolveStoryGenerationMode', () => {
  it('no contract → standard', async () => {
    mocks.adminFactory.mockReturnValue(contractClient(null))
    const { resolveStoryGenerationMode } = await import('@/lib/runtime/generation-mode')
    await expect(resolveStoryGenerationMode('story-a')).resolves.toEqual({
      ok: true,
      mode: 'standard',
    })
  })

  it('personalized_ai contract → personalized', async () => {
    mocks.adminFactory.mockReturnValue(contractClient({ mode: 'personalized_ai' }))
    const { resolveStoryGenerationMode } = await import('@/lib/runtime/generation-mode')
    await expect(resolveStoryGenerationMode('story-a')).resolves.toEqual({
      ok: true,
      mode: 'personalized_ai',
    })
  })

  it('invalid personalized-like mode → terminal invalid, not standard fallback', async () => {
    mocks.adminFactory.mockReturnValue(contractClient({ mode: 'personalized_broken' }))
    const { resolveStoryGenerationMode } = await import('@/lib/runtime/generation-mode')
    const result = await resolveStoryGenerationMode('story-a')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('GENERATION_CONTRACT_INVALID')
  })
})

describe('runChapterGenerationAttempt dispatcher', () => {
  it('dispatches standard generator when no contract', async () => {
    mocks.adminFactory.mockReturnValue(contractClient(null))
    const { runChapterGenerationAttempt } = await import('@/lib/runtime/generation-mode')
    const out = await runChapterGenerationAttempt({
      storyId: 'story-a',
      userId: 'user-a',
      chapterNumber: 1,
      correlationId: 'c1',
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.mode).toBe('standard')
    expect(mocks.generateNextChapterReal).toHaveBeenCalledTimes(1)
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
  })

  it('dispatches personalized generator for personalized_ai', async () => {
    mocks.adminFactory.mockReturnValue(contractClient({ mode: 'personalized_ai' }))
    const { runChapterGenerationAttempt } = await import('@/lib/runtime/generation-mode')
    const out = await runChapterGenerationAttempt({
      storyId: 'story-b',
      userId: 'user-b',
      chapterNumber: 2,
      correlationId: 'c2',
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.mode).toBe('personalized_ai')
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledTimes(1)
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
  })

  it('does not call either generator when contract invalid', async () => {
    mocks.adminFactory.mockReturnValue(contractClient({ mode: 'personalized_???' }))
    const { runChapterGenerationAttempt } = await import('@/lib/runtime/generation-mode')
    const out = await runChapterGenerationAttempt({
      storyId: 'story-c',
      userId: 'user-c',
      chapterNumber: 1,
      correlationId: 'c3',
    })
    expect(out).toEqual({ ok: false, reason: 'GENERATION_CONTRACT_INVALID' })
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
  })
})
