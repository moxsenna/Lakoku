import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anonFactory: vi.fn(),
  adminFactory: vi.fn(),
  cookieFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.anonFactory }))
vi.mock('@/lib/supabase/env', () => ({
  requireSupabaseUrl: () => 'http://local.invalid',
  requireSupabaseAnonKey: () => 'anon-test-key',
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.adminFactory,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.cookieFactory,
}))

type Call = { method: string; args: unknown[] }

function createQueryClient(
  results: Array<{ data: unknown; error: { message: string } | null }> = [],
  user: { id: string } | null = null,
) {
  const calls: Call[] = []
  let resultIndex = 0
  const nextResult = () => results[resultIndex++] ?? { data: null, error: null }

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] })
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'or', 'order', 'lte', 'limit']) {
        builder[method] = vi.fn((...args: unknown[]) => {
          calls.push({ method, args })
          return builder
        })
      }
      builder.maybeSingle = vi.fn(async () => {
        calls.push({ method: 'maybeSingle', args: [] })
        return nextResult()
      })
      builder.upsert = vi.fn(async (...args: unknown[]) => {
        calls.push({ method: 'upsert', args })
        return nextResult()
      })
      builder.then = (
        resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(nextResult()).then(resolve, reject)
      return builder
    }),
  }

  return { client, calls }
}

const storyRow = {
  id: 'private:a',
  title: 'Cerita A',
  cover: '/a.webp',
  tagline: 'Tagline',
  role: 'Detektif',
  tropes: [],
  total_chapters: 50,
  synopsis: 'Sinopsis',
  status: 'BARU',
  current_chapter: 1,
  jejak: [],
  ending_name: null,
  owner_user_id: 'must-not-leak',
  story_mode: 'personalized_ai',
  generation_status: 'ready',
}

beforeEach(() => {
  mocks.anonFactory.mockReset()
  mocks.adminFactory.mockReset()
  mocks.cookieFactory.mockReset()
})

describe('reader-safe query projections', () => {
  it('exports exact Task 3-compatible projection strings', async () => {
    const queries = await import('@/lib/api/queries')
    const userState = await import('@/lib/api/user-state')

    expect(queries.STORY_READER_COLUMNS).toBe(
      'id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name',
    )
    expect(queries.CHAPTER_READER_COLUMNS).toBe(
      'story_id,number,title,paragraphs,choice_prompt,choices',
    )
    expect(queries.OUTCOME_READER_COLUMNS).toBe(
      'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending',
    )
    expect(userState.READER_STATE_PUBLIC_COLUMNS).toBe(
      'user_id,story_id,status,current_chapter,jejak,ending_name,updated_at',
    )
    expect(queries.STORY_READER_COLUMNS).not.toMatch(
      /owner_user_id|visibility|story_mode|generation_status|created_at/,
    )
    expect(queries.STORY_READER_COLUMNS.split(',')).toEqual([
      'id',
      'title',
      'cover',
      'tagline',
      'role',
      'tropes',
      'total_chapters',
      'synopsis',
      'status',
      'current_chapter',
      'jejak',
      'ending_name',
    ])
  })

  it('returns [] for empty owned IDs without touching database', async () => {
    const queries = await import('@/lib/api/queries')

    await expect(queries.queryStoriesByIdsForUser([], 'user-a')).resolves.toEqual([])
    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(mocks.cookieFactory).not.toHaveBeenCalled()
  })

  it('reads library IDs with trusted owner/public filter and safe projection', async () => {
    const db = createQueryClient([{ data: [storyRow], error: null }])
    mocks.adminFactory.mockReturnValue(db.client)
    const queries = await import('@/lib/api/queries')

    const stories = await queries.queryStoriesByIdsForUser(
      ['private:a', 'public:demo'],
      '00000000-0000-0000-0000-00000000000a',
    )

    expect(db.calls).toContainEqual({ method: 'select', args: [queries.STORY_READER_COLUMNS] })
    expect(db.calls).toContainEqual({
      method: 'in',
      args: ['id', ['private:a', 'public:demo']],
    })
    expect(db.calls).toContainEqual({
      method: 'or',
      args: [
        'visibility.eq.public,owner_user_id.eq.00000000-0000-0000-0000-00000000000a',
      ],
    })
    expect(stories[0]).not.toHaveProperty('owner_user_id')
    expect(stories[0]).not.toHaveProperty('story_mode')
  })

  it('fetches explore rows only after public official filters', async () => {
    const db = createQueryClient([{ data: [storyRow], error: null }])
    mocks.adminFactory.mockReturnValue(db.client)
    const queries = await import('@/lib/api/queries')

    await queries.queryExploreStories()

    expect(db.calls).toContainEqual({ method: 'select', args: [queries.STORY_READER_COLUMNS] })
    expect(db.calls).toContainEqual({ method: 'eq', args: ['visibility', 'public'] })
    expect(db.calls).toContainEqual({
      method: 'or',
      args: ['id.like.demo:%,id.like.premium:%'],
    })
    expect(db.calls.some((call) => call.args.includes('story_mode'))).toBe(false)
  })

  it('returns public detail to an anonymous reader through public filter', async () => {
    const db = createQueryClient([{ data: storyRow, error: null }])
    mocks.adminFactory.mockReturnValue(db.client)
    const queries = await import('@/lib/api/queries')

    await expect(queries.queryStoryForUser('demo:public', null)).resolves.toMatchObject({
      id: 'private:a',
      title: 'Cerita A',
    })

    expect(db.calls).toContainEqual({ method: 'select', args: [queries.STORY_READER_COLUMNS] })
    expect(db.calls).toContainEqual({ method: 'eq', args: ['id', 'demo:public'] })
    expect(db.calls).toContainEqual({ method: 'eq', args: ['visibility', 'public'] })
    expect(db.calls.some((call) => call.method === 'or')).toBe(false)
  })

  it('returns null when authenticated reader requests another owner private detail', async () => {
    const db = createQueryClient([{ data: null, error: null }])
    mocks.adminFactory.mockReturnValue(db.client)
    const queries = await import('@/lib/api/queries')

    await expect(
      queries.queryStoryForUser(
        'private:a',
        '00000000-0000-0000-0000-00000000000b',
      ),
    ).resolves.toBeNull()
    expect(db.calls).toContainEqual({
      method: 'or',
      args: [
        'visibility.eq.public,owner_user_id.eq.00000000-0000-0000-0000-00000000000b',
      ],
    })
  })

  it('allows authenticated detail through public-or-exact-owner filter', async () => {
    const db = createQueryClient([{ data: storyRow, error: null }])
    mocks.adminFactory.mockReturnValue(db.client)
    const queries = await import('@/lib/api/queries')

    const story = await queries.queryStoryForUser(
      'private:a',
      '00000000-0000-0000-0000-00000000000a',
    )

    expect(db.calls).toContainEqual({
      method: 'or',
      args: [
        'visibility.eq.public,owner_user_id.eq.00000000-0000-0000-0000-00000000000a',
      ],
    })
    expect(story).not.toHaveProperty('owner_user_id')
  })

  it('uses safe chapter and outcome projections through cookie RLS client', async () => {
    const chapterRow = {
      story_id: 'private:a',
      number: 1,
      title: 'Bab 1',
      paragraphs: ['Isi'],
      choice_prompt: null,
      choices: null,
    }
    const outcomeRow = {
      story_id: 'private:a',
      chapter_number: 1,
      choice_id: 'pilih-a',
      consequence: ['Akibat'],
      next_chapter_number: 2,
      is_ending: false,
    }
    const db = createQueryClient([
      { data: chapterRow, error: null },
      { data: outcomeRow, error: null },
    ])
    mocks.cookieFactory.mockResolvedValue(db.client)
    const queries = await import('@/lib/api/queries')

    await queries.queryChapter('private:a', 1)
    await queries.queryChoiceOutcome('private:a', 1, 'pilih-a')

    expect(db.calls).toContainEqual({ method: 'select', args: [queries.CHAPTER_READER_COLUMNS] })
    expect(db.calls).toContainEqual({ method: 'select', args: [queries.OUTCOME_READER_COLUMNS] })
    expect(db.calls.some((call) => call.method === 'select' && call.args[0] === '*')).toBe(false)
  })
})

describe('reader-state grant compatibility', () => {
  it('uses explicit read projection and grant-compatible upsert payload', async () => {
    const existing = {
      user_id: 'user-a',
      story_id: 'private:a',
      status: 'BERJALAN',
      current_chapter: 2,
      jejak: [],
      ending_name: null,
      updated_at: '2026-07-12T00:00:00.000Z',
    }
    const db = createQueryClient(
      [
        { data: [existing], error: null },
        { data: existing, error: null },
        { data: null, error: null },
      ],
      { id: 'user-a' },
    )
    mocks.cookieFactory.mockResolvedValue(db.client)
    const userState = await import('@/lib/api/user-state')

    await userState.getReaderStates()
    await userState.ensureReaderStateStarted('private:a', 3)

    expect(db.calls).toContainEqual({
      method: 'select',
      args: [userState.READER_STATE_PUBLIC_COLUMNS],
    })
    const upsert = db.calls.find((call) => call.method === 'upsert')
    expect(upsert?.args[0]).toEqual(
      expect.objectContaining({
        user_id: 'user-a',
        story_id: 'private:a',
        status: 'BERJALAN',
        current_chapter: 3,
        jejak: [],
        ending_name: null,
        updated_at: expect.any(String),
      }),
    )
    expect(Object.keys(upsert?.args[0] as object).sort()).toEqual(
      ['current_chapter', 'ending_name', 'jejak', 'status', 'story_id', 'updated_at', 'user_id'].sort(),
    )
  })
})

describe('ownership-aware server orchestration', () => {
  it('builds library from reader-state IDs and owned query', async () => {
    vi.resetModules()
    const queryStoriesByIdsForUser = vi.fn(async () => [
      {
        id: 'private:a',
        title: 'Cerita A',
        cover: '/a.webp',
        tagline: 'Tagline',
        role: 'Detektif',
        tropes: [],
        totalChapters: 50,
        synopsis: 'Sinopsis',
        status: 'BARU',
        currentChapter: 1,
        jejak: [],
      },
    ])
    const queryExploreStories = vi.fn(async () => [])
    const queryStoryForUser = vi.fn(async () => null)
    const queryChapter = vi.fn(async () => null)
    vi.doMock('@/lib/api/queries', () => ({
      queryStories: vi.fn(async () => []),
      queryStory: vi.fn(async () => null),
      queryStoriesByIdsForUser,
      queryExploreStories,
      queryStoryForUser,
      queryChapter,
      queryLatestAvailableChapter: vi.fn(async () => null),
      queryChapterMetadatas: vi.fn(async () => []),
    }))
    vi.doMock('@/lib/api/leases', () => ({
      isChapterPreparing: vi.fn(async () => false),
    }))
    vi.doMock('@/lib/api/user-state', () => ({
      getSessionUser: vi.fn(async () => ({ id: 'user-a' })),
      getReaderStates: vi.fn(async () =>
        new Map([
          [
            'private:a',
            {
              storyId: 'private:a',
              status: 'BERJALAN',
              currentChapter: 4,
              jejak: [],
            },
          ],
        ]),
      ),
      getReaderState: vi.fn(async () => null),
    }))
    const server = await import('@/lib/api/server')

    const library = await server.listMyLibraryStories()

    expect(queryStoriesByIdsForUser).toHaveBeenCalledWith(['private:a'], 'user-a')
    expect(library[0]).toMatchObject({ id: 'private:a', status: 'BERJALAN', currentChapter: 4 })
  })

  it('authorizes parent before reading guessed chapter', async () => {
    vi.resetModules()
    const order: string[] = []
    const queryStoryForUser = vi.fn(async () => {
      order.push('parent')
      return null
    })
    const queryChapter = vi.fn(async () => {
      order.push('chapter')
      return null
    })
    vi.doMock('@/lib/api/queries', () => ({
      queryStories: vi.fn(async () => []),
      queryStory: vi.fn(async () => null),
      queryStoriesByIdsForUser: vi.fn(async () => []),
      queryExploreStories: vi.fn(async () => []),
      queryStoryForUser,
      queryChapter,
      queryLatestAvailableChapter: vi.fn(async () => null),
      queryChapterMetadatas: vi.fn(async () => []),
    }))
    vi.doMock('@/lib/api/leases', () => ({
      isChapterPreparing: vi.fn(async () => false),
    }))
    vi.doMock('@/lib/api/user-state', () => ({
      getSessionUser: vi.fn(async () => ({ id: 'user-b' })),
      getReaderStates: vi.fn(async () => new Map()),
      getReaderState: vi.fn(async () => null),
    }))
    const server = await import('@/lib/api/server')

    await expect(server.getChapter('private:a', 7)).resolves.toBeNull()
    expect(order).toEqual(['parent'])
    expect(queryChapter).not.toHaveBeenCalled()
  })
})
