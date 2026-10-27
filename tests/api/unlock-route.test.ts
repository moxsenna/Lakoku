import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/stories/[id]/unlock/route'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getReadingPolicy: vi.fn(),
  getCreditBalance: vi.fn(),
  spendChapterUnlock: vi.fn(),
  resolveChapterAccess: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/credits/server', () => ({
  getReadingPolicy: mocks.getReadingPolicy,
  getCreditBalance: mocks.getCreditBalance,
  spendChapterUnlock: mocks.spendChapterUnlock,
}))

vi.mock('@/lib/credits/access-resolver.server', () => ({
  resolveChapterAccess: mocks.resolveChapterAccess,
}))

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lakoku/db')>()
  return {
    ...actual,
    getDb: mocks.getDb,
  }
})

interface StoryRow {
  id: string
  owner_user_id: string
  commercial_origin: string | null
  story_mode: string
}

interface ChapterRow {
  story_id: string
  number: number
}

function createDbMock(stories: StoryRow[], chapters: ChapterRow[]) {
  return {
    selectFrom: (table: string) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      let limitCount: number | undefined
      const builder = {
        select: (_cols: unknown) => builder,
        where: (col: string, op: string, val: unknown) => {
          wheres.push({ col, op, val })
          return builder
        },
        limit: (n: number) => {
          limitCount = n
          return builder
        },
        execute: async () => {
          const rows =
            table === 'stories'
              ? (stories as unknown as Record<string, unknown>[])
              : table === 'chapters'
                ? (chapters as unknown as Record<string, unknown>[])
                : []
          let matched = rows.filter((r) =>
            wheres.every(({ col, op, val }) => {
              if (op === '=') return r[col] === val
              return false
            }),
          )
          if (limitCount !== undefined) matched = matched.slice(0, limitCount)
          return matched
        },
      }
      return builder
    },
  }
}

describe('POST /api/stories/[id]/unlock', () => {
  const userId = 'user-reader-123'
  const policy = { freeChapters: 3, creditsPerChapter: 8 }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionUser.mockResolvedValue({ id: userId })
    mocks.getReadingPolicy.mockResolvedValue(policy)
    mocks.getCreditBalance.mockResolvedValue(100)
  })

  function makeRequest(storyId: string, chapter: number): { req: Request; params: { params: Promise<{ id: string }> } } {
    const req = new Request(`http://localhost/api/stories/${storyId}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter }),
    })
    return { req, params: { params: Promise.resolve({ id: storyId }) } }
  }

  it('1. standard story, PAYMENT_REQUIRED -> calls spendChapterUnlock with refScope "reader"', async () => {
    const storyId = 'story-standard-1'
    const dbMock = createDbMock(
      [{ id: storyId, owner_user_id: 'user-author-999', commercial_origin: null, story_mode: 'standard' }],
      [],
    )
    mocks.getDb.mockReturnValue(dbMock)
    mocks.resolveChapterAccess.mockResolvedValueOnce({
      readable: false,
      reason: 'PAYMENT_REQUIRED',
      cost: 8,
    })
    mocks.spendChapterUnlock.mockResolvedValueOnce('ok')
    mocks.getCreditBalance.mockResolvedValueOnce(100).mockResolvedValueOnce(92)

    const { req, params } = makeRequest(storyId, 4)
    const res = await POST(req, params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ status: 'ok', balance: 92 })
    expect(mocks.spendChapterUnlock).toHaveBeenCalledWith(userId, storyId, 4, 8, 'reader')
  })

  it('2. personalized_ai story LEGACY_GRANDFATHERED owner ch>=4 -> calls spendChapterUnlock with refScope "canonical"', async () => {
    const storyId = 'story-legacy-1'
    const dbMock = createDbMock(
      [{ id: storyId, owner_user_id: userId, commercial_origin: 'LEGACY_GRANDFATHERED', story_mode: 'personalized_ai' }],
      [{ story_id: storyId, number: 4 }],
    )
    mocks.getDb.mockReturnValue(dbMock)
    mocks.resolveChapterAccess.mockResolvedValueOnce({
      readable: false,
      reason: 'PAYMENT_REQUIRED',
      cost: 8,
    })
    mocks.spendChapterUnlock.mockResolvedValueOnce('ok')
    mocks.getCreditBalance.mockResolvedValueOnce(100).mockResolvedValueOnce(92)

    const { req, params } = makeRequest(storyId, 4)
    const res = await POST(req, params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ status: 'ok', balance: 92 })
    expect(mocks.spendChapterUnlock).toHaveBeenCalledWith(userId, storyId, 4, 8, 'canonical')
  })

  it('3. spend "duplicate" + recheck not readable -> returns 409 not 200', async () => {
    const storyId = 'story-standard-1'
    const dbMock = createDbMock(
      [{ id: storyId, owner_user_id: 'user-author-999', commercial_origin: null, story_mode: 'standard' }],
      [],
    )
    mocks.getDb.mockReturnValue(dbMock)
    mocks.resolveChapterAccess
      .mockResolvedValueOnce({
        readable: false,
        reason: 'PAYMENT_REQUIRED',
        cost: 8,
      })
      .mockResolvedValueOnce({
        readable: false,
        reason: 'PAYMENT_REQUIRED',
        cost: 8,
      })
    mocks.spendChapterUnlock.mockResolvedValueOnce('duplicate')
    mocks.getCreditBalance.mockResolvedValue(100)

    const { req, params } = makeRequest(storyId, 4)
    const res = await POST(req, params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({ error: 'Bab belum bisa dibuka. Coba lagi sebentar.' })
    expect(mocks.resolveChapterAccess).toHaveBeenCalledTimes(2)
  })

  it('4. spend "duplicate" + recheck readable -> returns 200 status "ok"', async () => {
    const storyId = 'story-standard-1'
    const dbMock = createDbMock(
      [{ id: storyId, owner_user_id: 'user-author-999', commercial_origin: null, story_mode: 'standard' }],
      [],
    )
    mocks.getDb.mockReturnValue(dbMock)
    mocks.resolveChapterAccess
      .mockResolvedValueOnce({
        readable: false,
        reason: 'PAYMENT_REQUIRED',
        cost: 8,
      })
      .mockResolvedValueOnce({
        readable: true,
        reason: 'UNLOCKED',
        cost: 0,
      })
    mocks.spendChapterUnlock.mockResolvedValueOnce('duplicate')
    mocks.getCreditBalance.mockResolvedValue(100)

    const { req, params } = makeRequest(storyId, 4)
    const res = await POST(req, params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ status: 'ok', balance: 100 })
    expect(mocks.resolveChapterAccess).toHaveBeenCalledTimes(2)
  })

  it('5. spend "insufficient" -> returns 402 WAITING_FOR_CREDITS (regression)', async () => {
    const storyId = 'story-standard-1'
    const dbMock = createDbMock(
      [{ id: storyId, owner_user_id: 'user-author-999', commercial_origin: null, story_mode: 'standard' }],
      [],
    )
    mocks.getDb.mockReturnValue(dbMock)
    mocks.resolveChapterAccess.mockResolvedValueOnce({
      readable: false,
      reason: 'PAYMENT_REQUIRED',
      cost: 8,
    })
    mocks.spendChapterUnlock.mockResolvedValueOnce('insufficient')
    mocks.getCreditBalance.mockResolvedValue(2)

    const { req, params } = makeRequest(storyId, 4)
    const res = await POST(req, params)
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json).toEqual({
      status: 'WAITING_FOR_CREDITS',
      storyId,
      requiredCredits: 8,
      availableCredits: 2,
    })
  })

  it('6. commercial LEGACY_GRANDFATHERED: spend "duplicate" + recheck not readable -> returns 409', async () => {
    const storyId = 'story-legacy-1'
    const dbMock = createDbMock(
      [{ id: storyId, owner_user_id: userId, commercial_origin: 'LEGACY_GRANDFATHERED', story_mode: 'personalized_ai' }],
      [{ story_id: storyId, number: 4 }],
    )
    mocks.getDb.mockReturnValue(dbMock)
    mocks.resolveChapterAccess
      .mockResolvedValueOnce({
        readable: false,
        reason: 'PAYMENT_REQUIRED',
        cost: 8,
      })
      .mockResolvedValueOnce({
        readable: false,
        reason: 'PAYMENT_REQUIRED',
        cost: 8,
      })
    mocks.spendChapterUnlock.mockResolvedValueOnce('duplicate')
    mocks.getCreditBalance.mockResolvedValue(100)

    const { req, params } = makeRequest(storyId, 4)
    const res = await POST(req, params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({ error: 'Bab belum bisa dibuka. Coba lagi sebentar.' })
    expect(mocks.resolveChapterAccess).toHaveBeenCalledTimes(2)
  })
})
