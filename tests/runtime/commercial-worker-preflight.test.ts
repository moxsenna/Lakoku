import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeClaimedJob } from '@/lib/runtime/generation-worker'
import { runChapterGenerationAttempt } from '@/lib/runtime/generation-mode'
import { resolveCommercialWorkerPreflight } from '@/lib/commercial/worker-preflight.server'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/runtime/generation-jobs', () => ({
  acquireGenerationJobLease: vi.fn(async () => ({ ok: true, leaseId: 'lease-mock-1' })),
  heartbeatGenerationJob: vi.fn(async () => ({ ok: true })),
  finishGenerationJobAttempt: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/runtime/generation-mode', () => ({
  runChapterGenerationAttempt: vi.fn(async () => ({ ok: true, published: true })),
}))

vi.mock('@/lib/runtime/generation-lease-ttl', () => ({
  resolveGenerationLeaseTtlSeconds: vi.fn(async () => 120),
}))

vi.mock('@/lib/commercial/worker-preflight.server', () => ({
  resolveCommercialWorkerPreflight: vi.fn(),
  evaluateCommercialWorkerPreflight: vi.fn(),
}))

const mockResolvePreflight = vi.mocked(resolveCommercialWorkerPreflight)
const mockRunChapterGenerationAttempt = vi.mocked(runChapterGenerationAttempt)

describe('commercial-worker-preflight zero-provider dispatch assertions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails preflight with ZERO provider calls when preflight returns DENIED for missing/unbound intent', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'COMMERCIAL_INTENT_NOT_BOUND' })

    const result = await executeClaimedJob({
      id: 'job-unauthorized',
      userId: 'user-worker',
      storyId: 'story-worker-test',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: 'choice-1',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('COMMERCIAL_PREFLIGHT_FAILED')
    }

    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when preflight returns DENIED for commercial owner mismatch', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'COMMERCIAL_OWNER_MISMATCH' })

    const result = await executeClaimedJob({
      id: 'job-mismatch',
      userId: 'user-a',
      storyId: 'story-1',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: null,
    })

    expect(result.ok).toBe(false)
    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when intent is not QUEUED (status AUTHORIZED or RUNNING)', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'COMMERCIAL_INTENT_NOT_QUEUED' })

    const result = await executeClaimedJob({
      id: 'job-intent-running',
      userId: 'user-1',
      storyId: 'story-1',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: 'c1',
    })

    expect(result.ok).toBe(false)
    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls for PAID_START Bab 1 fresh RUNNING job replay', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'PAID_START_BAB1_REPLAY_FORBIDDEN' })

    const result = await executeClaimedJob({
      id: 'job-paid-start-replay',
      userId: 'user-1',
      storyId: 'story-1',
      chapterNumber: 1,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: null,
    })

    expect(result.ok).toBe(false)
    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when preflight returns WAITING_FOR_CREDITS due to insufficient credits', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'WAITING_FOR_CREDITS', origin: 'STARTER_FREE', reason: 'INSUFFICIENT_CREDITS' })

    const result = await executeClaimedJob({
      id: 'job-waiting',
      userId: 'user-1',
      storyId: 'story-1',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: 'c1',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('COMMERCIAL_PREFLIGHT_FAILED')
    }

    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when reservation RPC encounters an internal error', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'COMMERCIAL_RESERVATION_FAILED' })

    const result = await executeClaimedJob({
      id: 'job-rpc-err',
      userId: 'user-1',
      storyId: 'story-1',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: 'c1',
    })

    expect(result.ok).toBe(false)
    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when preflight returns DENIED for wrong DB generation_kind (JOB_STATE_MISMATCH)', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'JOB_STATE_MISMATCH' })

    const result = await executeClaimedJob({
      id: 'job-wrong-kind',
      userId: 'user-1',
      storyId: 'story-1',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: 'c1',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('COMMERCIAL_PREFLIGHT_FAILED')
    }
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when preflight returns DENIED for wrong DB trigger_choice_id mismatch', async () => {
    mockResolvePreflight.mockResolvedValueOnce({ status: 'DENIED', reason: 'JOB_STATE_MISMATCH' })

    const result = await executeClaimedJob({
      id: 'job-wrong-trigger',
      userId: 'user-1',
      storyId: 'story-1',
      chapterNumber: 4,
      generationKind: 'personalized',
      workerId: 'worker-1',
      claimToken: 'token-1',
      correlationId: 'corr-1',
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      triggerChoiceId: 'choice-mismatched',
    })

    expect(result.ok).toBe(false)
    expect(mockResolvePreflight).toHaveBeenCalledTimes(1)
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })
})
