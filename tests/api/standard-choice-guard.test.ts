import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealGenerateResult } from '@/lib/runtime/story-generation'

const mocks = vi.hoisted(() => ({
  generateNextPersonalizedChapter: vi.fn(),
  generateNextChapterReal: vi.fn(),
  after: vi.fn(),
  queryChoiceOutcome: vi.fn(),
  queryChapter: vi.fn(),
  queryStoryForUser: vi.fn(),
  applyChoiceToUserState: vi.fn(),
  getSessionUser: vi.fn(),
  isStoryOwnedBy: vi.fn(),
  maybeGrantAuthorTinta: vi.fn(),
  getReadingPolicy: vi.fn(),
  resolveChapterAccess: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: mocks.after }
})
vi.mock('@/lib/runtime/personalized-generation', () => ({
  generateNextPersonalizedChapter: mocks.generateNextPersonalizedChapter,
}))
vi.mock('@/lib/runtime/story-generation', () => ({
  generateNextChapterReal: mocks.generateNextChapterReal,
}))
vi.mock('@/lib/api/queries', () => ({
  queryChoiceOutcome: mocks.queryChoiceOutcome,
  queryChapter: mocks.queryChapter,
  queryStoryForUser: mocks.queryStoryForUser,
}))
vi.mock('@/lib/api/user-state', () => ({
  applyChoiceToUserState: mocks.applyChoiceToUserState,
  getSessionUser: mocks.getSessionUser,
}))
vi.mock('@/lib/api/story-ownership.server', () => ({
  isStoryOwnedBy: mocks.isStoryOwnedBy,
}))
vi.mock('@/lib/api/personalized-choice.server', () => {
  class PersonalizedChoiceError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'PersonalizedChoiceError'
    }
  }
  return {
    PersonalizedChoiceError,
    applyPersonalizedChoice: vi.fn(async () => {
      throw new PersonalizedChoiceError('NOT_PERSONALIZED_STORY')
    }),
  }
})
vi.mock('@/lib/credits/server', () => ({
  getReadingPolicy: mocks.getReadingPolicy,
}))
vi.mock('@/lib/credits/access-resolver.server', () => ({
  resolveChapterAccess: mocks.resolveChapterAccess,
}))
vi.mock('@/lib/tinta/author-reward.server', () => ({
  maybeGrantAuthorTinta: mocks.maybeGrantAuthorTinta,
}))

const userId = '10000000-0000-4000-8000-000000999999'
const standardStoryId = 'demo:standard-public'
const choiceId = 'standard-choice'

const publicOutcome = {
  storyId: standardStoryId,
  chapterNumber: 1,
  choiceId,
  consequence: ['Jalur publik.'],
  nextChapterNumber: 2,
  isEnding: false,
}

function publishedResult(chapterNumber = 2): RealGenerateResult {
  return { ok: true, chapterNumber, seq: 1, repairAttempts: 0 }
}

function choiceRequest(body: unknown = { chapterNumber: 1, choiceId }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.set('Idempotency-Key', `choice:${standardStoryId}:1:${choiceId}`)
  return new Request(
    `http://localhost/api/stories/${encodeURIComponent(standardStoryId)}/choices`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.after.mockImplementation(() => undefined)
  mocks.generateNextPersonalizedChapter.mockResolvedValue(publishedResult())
  mocks.generateNextChapterReal.mockResolvedValue(publishedResult())
  mocks.getSessionUser.mockResolvedValue({ id: userId })
  mocks.queryChoiceOutcome.mockResolvedValue(publicOutcome)
  mocks.queryStoryForUser.mockResolvedValue({ id: standardStoryId, visibility: 'public' })
  mocks.queryChapter.mockResolvedValue({
    storyId: standardStoryId,
    number: 1,
    title: 'Bab 1',
    paragraphs: ['Isi'],
    choices: [{ id: choiceId, label: 'Pilih standar' }],
  })
  mocks.applyChoiceToUserState.mockResolvedValue(undefined)
  mocks.isStoryOwnedBy.mockResolvedValue(false)
  mocks.maybeGrantAuthorTinta.mockResolvedValue(undefined)
  mocks.getReadingPolicy.mockResolvedValue({
    freeTierChapters: 3,
    creditsPerChapter: 10,
  })
  mocks.resolveChapterAccess.mockResolvedValue({
    readable: true,
    reason: 'FREE_STANDARD',
    cost: 0,
  })
})

describe('standard public ownership guard', () => {
  it('does NOT trigger generation for non-owner on public standard story', async () => {
    mocks.isStoryOwnedBy.mockResolvedValue(false)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: standardStoryId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ outcome: publicOutcome })
    expect(body).not.toHaveProperty('nextChapterReady')
    expect(mocks.isStoryOwnedBy).toHaveBeenCalledWith(standardStoryId, userId)
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('triggers generation for owner on private standard story', async () => {
    mocks.isStoryOwnedBy.mockResolvedValue(true)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: standardStoryId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ outcome: publicOutcome, nextChapterReady: true })
    expect(mocks.isStoryOwnedBy).toHaveBeenCalledWith(standardStoryId, userId)
    expect(mocks.generateNextChapterReal).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: standardStoryId,
        userId,
        chapterNumber: 2,
        triggerChoiceId: choiceId,
      }),
    )
  })

  it('forwards exact triggerChoiceId from choice submission to generator', async () => {
    mocks.isStoryOwnedBy.mockResolvedValue(true)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    await POST(choiceRequest({ chapterNumber: 1, choiceId }), {
      params: Promise.resolve({ id: standardStoryId }),
    })

    const arg = mocks.generateNextChapterReal.mock.calls[0][0]
    expect(arg.triggerChoiceId).toBe(choiceId)
  })

  it('omits triggerChoiceId property entirely when not provided by caller', async () => {
    const { continueStandardGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )

    await continueStandardGeneration({
      storyId: `${standardStoryId}:omit`,
      userId,
      chapterNumber: 2,
      correlationId: '20000000-0000-4000-8000-0000000000aa',
    })

    const arg = mocks.generateNextChapterReal.mock.calls[0][0]
    expect(arg).not.toHaveProperty('triggerChoiceId')
  })

  it('preserves explicit null triggerChoiceId through continueStandardGeneration', async () => {
    const { continueStandardGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )

    await continueStandardGeneration({
      storyId: `${standardStoryId}:null`,
      userId,
      chapterNumber: 2,
      correlationId: '20000000-0000-4000-8000-0000000000ab',
      triggerChoiceId: null,
    })

    const arg = mocks.generateNextChapterReal.mock.calls[0][0]
    expect(arg).toHaveProperty('triggerChoiceId', null)
  })

  it('Isolation Guard: returns 404 when story is not visible or owned by user', async () => {
    mocks.queryStoryForUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: 'private-story-not-owned' }),
    })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Pilihan tidak dikenali.' })
    expect(mocks.queryStoryForUser).toHaveBeenCalledWith('private-story-not-owned', userId)
    expect(mocks.queryChoiceOutcome).not.toHaveBeenCalled()
    expect(mocks.queryChapter).not.toHaveBeenCalled()
  })

  describe('chapter access gate on standard path', () => {
    it('returns 402 when resolver reports PAYMENT_REQUIRED on chapter 5 of public story', async () => {
      mocks.resolveChapterAccess.mockResolvedValue({
        readable: false,
        reason: 'PAYMENT_REQUIRED',
        cost: 10,
      })
      const { POST } = await import('@/app/api/stories/[id]/choices/route')

      const response = await POST(choiceRequest({ chapterNumber: 5, choiceId }), {
        params: Promise.resolve({ id: standardStoryId }),
      })
      const body = await response.json()

      expect(response.status).toBe(402)
      expect(body).toEqual({ error: 'Bab ini perlu dibuka dulu.' })
      expect(mocks.resolveChapterAccess).toHaveBeenCalledWith({
        userId,
        storyId: standardStoryId,
        chapterNumber: 5,
        policy: expect.objectContaining({ freeTierChapters: 3, creditsPerChapter: 10 }),
      })
      expect(mocks.queryChoiceOutcome).not.toHaveBeenCalled()
      expect(mocks.applyChoiceToUserState).not.toHaveBeenCalled()
      expect(mocks.maybeGrantAuthorTinta).not.toHaveBeenCalled()
      expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
    })

    it('returns 403 without side effects when resolver reports NOT_AUTHORIZED', async () => {
      mocks.resolveChapterAccess.mockResolvedValue({
        readable: false,
        reason: 'NOT_AUTHORIZED',
        cost: 0,
      })
      const { POST } = await import('@/app/api/stories/[id]/choices/route')

      const response = await POST(choiceRequest({ chapterNumber: 1, choiceId }), {
        params: Promise.resolve({ id: standardStoryId }),
      })
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body).toEqual({ error: 'Tidak diizinkan.' })
      expect(mocks.queryChoiceOutcome).not.toHaveBeenCalled()
      expect(mocks.applyChoiceToUserState).not.toHaveBeenCalled()
      expect(mocks.maybeGrantAuthorTinta).not.toHaveBeenCalled()
      expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
    })

    it('returns outcome and applies state when chapter 2 is FREE_STANDARD', async () => {
      mocks.resolveChapterAccess.mockResolvedValue({
        readable: true,
        reason: 'FREE_STANDARD',
        cost: 0,
      })
      const { POST } = await import('@/app/api/stories/[id]/choices/route')

      const response = await POST(choiceRequest({ chapterNumber: 2, choiceId }), {
        params: Promise.resolve({ id: standardStoryId }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ outcome: publicOutcome })
      expect(mocks.resolveChapterAccess).toHaveBeenCalledWith({
        userId,
        storyId: standardStoryId,
        chapterNumber: 2,
        policy: expect.any(Object),
      })
      expect(mocks.queryChoiceOutcome).toHaveBeenCalledWith(standardStoryId, 2, choiceId)
      expect(mocks.applyChoiceToUserState).toHaveBeenCalledTimes(1)
      expect(mocks.maybeGrantAuthorTinta).toHaveBeenCalledWith({
        readerUserId: userId,
        storyId: standardStoryId,
        chapterNumber: 2,
      })
    })

    it('triggers continueStandardGeneration when owner submits choice on readable chapter', async () => {
      mocks.isStoryOwnedBy.mockResolvedValue(true)
      mocks.resolveChapterAccess.mockResolvedValue({
        readable: true,
        reason: 'FREE_STANDARD',
        cost: 0,
      })
      const { POST } = await import('@/app/api/stories/[id]/choices/route')

      const response = await POST(choiceRequest({ chapterNumber: 1, choiceId }), {
        params: Promise.resolve({ id: standardStoryId }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ outcome: publicOutcome, nextChapterReady: true })
      expect(mocks.generateNextChapterReal).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: standardStoryId,
          userId,
          chapterNumber: 2,
          triggerChoiceId: choiceId,
        }),
      )
    })
  })
})
