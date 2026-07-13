import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  ensureReaderStateStarted: vi.fn(),
  runLockLadder: vi.fn(),
  persistStoryBible: vi.fn(),
  enrichOpeningVoiceSheets: vi.fn(),
  generateNextChapterReal: vi.fn(),
  after: vi.fn(),
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
  ensureReaderStateStarted: mocks.ensureReaderStateStarted,
}))
vi.mock('@/lib/authoring/server', () => ({
  proposePremises: vi.fn(),
  refinePremise: vi.fn(),
  proposeCast: vi.fn(),
  proposeMystery: vi.fn(),
  proposeWorld: vi.fn(),
  persistStoryBible: mocks.persistStoryBible,
  makeVoiceSheetAuthor: vi.fn(),
  publicAuthoringErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga.',
}))
vi.mock('@/lib/authoring/repair', () => ({ runLockLadder: mocks.runLockLadder }))
vi.mock('@/lib/authoring', () => ({
  enrichOpeningVoiceSheets: mocks.enrichOpeningVoiceSheets,
}))
vi.mock('@lakoku/runtime', () => ({
  generateNextChapterReal: mocks.generateNextChapterReal,
}))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.adminFactory,
}))

function ownerQuery(owner: boolean) {
  const calls: string[] = []
  const builder = {
    select: vi.fn(() => {
      calls.push('select')
      return builder
    }),
    eq: vi.fn(() => {
      calls.push('eq')
      return builder
    }),
    maybeSingle: vi.fn(async () => {
      calls.push('maybeSingle')
      return { data: owner ? { id: 'story-a' } : null, error: null }
    }),
  }
  return {
    client: { from: vi.fn(() => builder) },
    calls,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.after.mockImplementation((callback: () => Promise<void>) => callback())
  mocks.generateNextChapterReal.mockResolvedValue({ ok: true, chapterNumber: 1 })
  mocks.ensureReaderStateStarted.mockResolvedValue(undefined)
})

describe('brainstorm action authorization', () => {
  it('rejects anonymous lock before validation, enrichment, or persistence', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.lockStoryBible({} as never)

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(mocks.runLockLadder).not.toHaveBeenCalled()
    expect(mocks.enrichOpeningVoiceSheets).not.toHaveBeenCalled()
    expect(mocks.persistStoryBible).not.toHaveBeenCalled()
  })

  it('rejects anonymous chapter start before owner lookup or scheduling', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const db = ownerQuery(true)
    mocks.adminFactory.mockReturnValue(db.client)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.startFirstChapter('story-a')

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
  })

  it('rejects another owner before scheduling or generation', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-b' })
    const db = ownerQuery(false)
    mocks.adminFactory.mockReturnValue(db.client)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.startFirstChapter('story-a')

    expect(result).toEqual({ ok: false, error: 'Cerita tidak ditemukan.' })
    expect(db.client.from).toHaveBeenCalledWith('stories')
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
    expect(mocks.ensureReaderStateStarted).not.toHaveBeenCalled()
  })

  it('schedules generation only after exact owner authorization', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    const db = ownerQuery(true)
    mocks.adminFactory.mockReturnValue(db.client)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.startFirstChapter('story-a')

    expect(result).toEqual({ ok: true, chapterNumber: 1 })
    expect(db.client.from).toHaveBeenCalledWith('stories')
    expect(db.calls).toEqual(['select', 'eq', 'eq', 'maybeSingle'])
    expect(mocks.after).toHaveBeenCalledTimes(1)
    expect(mocks.generateNextChapterReal).toHaveBeenCalledWith('story-a', 1)
    expect(mocks.ensureReaderStateStarted).toHaveBeenCalledWith('story-a', 1)
  })
})
