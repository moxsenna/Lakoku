import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultTasteProfile, type TasteProfile } from '@/lib/taste-profile/schema'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import type { StoryContract } from '@/lib/story-engine/story-contract'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  getTasteProfileForUser: vi.fn(),
  selectProvider: vi.fn(),
  createResilientStoryContract: vi.fn(),
  persistContractAndCanon: vi.fn(),
  generateNextPersonalizedChapter: vi.fn(),
  randomUUID: vi.fn(),
}))

let activeAdminDb: {
  client: Record<string, unknown> & {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ error?: { message: string } | null; data?: unknown }>
  }
  calls: DbCall[]
} | null = null

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/api/user-state', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getSessionUser: vi.fn().mockImplementation(async () => {
      const client = await mocks.cookieFactory()
      if (!client?.auth) return null
      const { data } = await client.auth.getUser()
      return data?.user ? { id: data.user.id, email: data.user.email } : null
    }),
  }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAdminClient: mocks.adminFactory,
    getDb: vi.fn(() => {
      mocks.adminFactory()
      return activeAdminDb?.client
    }),
    rpcOne: vi.fn((_db: unknown, name: string, args: Record<string, unknown>) => ({
      execute: vi.fn(async () => {
        if (!activeAdminDb) return []
        const res = await activeAdminDb.client.rpc(name, args)
        if (res.error) throw new Error(res.error.message)
        return [{ fn: res.data }]
      }),
    })),
  }
})
vi.mock('@/lib/api/taste-profile', () => ({
  getTasteProfileForUser: mocks.getTasteProfileForUser,
}))
vi.mock('@lakoku/ai-gateway/server', () => ({
  selectProvider: mocks.selectProvider,
}))
vi.mock('@/lib/story-engine/contract-generation.server', () => ({
  createResilientStoryContract: mocks.createResilientStoryContract,
}))
vi.mock('@/lib/story-engine/contract-persistence.server', () => ({
  persistContractAndCanon: mocks.persistContractAndCanon,
}))
vi.mock('@/lib/runtime/personalized-generation', () => ({
  generateNextPersonalizedChapter: mocks.generateNextPersonalizedChapter,
}))
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto')
  return {
    ...actual,
    randomUUID: mocks.randomUUID,
  }
})

type DbResult = { data: unknown; error: { message: string; code?: string } | null }
type DbCall = { table?: string; method: string; args: unknown[] }

const userId = '10000000-0000-4000-8000-000000000001'
const idempotencyKey = 'personalized:client-nonce-1'
const reservedStoryId = 'ai:11111111-1111-4111-8111-111111111111'
const tasteProfile: TasteProfile = {
  ...createDefaultTasteProfile(),
  primaryGenreId: 'mystery',
  completedAt: '2026-07-14T00:00:00.000Z',
}

function requestHashFor(version: number, owner = userId): string {
  return createHash('sha256')
    .update(JSON.stringify({
      kind: 'personalized',
      userId: owner,
      tasteProfileVersion: version,
    }))
    .digest('hex')
}

function contractFor(storyId: string): StoryContract {
  return {
    ...structuredClone(misteriDramaContract),
    storyId,
    title: 'Arsip Hujan Pribadi',
  }
}

function createCookieDb(input?: {
  user?: { id: string } | null
  userError?: { message: string } | null
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: input?.user === undefined ? { id: userId } : input.user },
        error: input?.userError ?? null,
      })),
    },
  }
}

function createAdminDb(input?: {
  reserve?: DbResult
  existing?: DbResult
  storyInsert?: DbResult
  readerInsert?: DbResult
  updates?: DbResult[]
  selects?: Record<string, DbResult[]>
}) {
  const calls: DbCall[] = []
  const updateResults = [...(input?.updates ?? [])]
  const selectQueues = new Map(
    Object.entries(input?.selects ?? {}).map(([table, rows]) => [table, [...rows]]),
  )
  let reserved = false

  const client = {
    selectFrom: vi.fn((table: string) => {
      calls.push({ table, method: 'from', args: [] })
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: 'select', args })
        return builder
      })
      builder.where = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: 'eq', args })
        return builder
      })
      builder.limit = vi.fn(() => builder)
      builder.execute = vi.fn(async () => {
        calls.push({ table, method: 'maybeSingle', args: [] })
        if (table === 'story_creation_requests') {
          if (input?.existing) {
            if (input.existing.error) throw new Error(input.existing.error.message)
            return input.existing.data ? [input.existing.data] : []
          }
          if (reserved) {
            return [{
              story_id: reservedStoryId,
              request_hash: requestHashFor(tasteProfile.version),
              status: 'READY',
              error_code: null,
              generation_job_id: null,
            }]
          }
        }
        const queue = selectQueues.get(table)
        if (queue && queue.length > 0) {
          const item = queue.shift()!
          if (item.error) throw new Error(item.error.message)
          return item.data ? [item.data] : []
        }
        if (table === 'account_commercial_states') {
          return [{ starter_claimed_at: '2026-08-01T00:00:00Z', starter_story_id: reservedStoryId }]
        }
        if (table === 'stories') {
          return [{ commercial_origin: 'STARTER_FREE', id: reservedStoryId }]
        }
        return []
      })
      return builder
    }),
    insertInto: vi.fn((table: string) => {
      const insertBuilder: Record<string, unknown> = {}
      insertBuilder.values = vi.fn((payload: unknown) => {
        calls.push({ table, method: 'insert', args: [payload] })
        return insertBuilder
      })
      insertBuilder.returning = vi.fn(() => insertBuilder)
      insertBuilder.executeTakeFirst = vi.fn(async () => {
        calls.push({ table, method: 'single', args: [] })
        if (table === 'story_creation_requests') {
          const result = input?.reserve ?? { data: { story_id: reservedStoryId }, error: null }
          if (!result.error) reserved = true
          if (result.error) {
            const err = new Error(result.error.message)
            Object.assign(err, { code: result.error.code ?? '23505' })
            throw err
          }
          return result.data
        }
        return { story_id: reservedStoryId }
      })
      insertBuilder.execute = vi.fn(async () => {
        calls.push({ table, method: 'single', args: [] })
        if (table === 'story_creation_requests') {
          const result = input?.reserve ?? { data: { story_id: reservedStoryId }, error: null }
          if (!result.error) reserved = true
          if (result.error) {
            const err = new Error(result.error.message)
            Object.assign(err, { code: result.error.code ?? '23505' })
            throw err
          }
          return result.data ? [result.data] : []
        }
        if (table === 'stories') {
          const result = input?.storyInsert ?? { data: { id: reservedStoryId }, error: null }
          if (result.error) throw new Error(result.error.message)
          return result.data ? [result.data] : []
        }
        if (table === 'reader_states') {
          const result = input?.readerInsert ?? { data: { story_id: reservedStoryId }, error: null }
          if (result.error) throw new Error(result.error.message)
          return result.data ? [result.data] : []
        }
        return []
      })
      return insertBuilder
    }),
    updateTable: vi.fn((table: string) => {
      const updateBuilder: Record<string, unknown> = {}
      updateBuilder.set = vi.fn((payload: unknown) => {
        calls.push({ table, method: 'update', args: [payload] })
        return updateBuilder
      })
      updateBuilder.where = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: 'eq', args })
        return updateBuilder
      })
      updateBuilder.execute = vi.fn(async () => {
        const result = updateResults.shift() ?? { data: null, error: null }
        if (result.error) throw new Error(result.error.message)
        return result.data ? [result.data] : []
      })
      return updateBuilder
    }),
    rpc: vi.fn(async (rpcName: string, args?: unknown) => {
      calls.push({ method: 'rpc', args: [rpcName, args] })
      if (rpcName === 'claim_starter_story_v1') {
        return { data: { claimed: true }, error: null }
      }
      if (rpcName === 'reserve_story_start_v1') {
        return { data: { ok: true, status: 'RESERVED' }, error: null }
      }
      if (rpcName === 'queue_paid_story_start_generation_v1') {
        return {
          data: {
            ok: true,
            job_id: '00000000-0000-4000-8000-0000000000e1',
            correlation_id: '00000000-0000-4000-8000-0000000000e2',
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }),
  }

  const instance = { client, calls }
  activeAdminDb = instance
  return instance
}

function request(options?: {
  key?: string | null
  body?: unknown
  method?: string
}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options?.key !== null) headers.set('Idempotency-Key', options?.key ?? idempotencyKey)
  return new Request('http://localhost/api/stories/personalized', {
    method: options?.method ?? 'POST',
    headers,
    body: options?.body === undefined
      ? undefined
      : JSON.stringify(options.body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.randomUUID.mockReturnValue('11111111-1111-4111-8111-111111111111')
  mocks.cookieFactory.mockResolvedValue(createCookieDb())
  mocks.adminFactory.mockReturnValue(createAdminDb().client)
  mocks.getTasteProfileForUser.mockResolvedValue(tasteProfile)
  mocks.selectProvider.mockResolvedValue({ name: 'fake-provider' })
  mocks.createResilientStoryContract.mockImplementation(async ({ storyId }: { storyId: string }) => ({
    contract: contractFor(storyId),
    contractSource: 'template_fallback',
  }))
  mocks.persistContractAndCanon.mockResolvedValue(undefined)
  mocks.generateNextPersonalizedChapter.mockResolvedValue({ ok: true, chapterNumber: 1 })
})

describe('createPersonalizedStory', () => {
  it('rejects invalid idempotency key before admin writes', async () => {
    const { createPersonalizedStory, PersonalizedStoryError } = await import(
      '@/lib/api/personalized-stories.server'
    )

    await expect(createPersonalizedStory({
      userId,
      idempotencyKey: '   ',
    })).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' })
    await expect(createPersonalizedStory({
      userId,
      idempotencyKey: 'bad key with space',
    })).rejects.toBeInstanceOf(PersonalizedStoryError)

    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(mocks.getTasteProfileForUser).not.toHaveBeenCalled()
  })

  it('loads taste profile and reserves story_creation_requests with canonical hash', async () => {
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    const result = await createPersonalizedStory({ userId, idempotencyKey })

    expect(result).toEqual({
      storyId: reservedStoryId,
      redirectUrl: `/baca/${encodeURIComponent(reservedStoryId)}?bab=1`,
      replayed: false,
    })
    expect(mocks.getTasteProfileForUser).toHaveBeenCalledWith(userId)
    expect(fixture.calls.filter((call) => call.method === 'insert' && call.table === 'story_creation_requests')).toEqual([
      {
        table: 'story_creation_requests',
        method: 'insert',
        args: [expect.objectContaining({
          owner_user_id: userId,
          request_kind: 'personalized',
          idempotency_key: idempotencyKey,
          request_hash: requestHashFor(tasteProfile.version),
          story_id: reservedStoryId,
          status: 'RESERVED',
          error_code: null,
        })],
      },
    ])
  })

  it('creates private personalized_ai shell owned by session user only', async () => {
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    await createPersonalizedStory({ userId, idempotencyKey })

    const storyInsert = fixture.calls.find(
      (call) => call.table === 'stories' && call.method === 'insert',
    )
    expect(storyInsert?.args[0]).toMatchObject({
      id: reservedStoryId,
      owner_user_id: userId,
      visibility: 'private',
      story_mode: 'personalized_ai',
      generation_status: 'creating_contract',
      total_chapters: 50,
      status: 'BARU',
      current_chapter: 0,
    })
    expect(JSON.stringify(storyInsert?.args[0])).not.toContain('userId')
  })

  it('bootstraps resilient contract/canon, seeds reader state, then generates only chapter 1', async () => {
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    await createPersonalizedStory({ userId, idempotencyKey })

    const expectedProviderContext = {
      userId,
      storyId: reservedStoryId,
      chapterNumber: null,
      generationKind: 'personalized',
      jobId: null,
      correlationId: '11111111-1111-4111-8111-111111111111',
      attemptNumber: null,
    }
    expect(mocks.selectProvider).toHaveBeenCalledOnce()
    expect(mocks.selectProvider).toHaveBeenCalledWith(expectedProviderContext)
    expect(mocks.createResilientStoryContract).toHaveBeenCalledOnce()
    expect(mocks.createResilientStoryContract).toHaveBeenCalledWith(expect.objectContaining({
      storyId: reservedStoryId,
      tasteJson: tasteProfile,
      provider: { name: 'fake-provider' },
      telemetryContext: expectedProviderContext,
    }))
    expect(mocks.persistContractAndCanon).toHaveBeenCalledOnce()
    expect(mocks.persistContractAndCanon).toHaveBeenCalledWith({
      ownerUserId: userId,
      contract: contractFor(reservedStoryId),
      contractSource: 'template_fallback',
      onboardingJson: tasteProfile,
    })

    const readerInsert = fixture.calls.find(
      (call) => call.table === 'reader_states' && call.method === 'insert',
    )
    expect(readerInsert?.args[0]).toMatchObject({
      user_id: userId,
      story_id: reservedStoryId,
      status: 'BERJALAN',
      current_chapter: 1,
      jejak: [],
      choice_history: [],
      locked_ending_key: null,
    })
    expect(readerInsert?.args[0]).toHaveProperty('route_state')

    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledOnce()
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledWith({
      storyId: reservedStoryId,
      userId,
      chapterNumber: 1,
      correlationId: '11111111-1111-4111-8111-111111111111',
    })
    expect(mocks.generateNextPersonalizedChapter.mock.calls[0][0].chapterNumber).toBe(1)
  })

  it('marks request and story READY after successful chapter 1 generation', async () => {
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    await createPersonalizedStory({ userId, idempotencyKey })

    const storyReady = fixture.calls.find(
      (call) => call.table === 'stories'
        && call.method === 'update'
        && JSON.stringify(call.args[0]).includes('"ready"'),
    )
    const requestReady = fixture.calls.find(
      (call) => call.table === 'story_creation_requests'
        && call.method === 'update'
        && JSON.stringify(call.args[0]).includes('"READY"'),
    )
    expect(storyReady?.args[0]).toMatchObject({ generation_status: 'ready' })
    expect(requestReady?.args[0]).toMatchObject({ status: 'READY', error_code: null })
  })

  it('replays same key + same request hash without second shell or generation', async () => {
    const existingHash = requestHashFor(tasteProfile.version)
    const fixture = createAdminDb({
      reserve: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      existing: {
        data: {
          story_id: reservedStoryId,
          request_hash: existingHash,
          status: 'READY',
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    const result = await createPersonalizedStory({ userId, idempotencyKey })

    expect(result).toEqual({
      storyId: reservedStoryId,
      redirectUrl: `/baca/${encodeURIComponent(reservedStoryId)}?bab=1`,
      replayed: true,
    })
    expect(fixture.calls.some((call) => call.table === 'stories' && call.method === 'insert')).toBe(false)
    expect(mocks.createResilientStoryContract).not.toHaveBeenCalled()
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
  })

  it('throws IDEMPOTENCY_CONFLICT when same key has different request hash', async () => {
    const sameHash = requestHashFor(tasteProfile.version)
    const differentHash = requestHashFor(tasteProfile.version + 1)
    expect(differentHash).not.toBe(sameHash)
    const fixture = createAdminDb({
      reserve: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      existing: {
        data: {
          story_id: reservedStoryId,
          request_hash: differentHash,
          status: 'READY',
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    await expect(createPersonalizedStory({ userId, idempotencyKey }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    expect(mocks.createResilientStoryContract).not.toHaveBeenCalled()
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
    const requestFailed = fixture.calls.find(
      (call) => call.table === 'story_creation_requests'
        && call.method === 'update'
        && JSON.stringify(call.args[0]).includes('"FAILED"'),
    )
    const storyFailed = fixture.calls.find(
      (call) => call.table === 'stories'
        && call.method === 'update'
        && JSON.stringify(call.args[0]).includes('"failed"'),
    )
    expect(requestFailed).toBeUndefined()
    expect(storyFailed).toBeUndefined()
  })

  it('marks request/story failed on generation failure without inventing a second story id', async () => {
    mocks.generateNextPersonalizedChapter.mockResolvedValue({
      ok: false,
      reason: 'FAILED_REVIEW_REQUIRED',
    })
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    await expect(createPersonalizedStory({ userId, idempotencyKey }))
      .rejects.toMatchObject({ code: 'GENERATION_FAILED' })

    const storyFailed = fixture.calls.find(
      (call) => call.table === 'stories'
        && call.method === 'update'
        && JSON.stringify(call.args[0]).includes('"failed"'),
    )
    const requestFailed = fixture.calls.find(
      (call) => call.table === 'story_creation_requests'
        && call.method === 'update'
        && JSON.stringify(call.args[0]).includes('"FAILED"'),
    )
    expect(storyFailed?.args[0]).toMatchObject({ generation_status: 'failed' })
    expect(requestFailed?.args[0]).toMatchObject({
      status: 'FAILED',
      error_code: 'GENERATION_FAILED',
    })
    expect(mocks.randomUUID).toHaveBeenCalledTimes(2)
  })

  it('never accepts body userId; owner is only the provided session userId', async () => {
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { createPersonalizedStory } = await import('@/lib/api/personalized-stories.server')

    await createPersonalizedStory({
      userId,
      idempotencyKey,
      // @ts-expect-error intentional body-like pollution
      bodyUserId: '20000000-0000-4000-8000-000000000002',
    })

    const inserts = fixture.calls
      .filter((call) => call.method === 'insert')
      .map((call) => JSON.stringify(call.args[0]))
    expect(inserts.join('\n')).not.toContain('20000000-0000-4000-8000-000000000002')
    expect(mocks.getTasteProfileForUser).toHaveBeenCalledWith(userId)
  })
})

describe('POST /api/stories/personalized', () => {
  it('returns 401 when cookie session is missing', async () => {
    mocks.cookieFactory.mockResolvedValue(createCookieDb({ user: null }))
    const { POST } = await import('@/app/api/stories/personalized/route')

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Tidak diizinkan.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('returns 400 when Idempotency-Key is missing or invalid', async () => {
    const { POST } = await import('@/app/api/stories/personalized/route')

    const missing = await POST(request({ key: null }))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'Idempotency-Key tidak valid.' })

    const invalid = await POST(request({ key: 'has space' }))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'Idempotency-Key tidak valid.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('returns 201 with reader-safe payload on first creation', async () => {
    const fixture = createAdminDb()
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/personalized/route')

    const response = await POST(request({ body: { userId: 'should-be-ignored' } }))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json).toEqual({
      storyId: reservedStoryId,
      redirectUrl: `/baca/${encodeURIComponent(reservedStoryId)}?bab=1`,
    })
    expect(json).not.toHaveProperty('replayed')
    expect(json).not.toHaveProperty('owner')
    expect(json).not.toHaveProperty('contract')
    expect(json).not.toHaveProperty('generation_status')
    expect(json).not.toHaveProperty('route_state')
    expect(json).not.toHaveProperty('effect_json')
    expect(JSON.stringify(json)).not.toContain(userId)
  })

  it('returns 200 with same story id on replay', async () => {
    const fixture = createAdminDb({
      reserve: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      existing: {
        data: {
          story_id: reservedStoryId,
          request_hash: requestHashFor(tasteProfile.version),
          status: 'READY',
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/personalized/route')

    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      storyId: reservedStoryId,
      redirectUrl: `/baca/${encodeURIComponent(reservedStoryId)}?bab=1`,
    })
  })

  it('returns 409 on idempotency conflict', async () => {
    const sameHash = requestHashFor(tasteProfile.version)
    const differentHash = requestHashFor(tasteProfile.version + 1)
    expect(differentHash).not.toBe(sameHash)
    const fixture = createAdminDb({
      reserve: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      existing: {
        data: {
          story_id: reservedStoryId,
          request_hash: differentHash,
          status: 'READY',
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { POST } = await import('@/app/api/stories/personalized/route')

    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Permintaan berkonflik dengan kunci idempotensi.' })
  })

  describe('verifyDurableStarterProof strict unit tests', () => {
    it('returns false when account row is missing', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const admin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: null, error: null }],
          stories: [{ data: { commercial_origin: 'STARTER_FREE' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns false when account row fields are both null', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const admin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: null, starter_claimed_at: null }, error: null }],
          stories: [{ data: { commercial_origin: 'STARTER_FREE' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns false when starter_claimed_at exists but starter_story_id is for another story', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const admin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: 'ai:other-story', starter_claimed_at: '2026-08-01T00:00:00Z' }, error: null }],
          stories: [{ data: { commercial_origin: 'STARTER_FREE' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns false when starter_story_id matches but claimed_at is null', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const admin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: reservedStoryId, starter_claimed_at: null }, error: null }],
          stories: [{ data: { commercial_origin: 'STARTER_FREE' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns false when story commercial_origin is null or not STARTER_FREE', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const adminNullOrigin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: reservedStoryId, starter_claimed_at: '2026-08-01T00:00:00Z' }, error: null }],
          stories: [{ data: { commercial_origin: null }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin: adminNullOrigin, userId, storyId: reservedStoryId })).toBe(false)

      const adminPaidOrigin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: reservedStoryId, starter_claimed_at: '2026-08-01T00:00:00Z' }, error: null }],
          stories: [{ data: { commercial_origin: 'PENDING_PAID_START' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin: adminPaidOrigin, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns false when story row is missing', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const admin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: reservedStoryId, starter_claimed_at: '2026-08-01T00:00:00Z' }, error: null }],
          stories: [{ data: null, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns false on query error', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const adminErr = createAdminDb({
        selects: {
          account_commercial_states: [{ data: null, error: { message: 'db error' } }],
          stories: [{ data: { commercial_origin: 'STARTER_FREE' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin: adminErr, userId, storyId: reservedStoryId })).toBe(false)
    })

    it('returns true ONLY when exact durable proof holds', async () => {
      const { verifyDurableStarterProof } = await import('@/lib/api/personalized-stories.server')
      const admin = createAdminDb({
        selects: {
          account_commercial_states: [{ data: { starter_story_id: reservedStoryId, starter_claimed_at: '2026-08-01T00:00:00Z' }, error: null }],
          stories: [{ data: { commercial_origin: 'STARTER_FREE' }, error: null }],
        },
      }).client as unknown as Parameters<typeof verifyDurableStarterProof>[0]['admin']
      expect(await verifyDurableStarterProof({ admin, userId, storyId: reservedStoryId })).toBe(true)
    })
  })
})
