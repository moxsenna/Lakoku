import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const CORRELATION_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_TOKEN = '44444444-4444-4444-8444-444444444444'
const LEASE_ID = '55555555-5555-4555-8555-555555555555'
const DEADLINE_AT = '2026-07-18T12:00:00+07:00'
const STARTED_AT = '2026-07-18T04:00:00Z'
const ENDED_AT = '2026-07-18T04:01:00Z'
const AVAILABLE_AT = '2026-07-18T04:02:00Z'

function rpcResult(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  mocks.adminFactory.mockReturnValue({ rpc })
  return rpc
}

function rpcError(message: string, code = 'P0001') {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message } })
  mocks.adminFactory.mockReturnValue({ rpc })
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('generation job worker RPC adapters', () => {
  it('claims with exact payload and maps snake-case job fields', async () => {
    const rpc = rpcResult({
      claimed: true,
      job: {
        id: JOB_ID,
        story_id: 'story-a',
        chapter_number: 2,
        user_id: USER_ID,
        generation_kind: 'standard',
        trigger_choice_id: null,
        attempt_count: 1,
        max_attempts: 4,
        deadline_at: DEADLINE_AT,
        correlation_id: CORRELATION_ID,
        worker_id: 'worker-a',
        claim_token: CLAIM_TOKEN,
        ignored_future_field: 'ignored',
      },
      ignored_future_field: 'ignored',
    })
    const { claimGenerationJob } = await import('@/lib/runtime/generation-jobs')

    await expect(claimGenerationJob({ workerId: 'worker-a' })).resolves.toEqual({
      claimed: true,
      job: {
        id: JOB_ID,
        storyId: 'story-a',
        chapterNumber: 2,
        userId: USER_ID,
        generationKind: 'standard',
        triggerChoiceId: null,
        attemptCount: 1,
        maxAttempts: 4,
        deadlineAt: DEADLINE_AT,
        correlationId: CORRELATION_ID,
        workerId: 'worker-a',
        claimToken: CLAIM_TOKEN,
      },
    })
    expect(rpc).toHaveBeenCalledWith('claim_generation_job_v1', {
      p_worker_id: 'worker-a',
    })
  })

  it('maps empty claim and rejects malformed claimed data', async () => {
    rpcResult({ claimed: false, ignored_future_field: true })
    const { claimGenerationJob } = await import('@/lib/runtime/generation-jobs')
    await expect(claimGenerationJob({ workerId: 'worker-a' })).resolves.toEqual({ claimed: false })

    rpcResult({ claimed: true, job: { id: JOB_ID } })
    await expect(claimGenerationJob({ workerId: 'worker-a' })).rejects.toThrow()
  })

  it('acquires bound lease with exact payload and preserves failure reason', async () => {
    const rpc = rpcResult({ ok: true, lease_id: LEASE_ID, expires_at: DEADLINE_AT })
    const { acquireGenerationJobLease } = await import('@/lib/runtime/generation-jobs')
    const input = {
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      ttlSeconds: 180,
    }
    const before = structuredClone(input)

    await expect(acquireGenerationJobLease(input)).resolves.toEqual({ ok: true, leaseId: LEASE_ID })
    expect(input).toEqual(before)
    expect(rpc).toHaveBeenCalledWith('acquire_generation_job_lease_v1', {
      p_job_id: JOB_ID,
      p_worker_id: 'worker-a',
      p_claim_token: CLAIM_TOKEN,
      p_ttl_seconds: 180,
    })

    rpcResult({ ok: false, reason: 'LEASE_HELD' })
    await expect(acquireGenerationJobLease(input)).resolves.toEqual({
      ok: false,
      reason: 'LEASE_HELD',
    })
  })

  it('heartbeats with exact payload and maps minimal result', async () => {
    const rpc = rpcResult({ ok: true, heartbeat_at: DEADLINE_AT, lease_expires_at: DEADLINE_AT })
    const { heartbeatGenerationJob } = await import('@/lib/runtime/generation-jobs')

    await expect(heartbeatGenerationJob({
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      leaseId: LEASE_ID,
      ttlSeconds: 180,
    })).resolves.toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('heartbeat_generation_job_v1', {
      p_job_id: JOB_ID,
      p_worker_id: 'worker-a',
      p_claim_token: CLAIM_TOKEN,
      p_lease_id: LEASE_ID,
      p_ttl_seconds: 180,
    })

    rpcResult({ ok: false, reason: 'OWNERSHIP_LOST' })
    await expect(heartbeatGenerationJob({
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      leaseId: LEASE_ID,
      ttlSeconds: 180,
    })).resolves.toEqual({ ok: false, reason: 'OWNERSHIP_LOST' })
  })

  it('finishes attempt with exact telemetry payload and normalized typed output', async () => {
    const rpc = rpcResult({ ok: true, status: 'RETRY_WAIT', ignored_future_field: true })
    const { finishGenerationJobAttempt } = await import('@/lib/runtime/generation-jobs')
    const input = {
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      outcome: 'RETRY_WAIT' as const,
      availableAt: AVAILABLE_AT,
      errorCode: 'PROVIDER_TIMEOUT',
      errorClass: 'TRANSIENT',
      workflowPhase: 'PROSE_GENERATION',
      providerId: 'provider-a',
      modelId: 'model-a',
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      elapsedMs: 60_000,
      leaseAgeMs: 61_000,
      leaseRemainingMs: 119_000,
      retryDecision: 'RETRY_BACKOFF',
    }
    const before = structuredClone(input)

    await expect(finishGenerationJobAttempt(input)).resolves.toEqual({
      ok: true,
      status: 'RETRY_WAIT',
    })
    expect(input).toEqual(before)
    expect(rpc).toHaveBeenCalledWith('finish_generation_job_attempt_v1', {
      p_job_id: JOB_ID,
      p_worker_id: 'worker-a',
      p_claim_token: CLAIM_TOKEN,
      p_outcome: 'RETRY_WAIT',
      p_available_at: AVAILABLE_AT,
      p_error_code: 'PROVIDER_TIMEOUT',
      p_error_class: 'TRANSIENT',
      p_workflow_phase: 'PROSE_GENERATION',
      p_provider_id: 'provider-a',
      p_model_id: 'model-a',
      p_started_at: STARTED_AT,
      p_ended_at: ENDED_AT,
      p_elapsed_ms: 60_000,
      p_lease_age_ms: 61_000,
      p_lease_remaining_ms: 119_000,
      p_retry_decision: 'RETRY_BACKOFF',
    })

    rpcResult({ ok: false, reason: 'OWNERSHIP_LOST' })
    await expect(finishGenerationJobAttempt(input)).resolves.toEqual({
      ok: false,
      reason: 'OWNERSHIP_LOST',
    })
  })

  it('cancels with exact payload and normalized typed output', async () => {
    const rpc = rpcResult({ ok: true, status: 'CANCELLED', completed_at: ENDED_AT })
    const { cancelGenerationJob } = await import('@/lib/runtime/generation-jobs')

    await expect(cancelGenerationJob({ jobId: JOB_ID, reason: 'operator rollback' })).resolves.toEqual({
      ok: true,
      status: 'CANCELLED',
    })
    expect(rpc).toHaveBeenCalledWith('cancel_generation_job_v1', {
      p_job_id: JOB_ID,
      p_reason: 'operator rollback',
    })

    rpcResult({ ok: false, reason: 'NOT_CANCELLABLE' })
    await expect(cancelGenerationJob({ jobId: JOB_ID, reason: 'operator rollback' })).resolves.toEqual({
      ok: false,
      reason: 'NOT_CANCELLABLE',
    })
  })

  it('recovers with exact payload and maps only recoveredCount', async () => {
    const rpc = rpcResult({ recovered_count: 2, job_ids: [JOB_ID], ignored_future_field: true })
    const { recoverStaleGenerationJobs } = await import('@/lib/runtime/generation-jobs')

    await expect(recoverStaleGenerationJobs({ batchSize: 20 })).resolves.toEqual({ recoveredCount: 2 })
    expect(rpc).toHaveBeenCalledWith('recover_stale_generation_jobs_v1', {
      p_batch_size: 20,
    })
  })

  it.each([
    ['publishGenerationJobChapterV1', 'publish_generation_job_chapter_v1'],
    ['publishGenerationJobChapterV2', 'publish_generation_job_chapter_v2'],
  ] as const)('%s publishes with exact fenced payload', async (methodName, rpcName) => {
    const rpc = rpcResult({ ok: true, chapter_number: 2, seq: 8, jobId: JOB_ID, private: 'ignored' })
    const adapters = await import('@/lib/runtime/generation-jobs')
    const input = {
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      leaseId: LEASE_ID,
      storyId: 'story-a',
      chapterNumber: 2,
      title: 'Bab Dua',
      paragraphs: ['Paragraf pertama.'],
      choicePrompt: 'Apa pilihanmu?',
      choices: [{ id: 'choice-a', label: 'Pilih A' }],
      outcomes: [{
        choiceId: 'choice-a',
        consequence: ['Akibat A.'],
        nextChapterNumber: 3,
        isEnding: false,
      }],
    }
    const before = structuredClone(input)

    await expect(adapters[methodName](input)).resolves.toEqual({
      ok: true,
      chapterNumber: 2,
      seq: 8,
      jobId: JOB_ID,
    })
    expect(input).toEqual(before)
    expect(rpc).toHaveBeenCalledWith(rpcName, {
      p_job_id: JOB_ID,
      p_worker_id: 'worker-a',
      p_claim_token: CLAIM_TOKEN,
      p_lease_id: LEASE_ID,
      p_story_id: 'story-a',
      p_chapter_number: 2,
      p_title: 'Bab Dua',
      p_paragraphs: ['Paragraf pertama.'],
      p_choice_prompt: 'Apa pilihanmu?',
      p_choices: [{ id: 'choice-a', label: 'Pilih A' }],
      p_outcomes: [{
        choiceId: 'choice-a',
        consequence: ['Akibat A.'],
        nextChapterNumber: 3,
        isEnding: false,
      }],
    })
  })

  it('rejects malformed RPC outputs instead of casting', async () => {
    rpcResult({ ok: true, status: 'SUCCEEDED' })
    const { finishGenerationJobAttempt } = await import('@/lib/runtime/generation-jobs')

    await expect(finishGenerationJobAttempt({
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      outcome: 'FAILED',
      availableAt: null,
      errorCode: 'INVALID_CANON',
      errorClass: 'TERMINAL',
      workflowPhase: 'PREFLIGHT',
      providerId: null,
      modelId: null,
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      elapsedMs: 60_000,
      leaseAgeMs: null,
      leaseRemainingMs: null,
      retryDecision: null,
    })).rejects.toThrow()
  })

  it('validates input before creating admin client or calling RPC', async () => {
    const { claimGenerationJob } = await import('@/lib/runtime/generation-jobs')

    await expect(claimGenerationJob({ workerId: '   ' })).rejects.toThrow()
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it.each([
    ['GENERATION_JOB_OWNERSHIP_LOST', 'GENERATION_JOB_OWNERSHIP_LOST'],
    ['LEASE_HELD', 'LEASE_HELD'],
    ['GENERATION_JOB_DEADLINE_EXCEEDED', 'GENERATION_DEADLINE_EXCEEDED'],
    ['GENERATION_RETRY_EXHAUSTED', 'GENERATION_RETRY_EXHAUSTED'],
    ['GENERATION_PUBLICATION_CONFLICT', 'GENERATION_PUBLICATION_CONFLICT'],
    ['INVALID_GENERATION_JOB_TRANSITION', 'INVALID_GENERATION_JOB_TRANSITION'],
  ] as const)('maps known SQL token %s to stable code %s', async (token, expectedCode) => {
    rpcError(`database operation failed: ${token}`)
    const { claimGenerationJob, GenerationJobError } = await import('@/lib/runtime/generation-jobs')

    const error = await claimGenerationJob({ workerId: 'worker-a' }).catch((caught) => caught)
    expect(error).toBeInstanceOf(GenerationJobError)
    expect(error).toMatchObject({ code: expectedCode, message: expectedCode })
  })

  it('maps unknown database errors to INTERNAL_ERROR without raw code or message', async () => {
    rpcError('secret provider table detail', 'XX999')
    const { claimGenerationJob, GenerationJobError } = await import('@/lib/runtime/generation-jobs')

    const error = await claimGenerationJob({ workerId: 'worker-a' }).catch((caught) => caught)
    expect(error).toBeInstanceOf(GenerationJobError)
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR' })
    expect(JSON.stringify(error)).not.toContain('XX999')
    expect(JSON.stringify(error)).not.toContain('secret provider table detail')
  })
})
