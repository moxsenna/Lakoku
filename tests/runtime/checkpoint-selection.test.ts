import { beforeEach, describe, expect, it, vi } from 'vitest'

import { proseFingerprint } from '@/lib/runtime/chapter-generation-checkpoint.pure'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

const STORY_ID = 'story-test-123'
const CHAPTER_NUM = 5
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111'
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222'
const JOB_ID = '33333333-3333-4333-8333-333333333333'

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const future = new Date(Date.now() + 3600 * 1000).toISOString()
  const title = 'Judul Bab'
  const paragraphs = ['Paragraf pertama.']
  const fp = proseFingerprint(title, paragraphs)
  return {
    story_id: STORY_ID,
    chapter_number: CHAPTER_NUM,
    attempt_id: ATTEMPT_ID,
    correlation_id: CORRELATION_ID,
    title,
    paragraphs_json: paragraphs,
    prose_fingerprint: fp,
    status: 'PROSE_READY',
    expires_at: future,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    checkpoint_schema_version: 2,
    canon_version: 1,
    blueprint_version: 1,
    direction_fingerprint: 'dir-fp-1',
    generation_mode: 'standard',
    generation_policy_version: 1,
    prompt_contract_version: 1,
    job_id: null,
    job_attempt_number: null,
    prose_attempt_count: 1,
    choice_attempt_count: 0,
    ...overrides,
  }
}

function makeFreshness(overrides: Record<string, unknown> = {}) {
  return {
    storyId: STORY_ID,
    chapterNumber: CHAPTER_NUM,
    correlationId: CORRELATION_ID,
    canonVersion: 1,
    blueprintVersion: 1,
    directionFingerprint: 'dir-fp-1',
    generationMode: 'standard',
    generationPolicyVersion: 1,
    promptContractVersion: 1,
    requireJobProvenance: false,
    ...overrides,
  }
}

function makeJobContext(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID,
    workerId: 'worker-1',
    claimToken: 'token-1',
    leaseId: 'lease-1',
    attemptNumber: 2,
    correlationId: CORRELATION_ID,
    generationKind: 'standard' as const,
    deadlineAt: '2099-01-01T00:00:00.000Z',
    deadlineAtMs: Date.parse('2099-01-01T00:00:00.000Z'),
    signal: new AbortController().signal,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('bounded provenance-aware checkpoint selection', () => {
  it('limits query to max 5 candidates and evaluates candidates sequentially', async () => {
    let limitValue: number | null = null

    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn((n: number) => {
        limitValue = n
        return Promise.resolve({
          data: [
            makeRow({ attempt_id: 'a1', status: 'EXPIRED' }), // Expired status (unusable)
            makeRow({ attempt_id: 'a2', title: 'Judul Bab' }), // Valid
            makeRow({ attempt_id: 'a3' }),
            makeRow({ attempt_id: 'a4' }),
            makeRow({ attempt_id: 'a5' }),
            makeRow({ attempt_id: 'a6' }), // 6th candidate
          ],
          error: null,
        })
      }),
    }

    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })

    const { loadUsableProseCheckpoint, MAX_CHECKPOINT_LOOKUP_CANDIDATES } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    expect(MAX_CHECKPOINT_LOOKUP_CANDIDATES).toBe(5)

    const result = await loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness(),
    })

    expect(limitValue).toBe(5)
    expect(result).not.toBeNull()
    expect(result?.attemptId).toBe('a2')
  })

  it('rejects candidate with lower/unmatched schema version when freshness requires schema v2', async () => {
    const rows = [
      makeRow({ checkpoint_schema_version: 1 }), // Old schema v1
    ]

    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }

    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })

    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    const result = await loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness(),
    })

    expect(result).toBeNull()
  })

  it('rejects candidate with foreign worker jobId when jobContext is present', async () => {
    const rows = [
      makeRow({
        job_id: 'foreign-job-id-999',
        job_attempt_number: 1,
      }),
    ]

    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }

    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })

    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    const result = await loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness({
        requireJobProvenance: true,
        jobId: JOB_ID,
        jobAttemptNumber: 2,
      }),
      jobContext: makeJobContext({ jobId: JOB_ID }),
    })

    expect(result).toBeNull()
  })

  it('rejects future worker attempt number (job_attempt_number > jobContext.attemptNumber)', async () => {
    const rows = [
      makeRow({
        job_id: JOB_ID,
        job_attempt_number: 5, // Future attempt relative to current attempt 2
      }),
    ]

    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }

    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })

    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    const result = await loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness({
        requireJobProvenance: true,
        jobId: JOB_ID,
        jobAttemptNumber: 2,
      }),
      jobContext: makeJobContext({ jobId: JOB_ID, attemptNumber: 2 }),
    })

    expect(result).toBeNull()
  })

  it('rejects reusable candidate when freshness context is absent', async () => {
    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [makeRow()], error: null }),
    }
    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })
    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
    })).resolves.toBeNull()
  })

  it('rejects candidate whose prose fingerprint does not match content', async () => {
    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [makeRow({ prose_fingerprint: 'tampered-fingerprint' })],
        error: null,
      }),
    }
    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })
    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness(),
    })).resolves.toBeNull()
  })

  it('rejects worker candidate with matching job but null attempt provenance', async () => {
    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [makeRow({ job_id: JOB_ID, job_attempt_number: null })],
        error: null,
      }),
    }
    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })
    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness({
        requireJobProvenance: true,
        jobId: JOB_ID,
        jobAttemptNumber: 2,
      }),
      jobContext: makeJobContext(),
    })).resolves.toBeNull()
  })

  it('allows legacy correlation fallback for older correlation only when full freshness and mode match', async () => {
    const rows = [
      makeRow({
        correlation_id: 'older-correlation-999',
        generation_mode: 'standard',
        canon_version: 1,
        blueprint_version: 1,
        direction_fingerprint: 'dir-fp-1',
      }),
    ]

    const mockQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }

    mocks.adminFactory.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(mockQuery) }),
    })

    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    const result = await loadUsableProseCheckpoint({
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUM,
      freshness: makeFreshness({ correlationId: 'new-correlation-000' }),
    })

    expect(result).not.toBeNull()
    expect(result?.correlationId).toBe('older-correlation-999')
  })
})
