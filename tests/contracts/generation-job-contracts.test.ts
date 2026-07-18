import { describe, expect, it } from 'vitest'
import * as publicContracts from '../../packages/contracts/src/index'
import {
  EnqueueGenerationJobResultSchema,
  GENERATION_JOB_STATUSES,
  GENERATION_KINDS,
  GenerationJobReaderErrorCodeSchema,
  GenerationJobReaderStatusSchema,
  GenerationJobStatusSchema,
  GenerationKindSchema,
} from '../../packages/contracts/src/index'
import {
  ClaimedGenerationJobSchema,
  FencedPublicationIdentitySchema,
  GenerationJobClaimResultSchema,
  GenerationJobFinishOutcomeSchema,
  GenerationJobHeartbeatResultSchema,
  GenerationJobLeaseResultSchema,
  GenerationJobRecoveryResultSchema,
} from '@/lib/runtime/generation-jobs.contract'

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_TOKEN = '44444444-4444-4444-8444-444444444444'
const LEASE_ID = '55555555-5555-4555-8555-555555555555'

const claimedJob = {
  id: JOB_ID,
  storyId: 'story-a',
  chapterNumber: 2,
  userId: USER_ID,
  generationKind: 'standard',
  triggerChoiceId: null,
  attemptCount: 1,
  maxAttempts: 4,
  deadlineAt: '2026-07-18T12:00:00+07:00',
  correlationId: CORRELATION_ID,
  workerId: 'worker-a',
  claimToken: CLAIM_TOKEN,
} as const

describe('public generation job contracts', () => {
  it('exports exact statuses, kinds, and reader error codes', () => {
    expect(GENERATION_JOB_STATUSES).toEqual([
      'QUEUED',
      'RUNNING',
      'RETRY_WAIT',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ])
    expect(GENERATION_KINDS).toEqual(['standard', 'personalized'])
    expect(GenerationJobStatusSchema.options).toEqual(GENERATION_JOB_STATUSES)
    expect(GenerationKindSchema.options).toEqual(GENERATION_KINDS)
    expect(GenerationJobReaderErrorCodeSchema.options).toEqual([
      'GENERATION_JOB_CONFLICT',
      'GENERATION_DEADLINE_EXCEEDED',
      'GENERATION_RETRY_EXHAUSTED',
      'GENERATION_FAILED',
      'GENERATION_CANCELLED',
    ])
  })

  it('accepts active enqueue with UUID identities', () => {
    expect(EnqueueGenerationJobResultSchema.parse({
      alreadyComplete: false,
      jobId: JOB_ID,
      correlationId: CORRELATION_ID,
      status: 'QUEUED',
    })).toEqual({
      alreadyComplete: false,
      jobId: JOB_ID,
      correlationId: CORRELATION_ID,
      status: 'QUEUED',
    })
  })

  it('accepts completed fast path only with null identities', () => {
    expect(EnqueueGenerationJobResultSchema.parse({
      alreadyComplete: true,
      jobId: null,
      correlationId: null,
      status: 'SUCCEEDED',
    })).toMatchObject({ alreadyComplete: true })
    expect(() => EnqueueGenerationJobResultSchema.parse({
      alreadyComplete: true,
      jobId: JOB_ID,
      correlationId: null,
      status: 'SUCCEEDED',
    })).toThrow()
  })

  it('rejects mixed and unknown enqueue fields', () => {
    expect(EnqueueGenerationJobResultSchema.safeParse({
      alreadyComplete: false,
      jobId: JOB_ID,
      correlationId: CORRELATION_ID,
      status: 'SUCCEEDED',
    }).success).toBe(false)
    expect(EnqueueGenerationJobResultSchema.safeParse({
      alreadyComplete: true,
      jobId: null,
      correlationId: null,
      status: 'SUCCEEDED',
      workerId: 'private-worker',
    }).success).toBe(false)
  })

  it('accepts strict reader status with nullable error code', () => {
    expect(GenerationJobReaderStatusSchema.parse({
      jobId: JOB_ID,
      chapterNumber: 50,
      status: 'FAILED',
      errorCode: 'GENERATION_RETRY_EXHAUSTED',
    })).toMatchObject({ chapterNumber: 50, status: 'FAILED' })
    expect(GenerationJobReaderStatusSchema.parse({
      jobId: JOB_ID,
      chapterNumber: 1,
      status: 'RUNNING',
      errorCode: null,
    })).toMatchObject({ errorCode: null })
  })

  it('rejects internal fields from reader status', () => {
    expect(() => GenerationJobReaderStatusSchema.parse({
      status: 'RUNNING',
      jobId: JOB_ID,
      chapterNumber: 2,
      errorCode: null,
      workerId: 'worker-a',
      claimToken: CORRELATION_ID,
    })).toThrow()
    expect(GenerationJobReaderStatusSchema.safeParse({
      jobId: JOB_ID,
      chapterNumber: 0,
      status: 'QUEUED',
      errorCode: null,
    }).success).toBe(false)
    expect(GenerationJobReaderStatusSchema.safeParse({
      jobId: JOB_ID,
      chapterNumber: 51,
      status: 'QUEUED',
      errorCode: null,
    }).success).toBe(false)
  })

  it('exports public schemas without exporting internal schemas', () => {
    expect(publicContracts.EnqueueGenerationJobResultSchema).toBe(EnqueueGenerationJobResultSchema)
    expect(publicContracts.GenerationJobReaderStatusSchema).toBe(GenerationJobReaderStatusSchema)
    expect('ClaimedGenerationJobSchema' in publicContracts).toBe(false)
    expect('FencedPublicationIdentitySchema' in publicContracts).toBe(false)
  })
})

describe('internal generation job contracts', () => {
  it('accepts a strict fully owned claim', () => {
    expect(ClaimedGenerationJobSchema.parse(claimedJob)).toEqual(claimedJob)
    expect(ClaimedGenerationJobSchema.safeParse({
      ...claimedJob,
      claimedAt: '2026-07-18T05:00:00Z',
    }).success).toBe(false)
  })

  it('requires full ownership for running internal claim', () => {
    expect(() => ClaimedGenerationJobSchema.parse({
      ...claimedJob,
      claimToken: null,
    })).toThrow()
  })

  it('rejects invalid timestamp offsets', () => {
    expect(ClaimedGenerationJobSchema.safeParse({
      ...claimedJob,
      deadlineAt: '2026-07-18T12:00:00',
    }).success).toBe(false)
  })

  it('enforces attempt bounds and attemptCount not exceeding maxAttempts', () => {
    for (const attemptValues of [
      { attemptCount: 0, maxAttempts: 4 },
      { attemptCount: 1, maxAttempts: 21 },
      { attemptCount: 5, maxAttempts: 4 },
      { attemptCount: 1.5, maxAttempts: 4 },
    ]) {
      expect(ClaimedGenerationJobSchema.safeParse({
        ...claimedJob,
        ...attemptValues,
      }).success).toBe(false)
    }
    expect(ClaimedGenerationJobSchema.safeParse({
      ...claimedJob,
      attemptCount: 20,
      maxAttempts: 20,
    }).success).toBe(true)
  })

  it('rejects blank or oversized worker IDs and snake_case fields', () => {
    expect(ClaimedGenerationJobSchema.safeParse({
      ...claimedJob,
      workerId: '   ',
    }).success).toBe(false)
    expect(ClaimedGenerationJobSchema.safeParse({
      ...claimedJob,
      workerId: 'w'.repeat(201),
    }).success).toBe(false)
    expect(ClaimedGenerationJobSchema.safeParse({
      ...claimedJob,
      worker_id: 'worker-a',
    }).success).toBe(false)
  })

  it('keeps claim result variants strict and unmixed', () => {
    expect(GenerationJobClaimResultSchema.parse({ claimed: false })).toEqual({ claimed: false })
    expect(GenerationJobClaimResultSchema.parse({ claimed: true, job: claimedJob })).toEqual({
      claimed: true,
      job: claimedJob,
    })
    expect(GenerationJobClaimResultSchema.safeParse({
      claimed: false,
      job: claimedJob,
    }).success).toBe(false)
  })

  it('keeps lease result variants strict and unmixed', () => {
    expect(GenerationJobLeaseResultSchema.parse({ ok: true, leaseId: LEASE_ID })).toEqual({
      ok: true,
      leaseId: LEASE_ID,
    })
    expect(GenerationJobLeaseResultSchema.parse({
      ok: false,
      reason: 'OWNERSHIP_LOST',
    })).toEqual({ ok: false, reason: 'OWNERSHIP_LOST' })
    expect(GenerationJobLeaseResultSchema.safeParse({
      ok: true,
      leaseId: LEASE_ID,
      reason: 'LEASE_HELD',
    }).success).toBe(false)
    expect(GenerationJobLeaseResultSchema.safeParse({
      ok: false,
      reason: 'LEASE_HELD',
      leaseId: LEASE_ID,
    }).success).toBe(false)
  })

  it('keeps heartbeat result variants strict and unmixed', () => {
    expect(GenerationJobHeartbeatResultSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(GenerationJobHeartbeatResultSchema.parse({
      ok: false,
      reason: 'OWNERSHIP_LOST',
    })).toEqual({ ok: false, reason: 'OWNERSHIP_LOST' })
    expect(GenerationJobHeartbeatResultSchema.safeParse({
      ok: true,
      reason: 'OWNERSHIP_LOST',
    }).success).toBe(false)
    expect(GenerationJobHeartbeatResultSchema.safeParse({
      ok: false,
      reason: 'LEASE_HELD',
    }).success).toBe(false)
  })

  it('accepts only finish RPC outcomes', () => {
    expect(GenerationJobFinishOutcomeSchema.options).toEqual([
      'RETRY_WAIT',
      'FAILED',
      'CANCELLED',
    ])
    expect(GenerationJobFinishOutcomeSchema.safeParse('SUCCEEDED').success).toBe(false)
  })

  it('accepts only strict nonnegative recovery aggregates', () => {
    expect(GenerationJobRecoveryResultSchema.parse({ recoveredCount: 0 })).toEqual({
      recoveredCount: 0,
    })
    expect(GenerationJobRecoveryResultSchema.safeParse({ recoveredCount: -1 }).success).toBe(false)
    expect(GenerationJobRecoveryResultSchema.safeParse({ recoveredCount: 1.5 }).success).toBe(false)
    expect(GenerationJobRecoveryResultSchema.safeParse({
      recoveredCount: 1,
      recovered_count: 1,
    }).success).toBe(false)
  })

  it('requires strict fenced publication ownership identity', () => {
    const identity = {
      jobId: JOB_ID,
      workerId: 'worker-a',
      claimToken: CLAIM_TOKEN,
      leaseId: LEASE_ID,
    }
    expect(FencedPublicationIdentitySchema.parse(identity)).toEqual(identity)
    expect(FencedPublicationIdentitySchema.safeParse({
      ...identity,
      storyId: 'story-a',
    }).success).toBe(false)
    expect(FencedPublicationIdentitySchema.safeParse({
      job_id: JOB_ID,
      worker_id: 'worker-a',
      claim_token: CLAIM_TOKEN,
      lease_id: LEASE_ID,
    }).success).toBe(false)
  })
})
