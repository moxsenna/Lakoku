import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeClaimedJob } from '@/lib/runtime/generation-worker'
import { createAdminClient } from '@/lib/supabase/admin'
import { runChapterGenerationAttempt } from '@/lib/runtime/generation-mode'

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

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockRunChapterGenerationAttempt = vi.mocked(runChapterGenerationAttempt)

describe('commercial-worker-preflight zero-provider dispatch assertions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails preflight and ZERO provider calls when intent is missing/wrong job', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'generation_jobs') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'job-unauthorized',
                    user_id: 'user-worker',
                    story_id: 'story-worker-test',
                    chapter_number: 4,
                    trigger_choice_id: 'choice-1',
                    generation_kind: 'personalized',
                    status: 'RUNNING',
                    worker_id: 'worker-1',
                    claim_token: 'token-1',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'feature_credit_costs') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  { feature_key: 'story_start', credits_required: 24, is_active: true },
                  { feature_key: 'chapter_unlock', credits_required: 8, is_active: true },
                ],
                error: null,
              }),
            }),
          }
        }
        if (table === 'stories') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'story-worker-test',
                    owner_user_id: 'user-worker',
                    story_mode: 'personalized_ai',
                    commercial_origin: 'PAID_START',
                    visibility: 'private',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'commercial_generation_intents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: null, // Intent missing / not bound
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

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

    // REQUIREMENT 13: Zero provider calls asserted!
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('fails preflight with ZERO provider calls when story owner mismatches job user', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'generation_jobs') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'job-mismatch',
                    user_id: 'user-a',
                    story_id: 'story-1',
                    chapter_number: 4,
                    trigger_choice_id: null,
                    generation_kind: 'personalized',
                    status: 'RUNNING',
                    worker_id: 'worker-1',
                    claim_token: 'token-1',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'feature_credit_costs') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  { feature_key: 'story_start', credits_required: 24, is_active: true },
                  { feature_key: 'chapter_unlock', credits_required: 8, is_active: true },
                ],
                error: null,
              }),
            }),
          }
        }
        if (table === 'stories') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'story-1',
                    owner_user_id: 'user-b', // Owner mismatch!
                    story_mode: 'personalized_ai',
                    commercial_origin: 'PAID_START',
                    visibility: 'private',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

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
    expect(mockRunChapterGenerationAttempt).not.toHaveBeenCalled()
  })
})
