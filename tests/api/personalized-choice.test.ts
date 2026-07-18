import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryChoiceOutcome: vi.fn(),
  queryChapter: vi.fn(),
  applyChoiceToUserState: vi.fn(),
  getSessionUser: vi.fn(),
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  continuePersonalizedGeneration: vi.fn(),
  continueStandardGeneration: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/queries', () => ({
  queryChoiceOutcome: mocks.queryChoiceOutcome,
  queryChapter: mocks.queryChapter,
}))
vi.mock('@/lib/api/user-state', () => ({
  applyChoiceToUserState: mocks.applyChoiceToUserState,
  getSessionUser: mocks.getSessionUser,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/api/generation-continuation.server', () => ({
  continuePersonalizedGeneration: mocks.continuePersonalizedGeneration,
  continueStandardGeneration: mocks.continueStandardGeneration,
}))

type DbResult = { data: unknown; error: { message: string; code?: string } | null }
type DbCall = { table?: string; method: string; args: unknown[] }
type TestQueryBuilder = {
  select: (columns: string) => TestQueryBuilder
  eq: (column: string, value: unknown) => TestQueryBuilder
  maybeSingle: () => Promise<DbResult>
}

const REPLAY_INTERNAL_KEYS = new Set([
  'effect',
  'effectJson',
  'effect_json',
  'routeState',
  'route_state',
  'choiceHistory',
  'choice_history',
  'lockedEndingKey',
  'locked_ending_key',
  'ownerUserId',
  'owner_user_id',
  'storyMode',
  'story_mode',
  'choiceKind',
  'choice_kind',
  'replayed',
  'attempts',
])

function replayInternalPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => replayInternalPaths(child, `${path}[${index}]`))
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`
    return [
      ...(REPLAY_INTERNAL_KEYS.has(key) ? [childPath] : []),
      ...replayInternalPaths(child, childPath),
    ]
  })
}

const userId = '10000000-0000-4000-8000-000000000001'
const storyId = 'test:personalized-private-a'
const idempotencyKey = `choice:${storyId}:1:private-choice`

const metadataRow = {
  id: storyId,
  owner_user_id: userId,
  visibility: 'private',
  story_mode: 'personalized_ai',
}

const readerStateRow = {
  user_id: userId,
  story_id: storyId,
  status: 'BERJALAN',
  current_chapter: 1,
  jejak: [],
  ending_name: null,
  route_state: {
    truth: 1,
    risk: 0,
    secrecy: 0,
    empathy: 0,
    trust: {},
    evidence: [],
    flags: {},
    endingBias: {},
  },
  choice_history: [],
  locked_ending_key: null,
  updated_at: '2026-07-14T00:00:00.000Z',
}

const outcomeRow = {
  story_id: storyId,
  chapter_number: 1,
  choice_id: 'private-choice',
  consequence: ['Kebenaran mulai terlihat.'],
  next_chapter_number: 2,
  is_ending: false,
  effect_json: {
    routeDeltas: { truth: 2 },
    trustDeltas: { mira: 1 },
    flagsSet: { clue_found: true },
    evidenceAdded: ['surat'],
    endingBiasDeltas: {},
    threadTouches: [],
  },
  choice_kind: 'normal',
}

const publicOutcome = {
  storyId,
  chapterNumber: 1,
  choiceId: 'private-choice',
  consequence: ['Kebenaran mulai terlihat.'],
  nextChapterNumber: 2,
  isEnding: false,
}

function createCookieDb(input?: {
  user?: { id: string } | null
  story?: DbResult
  order?: string[]
}) {
  const calls: DbCall[] = []
  const client = {
    auth: {
      getUser: vi.fn(async () => {
        input?.order?.push('cookie:getUser')
        return { data: { user: input?.user ?? { id: userId } }, error: null }
      }),
    },
    from: vi.fn((table: string) => {
      input?.order?.push(`cookie:${table}`)
      calls.push({ table, method: 'from', args: [] })
      const predicates = new Map<string, unknown>()
      const builder: TestQueryBuilder = {
        select: vi.fn((...args: unknown[]) => {
          calls.push({ table, method: 'select', args })
          return builder
        }),
        eq: vi.fn((column: string, value: unknown) => {
          calls.push({ table, method: 'eq', args: [column, value] })
          predicates.set(column, value)
          return builder
        }),
        maybeSingle: vi.fn(async () => {
          input?.order?.push('cookie:authorized')
          calls.push({ table, method: 'maybeSingle', args: [] })
          const result = input?.story ?? { data: { id: storyId }, error: null }
          if (result.error || result.data === null || typeof result.data !== 'object') return result
          const row = result.data as Record<string, unknown>
          const matches = predicates.size > 0
            && [...predicates].every(([column, value]) => row[column] === value)
          return matches ? result : { data: null, error: null }
        }),
      }
      return builder
    }),
  }
  return { client, calls }
}

function createAdminDb(input?: {
  tables?: Record<string, DbResult[]>
  rpc?: DbResult
  order?: string[]
}) {
  const calls: DbCall[] = []
  const indexes = new Map<string, number>()
  const tables = input?.tables ?? {}
  const next = (table: string): DbResult => {
    const index = indexes.get(table) ?? 0
    indexes.set(table, index + 1)
    return tables[table]?.[index] ?? { data: null, error: null }
  }

  const client = {
    from: vi.fn((table: string) => {
      input?.order?.push(`admin:${table}`)
      calls.push({ table, method: 'from', args: [] })
      const predicates = new Map<string, unknown>()
      const builder: TestQueryBuilder = {
        select: vi.fn((...args: unknown[]) => {
          calls.push({ table, method: 'select', args })
          return builder
        }),
        eq: vi.fn((column: string, value: unknown) => {
          calls.push({ table, method: 'eq', args: [column, value] })
          predicates.set(column, value)
          return builder
        }),
        maybeSingle: vi.fn(async () => {
          calls.push({ table, method: 'maybeSingle', args: [] })
          const result = next(table)
          if (result.error || result.data === null || typeof result.data !== 'object') return result
          const row = result.data as Record<string, unknown>
          const matches = predicates.size > 0
            && [...predicates].every(([column, value]) => row[column] === value)
          return matches ? result : { data: null, error: null }
        }),
      }
      return builder
    }),
    rpc: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'rpc', args })
      return input?.rpc ?? {
        data: { outcome: publicOutcome, nextChapterNumber: 2, replayed: false },
        error: null,
      }
    }),
  }

  return { client, calls }
}

function personalizedDb(overrides?: Parameters<typeof createAdminDb>[0]) {
  return createAdminDb({
    tables: {
      stories: [{ data: metadataRow, error: null }],
      reader_states: [{ data: readerStateRow, error: null }],
      choice_outcomes: [{ data: outcomeRow, error: null }],
      chapters: [{
        data: {
          story_id: storyId,
          number: 1,
          choices: [{ id: 'private-choice', label: 'Buka surat itu' }],
        },
        error: null,
      }],
    },
    ...overrides,
  })
}

function request(options?: {
  id?: string
  key?: string | null
  body?: unknown
}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options?.key !== null) headers.set('Idempotency-Key', options?.key ?? idempotencyKey)
  return new Request(
    `http://localhost/api/stories/${encodeURIComponent(options?.id ?? storyId)}/choices`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(options?.body ?? { chapterNumber: 1, choiceId: 'private-choice' }),
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookieFactory.mockResolvedValue(createCookieDb().client)
  mocks.getSessionUser.mockResolvedValue({ id: userId })
  mocks.queryChoiceOutcome.mockResolvedValue(publicOutcome)
  mocks.queryChapter.mockResolvedValue({
    storyId: 'demo:standard',
    number: 1,
    title: 'Bab 1',
    paragraphs: ['Isi'],
    choices: [{ id: 'standard-choice', label: 'Pilih standar' }],
  })
  mocks.applyChoiceToUserState.mockResolvedValue(undefined)
  mocks.continuePersonalizedGeneration.mockResolvedValue({ nextChapterReady: true })
  mocks.continueStandardGeneration.mockResolvedValue({ nextChapterReady: true })
})

describe('applyPersonalizedChoice', () => {
  it('finishes cookie identity and reader-safe RLS authorization before creating admin client', async () => {
    const order: string[] = []
    const cookie = createCookieDb({ order })
    mocks.cookieFactory.mockImplementation(async () => {
      order.push('cookie:factory')
      return cookie.client
    })
    mocks.adminFactory.mockImplementation(() => {
      order.push('admin')
      return personalizedDb().client
    })
    const { applyPersonalizedChoice } = await import('@/lib/api/personalized-choice.server')

    await expect(applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber: 1,
      choiceId: 'private-choice',
      idempotencyKey,
    })).resolves.toMatchObject({ outcome: publicOutcome })

    expect(order.slice(0, 5)).toEqual([
      'cookie:factory',
      'cookie:getUser',
      'cookie:stories',
      'cookie:authorized',
      'admin',
    ])
    expect(cookie.calls.filter((call) => call.method === 'select')).toEqual([
      { table: 'stories', method: 'select', args: ['id'] },
    ])
    expect(cookie.calls.filter((call) => call.method === 'eq')).toEqual([
      { table: 'stories', method: 'eq', args: ['id', storyId] },
    ])
  })

  it('denies mismatched cookie user before RLS parent or admin lookup', async () => {
    const cookie = createCookieDb({ user: { id: '20000000-0000-4000-8000-000000000002' } })
    mocks.cookieFactory.mockResolvedValue(cookie.client)
    const { applyPersonalizedChoice } = await import('@/lib/api/personalized-choice.server')

    await expect(applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber: 1,
      choiceId: 'private-choice',
      idempotencyKey,
    })).rejects.toMatchObject({ code: 'STORY_NOT_FOUND' })

    expect(cookie.client.from).not.toHaveBeenCalled()
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('denies user B guessed private story through RLS before admin or outcome lookup', async () => {
    const cookie = createCookieDb({
      user: { id: '20000000-0000-4000-8000-000000000002' },
      story: { data: null, error: null },
    })
    mocks.cookieFactory.mockResolvedValue(cookie.client)
    const { applyPersonalizedChoice } = await import('@/lib/api/personalized-choice.server')

    await expect(applyPersonalizedChoice({
      userId: '20000000-0000-4000-8000-000000000002',
      storyId,
      chapterNumber: 1,
      choiceId: 'private-choice',
      idempotencyKey,
    })).rejects.toMatchObject({ code: 'STORY_NOT_FOUND' })

    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(cookie.calls.some((call) => call.table === 'choice_outcomes')).toBe(false)
  })

  it('fails closed when exact reader state is missing', async () => {
    const fixture = personalizedDb({
      tables: {
        stories: [{ data: metadataRow, error: null }],
        reader_states: [{ data: null, error: null }],
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { applyPersonalizedChoice } = await import('@/lib/api/personalized-choice.server')

    await expect(applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber: 1,
      choiceId: 'private-choice',
      idempotencyKey,
    })).rejects.toMatchObject({ code: 'READER_STATE_MISSING' })

    expect(fixture.client.rpc).not.toHaveBeenCalled()
    expect(fixture.calls).not.toContainEqual(expect.objectContaining({ table: 'choice_outcomes' }))
  })

  it('validates effect, merges route, summarizes history, and sends exact prior state', async () => {
    const fixture = personalizedDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { applyPersonalizedChoice } = await import('@/lib/api/personalized-choice.server')

    const result = await applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber: 1,
      choiceId: 'private-choice',
      idempotencyKey,
    })

    expect(result).toEqual({ outcome: publicOutcome, nextChapterNumber: 2, replayed: false })
    expect(fixture.calls.filter((call) => call.method === 'select').map((call) => call.args[0])).toEqual([
      'id,owner_user_id,visibility,story_mode',
      'user_id,story_id,status,current_chapter,jejak,ending_name,route_state,choice_history,locked_ending_key,updated_at',
      'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending,effect_json,choice_kind',
      'story_id,number,choices',
    ])
    expect(fixture.calls.filter((call) => call.method === 'eq')).toEqual([
      { table: 'stories', method: 'eq', args: ['id', storyId] },
      { table: 'reader_states', method: 'eq', args: ['user_id', userId] },
      { table: 'reader_states', method: 'eq', args: ['story_id', storyId] },
      { table: 'choice_outcomes', method: 'eq', args: ['story_id', storyId] },
      { table: 'choice_outcomes', method: 'eq', args: ['chapter_number', 1] },
      { table: 'choice_outcomes', method: 'eq', args: ['choice_id', 'private-choice'] },
      { table: 'chapters', method: 'eq', args: ['story_id', storyId] },
      { table: 'chapters', method: 'eq', args: ['number', 1] },
    ])
    expect(fixture.client.rpc).toHaveBeenCalledOnce()
    const [rpcName, rpcInput] = fixture.client.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(rpcName).toBe('apply_personalized_choice')
    expect(rpcInput).toMatchObject({
      p_user_id: userId,
      p_story_id: storyId,
      p_chapter_number: 1,
      p_choice_id: 'private-choice',
      p_idempotency_key: idempotencyKey,
      p_expected_state: readerStateRow,
      p_next_route_state: {
        truth: 3,
        risk: 0,
        secrecy: 0,
        empathy: 0,
        trust: { mira: 1 },
        evidence: ['surat'],
        flags: { clue_found: true },
        endingBias: {},
      },
      p_history_entry: {
        chapterNumber: 1,
        choiceId: 'private-choice',
        label: 'Buka surat itu',
        consequence: ['Kebenaran mulai terlihat.'],
        effectSummary: { truth: 2, flagsSet: ['clue_found'] },
        createdAt: expect.any(String),
      },
      p_jejak_entry: {
        chapter: 1,
        decision: 'Buka surat itu',
        consequence: 'Kebenaran mulai terlihat.',
      },
    })
  })

  it.each([
    ['IDEMPOTENCY_KEY_COLLISION', 'IDEMPOTENCY_KEY_COLLISION'],
    ['CHOICE_CONFLICT', 'CHOICE_CONFLICT'],
    ['POSITION_CONFLICT', 'POSITION_CONFLICT'],
    ['STALE_READER_STATE', 'STALE_READER_STATE'],
    ['STORY_NOT_FOUND', 'STORY_NOT_FOUND'],
    ['CHOICE_NOT_FOUND', 'CHOICE_NOT_FOUND'],
  ] as const)('maps stable database error %s to typed service error', async (message, code) => {
    const fixture = personalizedDb({ rpc: { data: null, error: { message } } })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { applyPersonalizedChoice } = await import('@/lib/api/personalized-choice.server')

    await expect(applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber: 1,
      choiceId: 'private-choice',
      idempotencyKey,
    })).rejects.toMatchObject({ code })
  })
})

describe('personalized choice route dispatch', () => {
  it('preserves anonymous standard story behavior without personalized lookup', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request({ id: 'demo:standard', body: {
      chapterNumber: 1,
      choiceId: 'standard-choice',
    } }), { params: Promise.resolve({ id: 'demo%3Astandard' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: publicOutcome })
    expect(mocks.queryChoiceOutcome).toHaveBeenCalledWith('demo:standard', 1, 'standard-choice')
    expect(mocks.cookieFactory).not.toHaveBeenCalled()
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('returns generic 404 for anonymous guessed private story without admin lookup', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    mocks.queryChoiceOutcome.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request(), { params: Promise.resolve({ id: storyId }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Pilihan tidak dikenali.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('returns same generic 404 for user B before admin, RPC, or outcome lookup', async () => {
    const userB = '20000000-0000-4000-8000-000000000002'
    const cookie = createCookieDb({
      user: { id: userB },
      story: { data: null, error: null },
    })
    mocks.getSessionUser.mockResolvedValue({ id: userB })
    mocks.cookieFactory.mockResolvedValue(cookie.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request(), { params: Promise.resolve({ id: storyId }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Pilihan tidak dikenali.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(cookie.calls.some((call) => call.method === 'rpc')).toBe(false)
    expect(cookie.calls.some((call) => call.table === 'choice_outcomes')).toBe(false)
    expect(mocks.queryChoiceOutcome).not.toHaveBeenCalled()
  })

  it('falls through to old path for authenticated standard story', async () => {
    const standardMetadata = { ...metadataRow, id: 'demo:standard', visibility: 'public', story_mode: 'standard' }
    const fixture = createAdminDb({ tables: { stories: [{ data: standardMetadata, error: null }] } })
    mocks.cookieFactory.mockResolvedValue(createCookieDb({
      story: { data: { id: 'demo:standard' }, error: null },
    }).client)
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request({ id: 'demo:standard', body: {
      chapterNumber: 1,
      choiceId: 'standard-choice',
    } }), { params: Promise.resolve({ id: 'demo%3Astandard' }) })

    expect(response.status).toBe(200)
    expect(mocks.applyChoiceToUserState).toHaveBeenCalledOnce()
    expect(fixture.client.rpc).not.toHaveBeenCalled()
  })

  it('falls through to old path for authenticated unlisted standard story', async () => {
    const standardMetadata = { ...metadataRow, id: 'demo:unlisted', visibility: 'unlisted', story_mode: 'standard' }
    const fixture = createAdminDb({ tables: { stories: [{ data: standardMetadata, error: null }] } })
    mocks.cookieFactory.mockResolvedValue(createCookieDb({
      story: { data: { id: 'demo:unlisted' }, error: null },
    }).client)
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request({ id: 'demo:unlisted', body: {
      chapterNumber: 1,
      choiceId: 'standard-choice',
    } }), { params: Promise.resolve({ id: 'demo%3Aunlisted' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: publicOutcome, nextChapterReady: true })
    expect(mocks.applyChoiceToUserState).toHaveBeenCalledOnce()
    expect(fixture.client.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['premium_instance', true],
    ['premium_template', false],
  ] as const)('dispatches %s through expected path', async (storyMode, usesRpc) => {
    const fixture = personalizedDb({
      tables: {
        stories: [{ data: { ...metadataRow, story_mode: storyMode }, error: null }],
        reader_states: [{ data: readerStateRow, error: null }],
        choice_outcomes: [{ data: outcomeRow, error: null }],
        chapters: [{
          data: {
            story_id: storyId,
            number: 1,
            choices: [{ id: 'private-choice', label: 'Buka surat itu' }],
          },
          error: null,
        }],
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request(), { params: Promise.resolve({ id: storyId }) })

    expect(response.status).toBe(200)
    expect(fixture.client.rpc).toHaveBeenCalledTimes(usesRpc ? 1 : 0)
    expect(mocks.applyChoiceToUserState).toHaveBeenCalledTimes(usesRpc ? 0 : 1)
  })

  it('requires idempotency key only after owned personalized mode is established', async () => {
    const fixture = personalizedDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request({ key: null }), { params: Promise.resolve({ id: storyId }) })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Idempotency-Key tidak valid.' })
    expect(mocks.cookieFactory).toHaveBeenCalledOnce()
    expect(fixture.calls.some((call) => call.table === 'stories')).toBe(true)
    expect(fixture.calls.some((call) => call.table === 'reader_states')).toBe(false)
  })

  it('maps typed conflicts to sanitized 409 responses', async () => {
    const fixture = personalizedDb({ rpc: { data: null, error: { message: 'STALE_READER_STATE secret row dump' } } })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request(), { params: Promise.resolve({ id: storyId }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Pilihan berkonflik dengan progres terbaru.' })
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('strict schema strips injected nested RPC fields before public personalized replay response', async () => {
    const fixture = personalizedDb({
      rpc: {
        data: {
          outcome: {
            ...publicOutcome,
            audit: { transport: { effect_json: { truth: 2 } } },
          },
          nextChapterNumber: 2,
          replayed: true,
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(request(), { params: Promise.resolve({ id: storyId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ outcome: publicOutcome, nextChapterReady: true })
    expect(replayInternalPaths(body)).toEqual([])
    expect(JSON.stringify(body)).not.toMatch(
      /effect_json|choice_kind|route_state|choice_history|locked_ending_key|owner_user_id|story_mode|expected_state|ledger|replayed/,
    )
    expect(mocks.continuePersonalizedGeneration).toHaveBeenCalledWith({
      storyId,
      userId,
      chapterNumber: 2,
      triggerChoiceId: 'private-choice',
    })
  })
})
