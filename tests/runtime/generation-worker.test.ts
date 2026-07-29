import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimGenerationJob: vi.fn(),
  claimGenerationJobById: vi.fn(),
  acquireGenerationJobLease: vi.fn(),
  heartbeatGenerationJob: vi.fn(),
  finishGenerationJobAttempt: vi.fn(),
  runChapterGenerationAttempt: vi.fn(),
  resolveGenerationLeaseTtlSeconds: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/runtime/generation-jobs', () => ({
  claimGenerationJob: mocks.claimGenerationJob,
  claimGenerationJobById: mocks.claimGenerationJobById,
  acquireGenerationJobLease: mocks.acquireGenerationJobLease,
  heartbeatGenerationJob: mocks.heartbeatGenerationJob,
  finishGenerationJobAttempt: mocks.finishGenerationJobAttempt,
}))
vi.mock('@/lib/runtime/generation-mode', () => ({
  runChapterGenerationAttempt: mocks.runChapterGenerationAttempt,
}))
vi.mock('@/lib/runtime/generation-lease-ttl', () => ({
  resolveGenerationLeaseTtlSeconds: mocks.resolveGenerationLeaseTtlSeconds,
}))

const JOB = {
  id: '00000000-0000-4000-8000-000000000001',
  storyId: 'story-1',
  chapterNumber: 1,
  userId: '00000000-0000-4000-8000-0000000000aa',
  generationKind: 'standard' as const,
  triggerChoiceId: null,
  attemptCount: 1,
  maxAttempts: 4,
  deadlineAt: new Date(Date.now() + 600_000).toISOString(),
  correlationId: '00000000-0000-4000-8000-0000000000bb',
  workerId: 'worker-x',
  claimToken: '00000000-0000-4000-8000-0000000000cc',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveGenerationLeaseTtlSeconds.mockResolvedValue(180)
  mocks.acquireGenerationJobLease.mockResolvedValue({ ok: true, leaseId: 'lease-1' })
  mocks.heartbeatGenerationJob.mockResolvedValue({ ok: true })
  mocks.finishGenerationJobAttempt.mockResolvedValue({ ok: true, status: 'RETRY_WAIT' })
})

describe('executeClaimedJob heartbeat/abort/ownership', () => {
  it('first-heartbeat failure → generator NOT called, no finish', async () => {
    mocks.heartbeatGenerationJob.mockResolvedValueOnce({ ok: false, reason: 'OWNERSHIP_LOST' })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    const res = await runAlreadyClaimedGenerationJob(JOB)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.outcome).toBe('OWNERSHIP_LOST')
    expect(mocks.runChapterGenerationAttempt).not.toHaveBeenCalled()
    expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
  })

  it('lease acquire failure → no generator, no finish', async () => {
    mocks.acquireGenerationJobLease.mockResolvedValueOnce({ ok: false, reason: 'LEASE_HELD' })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    const res = await runAlreadyClaimedGenerationJob(JOB)
    expect(res.ok).toBe(false)
    expect(mocks.runChapterGenerationAttempt).not.toHaveBeenCalled()
    expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
  })

  it('generator success (fenced publish) → SUCCEEDED, no finish(SUCCEEDED)', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'standard',
      result: { ok: true, chapterNumber: 1, seq: 5 },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    const res = await runAlreadyClaimedGenerationJob(JOB)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.outcome).toBe('SUCCEEDED')
    // Success never calls finish; SUCCEEDED comes only from fenced publish RPC.
    expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
  })

  it('post-publish checkpoint reconciliation success does not finish generation job', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'standard',
      result: { ok: true, chapterNumber: 1, seq: 5 },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')

    await expect(runAlreadyClaimedGenerationJob(JOB)).resolves.toMatchObject({
      ok: true,
      outcome: 'SUCCEEDED',
    })
    expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
  })

  it('preserves claimed explicit trigger choice in execution context and dispatcher input', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'personalized_ai',
      result: { ok: true, chapterNumber: 2, seq: 5 },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    await runAlreadyClaimedGenerationJob({
      ...JOB,
      generationKind: 'personalized',
      triggerChoiceId: 'choice-A',
    })
    const arg = mocks.runChapterGenerationAttempt.mock.calls[0][0]
    expect(arg.attemptId).toBe(JOB.id)
    expect(arg.triggerChoiceId).toBe('choice-A')
    expect(arg.jobContext).toBeTruthy()
    expect(arg.jobContext.jobId).toBe(JOB.id)
    expect(arg.jobContext.leaseId).toBe('lease-1')
    expect(arg.jobContext.triggerChoiceId).toBe('choice-A')
    expect(arg.jobContext.signal).toBeInstanceOf(AbortSignal)
  })

  it('preserves null trigger choice without synthesizing one', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'standard',
      result: { ok: true, chapterNumber: 1, seq: 5 },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    await runAlreadyClaimedGenerationJob(JOB)
    const arg = mocks.runChapterGenerationAttempt.mock.calls[0][0]
    expect(arg.triggerChoiceId).toBeNull()
    expect(arg.jobContext.triggerChoiceId).toBeNull()
  })

  it('retryable inner failure → finish RETRY_WAIT (not success)', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'standard',
      result: { ok: false, reason: 'CHOICE_GENERATION_FAILED' },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    const res = await runAlreadyClaimedGenerationJob(JOB)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.outcome).toBe('RETRY_WAIT')
    expect(mocks.finishGenerationJobAttempt).toHaveBeenCalledTimes(1)
    const finishArg = mocks.finishGenerationJobAttempt.mock.calls[0][0]
    expect(finishArg.outcome).toBe('RETRY_WAIT')
    expect(finishArg.availableAt).toBeTruthy()
  })

  it('terminal inner failure → finish FAILED', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'standard',
      result: { ok: false, reason: 'FAILED_REVIEW_REQUIRED' },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
    const res = await runAlreadyClaimedGenerationJob(JOB)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.outcome).toBe('FAILED')
    const finishArg = mocks.finishGenerationJobAttempt.mock.calls[0][0]
    expect(finishArg.outcome).toBe('FAILED')
  })

  it('personalized final CHAPTER_EXISTS → ALREADY_DONE without finish', async () => {
    mocks.runChapterGenerationAttempt.mockResolvedValueOnce({
      ok: true,
      mode: 'personalized_ai',
      result: { ok: false, reason: 'CHAPTER_EXISTS' },
    })
    const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')

    const res = await runAlreadyClaimedGenerationJob({
      ...JOB,
      chapterNumber: 50,
      generationKind: 'personalized',
    })

    expect(res).toEqual({ ok: true, outcome: 'ALREADY_DONE', jobId: JOB.id })
    expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
  })

})

describe('executeClaimedJob ownership loss via heartbeat interval (fake timers)', () => {
  it('returns SUCCEEDED when fenced publish committed before post-publish ownership loss', async () => {
    vi.useFakeTimers()
    try {
      let publishCommitted = false
      mocks.heartbeatGenerationJob
        .mockResolvedValueOnce({ ok: true })
        .mockImplementation(async () =>
          publishCommitted ? { ok: false, reason: 'OWNERSHIP_LOST' } : { ok: true },
        )

      let resolveGenerator: ((value: unknown) => void) | undefined
      mocks.runChapterGenerationAttempt.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGenerator = resolve
          }),
      )

      const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
      const promise = runAlreadyClaimedGenerationJob(JOB)
      await vi.waitFor(() => expect(resolveGenerator).toBeTypeOf('function'))

      // Fenced publish committed, but generator remains pending during reconciliation.
      publishCommitted = true
      await vi.advanceTimersByTimeAsync(16_000)
      resolveGenerator?.({
        ok: true,
        mode: 'standard',
        result: { ok: true, chapterNumber: 1, seq: 5 },
      })

      await expect(promise).resolves.toMatchObject({
        ok: true,
        outcome: 'SUCCEEDED',
      })
      expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('interval heartbeat OWNERSHIP_LOST aborts and prevents publish/finish', async () => {
    vi.useFakeTimers()
    try {
      mocks.heartbeatGenerationJob
        .mockResolvedValueOnce({ ok: true }) // first heartbeat
        .mockResolvedValue({ ok: false, reason: 'OWNERSHIP_LOST' }) // interval loses

      let sawAbort = false
      mocks.runChapterGenerationAttempt.mockImplementationOnce(
        (arg: { jobContext?: { signal: AbortSignal } }) =>
          new Promise((resolve) => {
            const signal = arg.jobContext?.signal
            if (signal) {
              signal.addEventListener('abort', () => {
                sawAbort = true
                // Generator that respects abort would stop here without publishing.
                resolve({ ok: false, reason: 'CAPACITY_TIMEOUT' })
              })
            }
          }),
      )

      const { runAlreadyClaimedGenerationJob } = await import('@/lib/runtime/generation-worker')
      const promise = runAlreadyClaimedGenerationJob(JOB)

      // Advance past the heartbeat interval (15s) to trigger ownership loss.
      await vi.advanceTimersByTimeAsync(16_000)

      const res = await promise
      expect(sawAbort).toBe(true)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.outcome).toBe('OWNERSHIP_LOST')
      // Ownership lost: no finish call mutating another worker's job.
      expect(mocks.finishGenerationJobAttempt).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
