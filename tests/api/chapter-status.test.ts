import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  queryStoryForUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/api/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/queries')>('@/lib/api/queries')
  return {
    ...actual,
    queryStoryForUser: mocks.queryStoryForUser,
  }
})

type DbResult = { data: unknown; error: { message: string; code?: string } | null }
type Call = { table?: string; method: string; args: unknown[]; filters: Array<[string, unknown]> }

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const STORY_A = 'ai:status-story-a'

function createCookieDb(input?: {
  user?: { id: string } | null
  userError?: { message: string } | null
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: input?.user === undefined ? { id: USER_A } : input.user },
        error: input?.userError ?? null,
      })),
    },
  }
}

function createAdminDb(input: {
  chapter?: DbResult
  leases?: DbResult
  events?: DbResult
}) {
  const calls: Call[] = []
  const client = {
    from: vi.fn((table: string) => {
      const filters: Array<[string, unknown]> = []
      const builder: Record<string, unknown> = {}
      const chain = (...methods: string[]) => {
        for (const method of methods) {
          builder[method] = vi.fn((...args: unknown[]) => {
            if (method === 'eq' || method === 'gt' || method === 'order' || method === 'limit' || method === 'in') {
              filters.push([method, args])
            }
            calls.push({ table, method, args, filters: [...filters] })
            return builder
          })
        }
      }
      chain('select', 'eq', 'gt', 'order', 'limit', 'in')
      builder.maybeSingle = vi.fn(async () => {
        calls.push({ table, method: 'maybeSingle', args: [], filters: [...filters] })
        if (table === 'chapters') return input.chapter ?? { data: null, error: null }
        if (table === 'generation_leases') return input.leases ?? { data: null, error: null }
        return { data: null, error: null }
      })
      // list path for events
      builder.then = (
        onfulfilled?: (value: DbResult) => unknown,
        onrejected?: (reason: unknown) => unknown,
      ) => {
        const run = async (): Promise<DbResult> => {
          if (table === 'story_events') return input.events ?? { data: [], error: null }
          if (table === 'generation_leases') return input.leases ?? { data: null, error: null }
          if (table === 'chapters') return input.chapter ?? { data: null, error: null }
          return { data: null, error: null }
        }
        return run().then(onfulfilled, onrejected)
      }
      return builder
    }),
  }
  return { client, calls }
}

function request(storyId = STORY_A, chapterNumber = 2) {
  return new Request(
    `http://localhost/api/stories/${encodeURIComponent(storyId)}/chapters/${chapterNumber}/status`,
    { method: 'GET' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.cookieFactory.mockResolvedValue(createCookieDb())
  mocks.queryStoryForUser.mockResolvedValue({
    id: STORY_A,
    title: 'Status Story',
    totalChapters: 50,
  })
  mocks.adminFactory.mockReturnValue(createAdminDb({}).client)
})

describe('getChapterStatusForUser', () => {
  it('returns ready when chapter exists and never queries stories.generation_status', async () => {
    const fixture = createAdminDb({
      chapter: { data: { story_id: STORY_A, number: 2 }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toBe('ready')

    expect(mocks.queryStoryForUser).toHaveBeenCalledWith(STORY_A, USER_A)
    const tables = fixture.calls.map((call) => call.table)
    expect(tables).toContain('chapters')
    expect(tables).not.toContain('stories')
    expect(JSON.stringify(fixture.calls)).not.toContain('generation_status')
  })

  it('returns generating for exact active unexpired lease when chapter missing', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: {
        data: {
          id: 'lease-1',
          story_id: STORY_A,
          chapter_number: 2,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toBe('generating')
  })

  it('ignores stale or other-chapter leases and falls through to latest failed attempt', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: {
        data: [
          {
            seq: 9,
            type: 'GENERATION_ATTEMPT',
            payload: {
              chapter_number: 2,
              outcome: 'REVIEW_REQUIRED',
            },
            created_at: '2026-07-15T01:00:00.000Z',
          },
        ],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toBe('failed')
  })

  it('prefers active lease over older failed attempt', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: {
        data: {
          id: 'lease-active',
          story_id: STORY_A,
          chapter_number: 3,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + 30_000).toISOString(),
        },
        error: null,
      },
      events: {
        data: [
          {
            seq: 4,
            type: 'GENERATION_ATTEMPT',
            payload: { chapter_number: 3, outcome: 'REVIEW_REQUIRED' },
            created_at: '2026-07-15T00:00:00.000Z',
          },
        ],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 3,
    })).resolves.toBe('generating')
  })

  it('returns failed when no chapter, no live lease, and no exact failure (dead generation)', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: { data: [], error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 4,
    })).resolves.toBe('failed')
  })

  it('denies private story for non-owner and anon before lease/event reads', async () => {
    mocks.queryStoryForUser.mockResolvedValue(null)
    const fixture = createAdminDb({})
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser, ChapterStatusError } = await import(
      '@/lib/api/chapter-status.server'
    )

    await expect(getChapterStatusForUser({
      userId: USER_B,
      storyId: STORY_A,
      chapterNumber: 2,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getChapterStatusForUser({
      userId: null,
      storyId: STORY_A,
      chapterNumber: 2,
    })).rejects.toBeInstanceOf(ChapterStatusError)

    expect(fixture.calls.some((call) => call.table === 'generation_leases')).toBe(false)
    expect(fixture.calls.some((call) => call.table === 'story_events')).toBe(false)
  })

  it('ignores failed attempts for different chapters and published outcomes', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: {
        data: [
          {
            seq: 1,
            type: 'GENERATION_ATTEMPT',
            payload: { chapter_number: 1, outcome: 'REVIEW_REQUIRED' },
            created_at: '2026-07-15T00:00:00.000Z',
          },
          {
            seq: 2,
            type: 'GENERATION_ATTEMPT',
            payload: { chapter_number: 2, outcome: 'PUBLISHED' },
            created_at: '2026-07-15T00:01:00.000Z',
          },
        ],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toBe('failed')
  })
})

describe('GET /api/stories/[id]/chapters/[number]/status', () => {
  it('returns 400 for invalid chapter number', async () => {
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(STORY_A, 0), {
      params: Promise.resolve({ id: STORY_A, number: '0' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Nomor bab tidak valid.' })
  })

  it('returns 401 when session missing for private status', async () => {
    mocks.cookieFactory.mockResolvedValue(createCookieDb({ user: null }))
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Tidak diizinkan.' })
  })

  it('returns 404 for non-owner private story', async () => {
    mocks.queryStoryForUser.mockResolvedValue(null)
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Cerita tidak ditemukan.' })
  })

  it('returns reader-safe ready payload only', async () => {
    const fixture = createAdminDb({
      chapter: { data: { story_id: STORY_A, number: 2 }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ status: 'ready', chapterNumber: 2 })
    expect(json).not.toHaveProperty('lease')
    expect(json).not.toHaveProperty('generation_status')
    expect(json).not.toHaveProperty('payload')
    expect(json).not.toHaveProperty('owner')
  })
})
