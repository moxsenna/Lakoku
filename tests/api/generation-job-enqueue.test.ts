import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222'

function rpcResult(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  mocks.cookieFactory.mockResolvedValue({ rpc })
  return rpc
}

function rpcError(message: string, code = 'P0001') {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message } })
  mocks.cookieFactory.mockResolvedValue({ rpc })
  return rpc
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
