import { describe, expect, it, vi } from 'vitest'
import {
  createSynchronousProviderContext,
  providerContextFromClaim,
} from '@/lib/runtime/generation-provider-context'
import type { ClaimedGenerationJob } from '@/lib/runtime/generation-jobs.contract'

vi.mock('server-only', () => ({}))

const userId = '10000000-0000-4000-8000-000000000001'
const correlationId = '20000000-0000-4000-8000-000000000002'

describe('generation provider context', () => {
  it('creates trusted synchronous context without job identity', () => {
    expect(createSynchronousProviderContext({
      userId,
      storyId: 'story-1',
      chapterNumber: 2,
      generationKind: 'standard',
      correlationId,
    })).toEqual({
      userId,
      storyId: 'story-1',
      chapterNumber: 2,
      generationKind: 'standard',
      jobId: null,
      correlationId,
      attemptNumber: null,
    })
  })

  it('maps claimed job identity exactly', () => {
    const claimedJob: ClaimedGenerationJob = {
      id: '30000000-0000-4000-8000-000000000003',
      storyId: 'story-2',
      chapterNumber: 9,
      userId,
      generationKind: 'personalized',
      triggerChoiceId: 'open-door',
      attemptCount: 3,
      maxAttempts: 5,
      deadlineAt: '2026-07-18T12:05:00.000Z',
      correlationId,
      workerId: 'worker-1',
      claimToken: '40000000-0000-4000-8000-000000000004',
    }
    const expected = {
      userId: claimedJob.userId,
      storyId: claimedJob.storyId,
      chapterNumber: claimedJob.chapterNumber,
      generationKind: claimedJob.generationKind,
      jobId: claimedJob.id,
      correlationId: claimedJob.correlationId,
      attemptNumber: claimedJob.attemptCount,
    }

    expect(providerContextFromClaim(claimedJob)).toEqual(expected)
  })
})
