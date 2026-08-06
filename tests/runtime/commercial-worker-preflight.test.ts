import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeClaimedJob } from '@/lib/runtime/generation-worker'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/runtime/generation-jobs', () => ({
  acquireGenerationJobLease: vi.fn(async () => ({ ok: true, leaseId: 'lease-mock-1' })),
  heartbeatGenerationJob: vi.fn(async () => ({ ok: true })),
  finishGenerationJobAttempt: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/runtime/generation-lease-ttl', () => ({
  resolveGenerationLeaseTtlSeconds: vi.fn(async () => 120),
}))

const mockCreateAdminClient = vi.mocked(createAdminClient)

describe('commercial-worker-preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails preflight and returns COMMERCIAL_PREFLIGHT_FAILED when intent is missing/wrong job', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
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
  })
})
