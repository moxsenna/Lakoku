import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  getDb: vi.fn(),
  rpc: vi.fn(),
}))

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
vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAdminClient: mocks.adminFactory,
    getDb: mocks.getDb,
    rpcOne: vi.fn((_db: unknown, name: string, params: Record<string, unknown>) => {
      const promise = mocks.rpc(name, params)
      return {
        execute: vi.fn(async () => {
          const res = await promise
          return [{ fn: res }]
        }),
      }
    }),
  }
})

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '10000000-0000-4000-8000-000000000001'

function setupDb() {
  const executor = {
    transformQuery: (node: unknown) => node,
    compileQuery: () => ({ sql: '', parameters: [] }),
    executeQuery: vi.fn(async () => ({ rows: [] })),
  }
  const trx = {
    getExecutor: vi.fn(() => executor),
  }
  const db = {
    transaction: vi.fn(() => ({
      execute: vi.fn(async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx)),
    })),
  }
  mocks.getDb.mockReturnValue(db)
  mocks.cookieFactory.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
  })
}

function rpcResult(data: unknown) {
  setupDb()
  mocks.rpc.mockResolvedValue(data)
  return mocks.rpc
}

function rpcError(message: string, code = 'P0001') {
  setupDb()
  const err = Object.assign(new Error(message), { code })
  mocks.rpc.mockRejectedValue(err)
  return mocks.rpc
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('enqueueGenerationJob', () => {
  it('uses only cookie createClient and exact payload without user ID', async () => {
    const rpc = rpcResult({
      alreadyComplete: false,
      jobId: JOB_ID,
      correlationId: CORRELATION_ID,
      status: 'QUEUED',
      private: 'ignored',
    })
    const { enqueueGenerationJob } = await import('@/lib/api/generation-job-enqueue.server')
    const input = {
      storyId: 'story-a',
      chapterNumber: 2,
      generationKind: 'standard' as const,
      triggerChoiceId: 'choice-a',
    }
    const before = structuredClone(input)

    await expect(enqueueGenerationJob(input)).resolves.toEqual({
      alreadyComplete: false,
      jobId: JOB_ID,
      correlationId: CORRELATION_ID,
      status: 'QUEUED',
    })
    expect(input).toEqual(before)
    expect(mocks.cookieFactory).toHaveBeenCalledTimes(1)
    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('enqueue_generation_job_v1', {
      p_story_id: 'story-a',
      p_chapter_number: 2,
      p_generation_kind: 'standard',
      p_trigger_choice_id: 'choice-a',
    })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('userId')
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('p_user_id')
  })

  it('maps completed fast path and nullable trigger exactly', async () => {
    const rpc = rpcResult({
      alreadyComplete: true,
      jobId: null,
      correlationId: null,
      status: 'SUCCEEDED',
    })
    const { enqueueGenerationJob } = await import('@/lib/api/generation-job-enqueue.server')

    await expect(enqueueGenerationJob({
      storyId: 'story-a',
      chapterNumber: 2,
      generationKind: 'personalized',
      triggerChoiceId: null,
    })).resolves.toEqual({
      alreadyComplete: true,
      jobId: null,
      correlationId: null,
      status: 'SUCCEEDED',
    })
    expect(rpc).toHaveBeenCalledWith('enqueue_generation_job_v1', {
      p_story_id: 'story-a',
      p_chapter_number: 2,
      p_generation_kind: 'personalized',
      p_trigger_choice_id: null,
    })
  })

  it('rejects malformed RPC result', async () => {
    rpcResult({
      alreadyComplete: false,
      jobId: null,
      correlationId: CORRELATION_ID,
      status: 'QUEUED',
    })
    const { enqueueGenerationJob } = await import('@/lib/api/generation-job-enqueue.server')

    await expect(enqueueGenerationJob({
      storyId: 'story-a',
      chapterNumber: 2,
      generationKind: 'standard',
      triggerChoiceId: null,
    })).rejects.toThrow()
  })

  it('validates input before creating cookie client', async () => {
    const { enqueueGenerationJob } = await import('@/lib/api/generation-job-enqueue.server')

    await expect(enqueueGenerationJob({
      storyId: ' story-a ',
      chapterNumber: 0,
      generationKind: 'standard',
      triggerChoiceId: null,
    })).rejects.toThrow()
    expect(mocks.cookieFactory).not.toHaveBeenCalled()
  })

  it.each([
    'AUTH_REQUIRED',
    'STORY_NOT_FOUND',
    'GENERATION_JOB_CONFLICT',
  ] as const)('maps known SQL token %s to typed error', async (token) => {
    rpcError(`enqueue failed: ${token}`)
    const { enqueueGenerationJob, GenerationJobError } = await import(
      '@/lib/api/generation-job-enqueue.server'
    )

    const error = await enqueueGenerationJob({
      storyId: 'story-a',
      chapterNumber: 2,
      generationKind: 'standard',
      triggerChoiceId: null,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(GenerationJobError)
    expect(error).toMatchObject({ code: token, message: token })
  })

  it('maps unknown database error to INTERNAL_ERROR without raw code or message', async () => {
    rpcError('private policy detail', '42501')
    const { enqueueGenerationJob, GenerationJobError } = await import(
      '@/lib/api/generation-job-enqueue.server'
    )

    const error = await enqueueGenerationJob({
      storyId: 'story-a',
      chapterNumber: 2,
      generationKind: 'standard',
      triggerChoiceId: null,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(GenerationJobError)
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR' })
    expect(JSON.stringify(error)).not.toContain('42501')
    expect(JSON.stringify(error)).not.toContain('private policy detail')
  })
})
