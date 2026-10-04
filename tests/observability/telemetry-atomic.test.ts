import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAdminClient: mocks.createAdminClient,
    getDb: () => mocks.createAdminClient(),
    rpcOne: (client: any, name: string, args: any) => ({
      execute: async () => {
        const res = await client.rpc(name, args)
        if (res?.error) throw new Error(res.error.message || String(res.error))
        return [res?.data]
      },
    }),
  }
})

import {
  recordGenerationAttempt,
  recordGenerationRuntimeFailed,
} from '@/lib/observability/telemetry'

function makeAdminClient(options: {
  readError?: { message: string } | null
  insertError?: { message: string } | null
  rpcError?: { message: string } | null
} = {}) {
  const from = vi.fn()
  const rpc = vi.fn().mockResolvedValue({ data: null, error: options.rpcError ?? null })

  const selectFrom = vi.fn((table: string) => {
    from(table)
    const builder: any = {
      select: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      execute: vi.fn(async () => {
        if (options.readError) throw new Error(options.readError.message)
        return [{ seq: 7 }]
      }),
    }
    return builder
  })

  const insertInto = vi.fn((table: string) => {
    from(table)
    const builder: any = {
      values: vi.fn(() => builder),
      execute: vi.fn(async () => {
        if (options.insertError) throw new Error(options.insertError.message)
        return []
      }),
    }
    return builder
  })

  const client = { from, rpc, selectFrom, insertInto }
  return { client, from, insert: insertInto, rpc }
}

const baseAttempt = {
  storyId: 'story-1',
  chapter: 12,
  repairAttempts: 2,
  findings: [],
  correlationId: 'correlation-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('telemetry atomic behavior', () => {
  it('rejects REVIEW_REQUIRED without an idempotency key before any write', async () => {
    const admin = makeAdminClient()
    mocks.createAdminClient.mockReturnValue(admin.client)

    await expect(recordGenerationAttempt({
      ...baseAttempt,
      outcome: 'REVIEW_REQUIRED',
    })).rejects.toThrow('REVIEW_REQUIRED_IDEMPOTENCY_KEY_REQUIRED')

    expect(admin.rpc).not.toHaveBeenCalled()
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('propagates enqueue RPC errors without attempting an append fallback', async () => {
    const admin = makeAdminClient({ rpcError: { message: 'atomic enqueue failed' } })
    mocks.createAdminClient.mockReturnValue(admin.client)

    await expect(recordGenerationAttempt({
      ...baseAttempt,
      outcome: 'REVIEW_REQUIRED',
      idempotencyKey: 'review:story-1:12',
    })).rejects.toThrow('enqueue_runtime_review_v1: atomic enqueue failed')

    expect(admin.rpc).toHaveBeenCalledOnce()
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('uses only the enqueue RPC for REVIEW_REQUIRED and never appends separately', async () => {
    const admin = makeAdminClient()
    mocks.createAdminClient.mockReturnValue(admin.client)

    await recordGenerationAttempt({
      ...baseAttempt,
      outcome: 'REVIEW_REQUIRED',
      idempotencyKey: 'review:story-1:12',
    })

    expect(admin.rpc).toHaveBeenCalledWith('enqueue_runtime_review_v1', expect.objectContaining({
      p_story_id: 'story-1',
      p_chapter_number: 12,
      p_idempotency_key: 'review:story-1:12',
    }))
    expect(admin.from).not.toHaveBeenCalled()
  })

  it.each([
    ['sequence read', { readError: { message: 'read failed' } }],
    ['event insert', { insertError: { message: 'insert failed' } }],
  ])('keeps PUBLISHED append %s errors best-effort', async (_failure, options) => {
    const admin = makeAdminClient(options)
    mocks.createAdminClient.mockReturnValue(admin.client)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(recordGenerationAttempt({
      ...baseAttempt,
      outcome: 'PUBLISHED',
    })).resolves.toBeUndefined()

    expect(admin.rpc).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      '[v0] recordGenerationAttempt gagal (non-kritis):',
      expect.stringContaining('failed'),
    )
    log.mockRestore()
  })

  it('never calls the enqueue RPC for GENERATION_RUNTIME_FAILED', async () => {
    const admin = makeAdminClient()
    mocks.createAdminClient.mockReturnValue(admin.client)

    await recordGenerationRuntimeFailed({
      storyId: 'story-1',
      chapter: 12,
      correlationId: 'correlation-1',
      stage: 'PUBLISH',
      errorCode: 'PUBLISH_FAILED',
      errorName: 'Error',
    })

    expect(admin.rpc).not.toHaveBeenCalled()
    expect(admin.from).toHaveBeenCalledWith('story_events')
  })
})
