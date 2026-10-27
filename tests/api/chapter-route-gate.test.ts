import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChapter: vi.fn(),
  getSessionUser: vi.fn(),
  getReadingPolicy: vi.fn(),
  resolveChapterAccess: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/server', () => ({
  getChapter: mocks.getChapter,
}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/credits/server', () => ({
  getReadingPolicy: mocks.getReadingPolicy,
}))

vi.mock('@/lib/credits/access-resolver.server', () => ({
  resolveChapterAccess: mocks.resolveChapterAccess,
}))

describe('GET /api/stories/[id]/chapters/[number] access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
    mocks.getReadingPolicy.mockResolvedValue({
      freeTierChapters: 3,
      creditsPerChapter: 10,
    })
  })

  it('case 1: public story chapter 2, resolver FREE_STANDARD -> 200 with chapter', async () => {
    const sampleChapter = {
      storyId: 'story-public',
      number: 2,
      title: 'Bab Dua',
      paragraphs: ['Paragraf bab 2'],
      choices: [],
    }
    mocks.getChapter.mockResolvedValue(sampleChapter)
    mocks.resolveChapterAccess.mockResolvedValue({
      readable: true,
      reason: 'FREE_STANDARD',
      cost: 0,
    })

    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/route')
    const req = new Request('http://localhost/api/stories/story-public/chapters/2')
    const res = await GET(req, {
      params: Promise.resolve({ id: 'story-public', number: '2' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ chapter: sampleChapter })
    expect(mocks.resolveChapterAccess).toHaveBeenCalledWith({
      userId: 'user-1',
      storyId: 'story-public',
      chapterNumber: 2,
      policy: { freeTierChapters: 3, creditsPerChapter: 10 },
    })
  })

  it('case 2: chapter 5, guest user, resolver PAYMENT_REQUIRED -> 402 without chapter/paragraphs', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const sampleChapter = {
      storyId: 'story-public',
      number: 5,
      title: 'Bab Lima',
      paragraphs: ['Paragraf rahasia berbayar'],
      choices: [],
    }
    mocks.getChapter.mockResolvedValue(sampleChapter)
    mocks.resolveChapterAccess.mockResolvedValue({
      readable: false,
      reason: 'PAYMENT_REQUIRED',
      cost: 10,
    })

    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/route')
    const req = new Request('http://localhost/api/stories/story-public/chapters/5')
    const res = await GET(req, {
      params: Promise.resolve({ id: 'story-public', number: '5' }),
    })

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body).toEqual({ error: 'Bab ini perlu dibuka dulu.' })
    expect(body.chapter).toBeUndefined()
    expect(body.paragraphs).toBeUndefined()
    expect(mocks.resolveChapterAccess).toHaveBeenCalledWith({
      userId: null,
      storyId: 'story-public',
      chapterNumber: 5,
      policy: { freeTierChapters: 3, creditsPerChapter: 10 },
    })
  })

  it('case 3: resolver NOT_AUTHORIZED -> 403 without chapter content', async () => {
    const sampleChapter = {
      storyId: 'story-private',
      number: 2,
      title: 'Bab Rahasia',
      paragraphs: ['Konten privat'],
      choices: [],
    }
    mocks.getChapter.mockResolvedValue(sampleChapter)
    mocks.resolveChapterAccess.mockResolvedValue({
      readable: false,
      reason: 'NOT_AUTHORIZED',
      cost: 0,
    })

    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/route')
    const req = new Request('http://localhost/api/stories/story-private/chapters/2')
    const res = await GET(req, {
      params: Promise.resolve({ id: 'story-private', number: '2' }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Tidak diizinkan.' })
    expect(body.chapter).toBeUndefined()
    expect(body.paragraphs).toBeUndefined()
  })

  it('case 4: getChapter fallback returns chapter 4 for requested chapter 6 -> resolver called with chapterNumber: 4', async () => {
    const fallbackChapter = {
      storyId: 'story-fallback',
      number: 4,
      title: 'Bab Empat Terakhir',
      paragraphs: ['Konten bab 4'],
      choices: [],
    }
    mocks.getChapter.mockResolvedValue(fallbackChapter)
    mocks.resolveChapterAccess.mockResolvedValue({
      readable: true,
      reason: 'FREE_STANDARD',
      cost: 0,
    })

    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/route')
    const req = new Request('http://localhost/api/stories/story-fallback/chapters/6')
    const res = await GET(req, {
      params: Promise.resolve({ id: 'story-fallback', number: '6' }),
    })

    expect(res.status).toBe(200)
    expect(mocks.resolveChapterAccess).toHaveBeenCalledWith({
      userId: 'user-1',
      storyId: 'story-fallback',
      chapterNumber: 4,
      policy: { freeTierChapters: 3, creditsPerChapter: 10 },
    })
  })

  it('case 5: readable LEDGER_UNLOCKED -> 200', async () => {
    const paidChapter = {
      storyId: 'story-public',
      number: 7,
      title: 'Bab Tujuh',
      paragraphs: ['Konten bab 7 yang sudah dibeli'],
      choices: [],
    }
    mocks.getChapter.mockResolvedValue(paidChapter)
    mocks.resolveChapterAccess.mockResolvedValue({
      readable: true,
      reason: 'LEDGER_UNLOCKED',
      cost: 0,
    })

    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/route')
    const req = new Request('http://localhost/api/stories/story-public/chapters/7')
    const res = await GET(req, {
      params: Promise.resolve({ id: 'story-public', number: '7' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ chapter: paidChapter })
  })
})
