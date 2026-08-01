import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  queryStoryForUser: vi.fn(),
  getGenerationProgress: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/runtime/generation-concurrency', () => ({
  getGenerationProgress: mocks.getGenerationProgress,
}))
vi.mock('@/lib/api/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/queries')>('@/lib/api/queries')
  return {
    ...actual,
    queryStoryForUser: mocks.queryStoryForUser,
  }
})

type DbResult = { data: unknown; error: { message: string; code?: string } | null }
type Call = { table?: string; method: string; args: unknown[]; filters: Array<[string, unknown]> }

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const STORY_A = 'ai:status-story-a'
const REQUEST_IDENTITY = {
  attemptId: '55555555-5555-4555-8555-555555555555',
  correlationId: '66666666-6666-4666-8666-666666666666',
} as const

function createCookieDb(input?: {
  user?: { id: string } | null
  userError?: { message: string } | null
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: input?.user === undefined ? { id: USER_A } : input.user },
        error: input?.userError ?? null,
      })),
    },
  }
}

function createAdminDb(input: {
  chapter?: DbResult
  leases?: DbResult
  events?: DbResult
  checkpoint?: DbResult
  jobs?: DbResult
}) {
  const calls: Call[] = []
  const client = {
    from: vi.fn((table: string) => {
      const filters: Array<[string, unknown]> = []
      const builder: Record<string, unknown> = {}
      const chain = (...methods: string[]) => {
        for (const method of methods) {
          builder[method] = vi.fn((...args: unknown[]) => {
            if (method === 'eq' || method === 'gt' || method === 'order' || method === 'limit' || method === 'in') {
              filters.push([method, args])
            }
            calls.push({ table, method, args, filters: [...filters] })
            return builder
          })
        }
      }
      chain('select', 'eq', 'gt', 'order', 'limit', 'in')
      builder.maybeSingle = vi.fn(async () => {
        calls.push({ table, method: 'maybeSingle', args: [], filters: [...filters] })
        if (table === 'chapters') return input.chapter ?? { data: null, error: null }
        if (table === 'generation_leases') return input.leases ?? { data: null, error: null }
        if (table === 'generation_jobs') return input.jobs ?? { data: null, error: null }
        if (table === 'chapter_generation_checkpoints') {
          return input.checkpoint ?? { data: null, error: null }
        }
        return { data: null, error: null }
      })
      // list path for events
      builder.then = (
        onfulfilled?: (value: DbResult) => unknown,
        onrejected?: (reason: unknown) => unknown,
      ) => {
        const run = async (): Promise<DbResult> => {
          if (table === 'story_events') return input.events ?? { data: [], error: null }
          if (table === 'generation_leases') return input.leases ?? { data: null, error: null }
          if (table === 'chapters') return input.chapter ?? { data: null, error: null }
          if (table === 'generation_jobs') {
            const jobs = input.jobs ?? { data: null, error: null }
            return {
              data: jobs.data == null ? [] : Array.isArray(jobs.data) ? jobs.data : [jobs.data],
              error: jobs.error,
            }
          }
          if (table === 'chapter_generation_checkpoints') {
            const checkpoints = input.checkpoint ?? { data: null, error: null }
            return {
              data: checkpoints.data == null
                ? []
                : Array.isArray(checkpoints.data) ? checkpoints.data : [checkpoints.data],
              error: checkpoints.error,
            }
          }
          return { data: null, error: null }
        }
        return run().then(onfulfilled, onrejected)
      }
      return builder
    }),
  }
  return { client, calls }
}

function request(storyId = STORY_A, chapterNumber = 2) {
  return new Request(
    `http://localhost/api/stories/${encodeURIComponent(storyId)}/chapters/${chapterNumber}/status`,
    { method: 'GET' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.cookieFactory.mockResolvedValue(createCookieDb())
  mocks.getGenerationProgress.mockReturnValue(null)
  mocks.queryStoryForUser.mockResolvedValue({
    id: STORY_A,
    title: 'Status Story',
    totalChapters: 50,
  })
  mocks.adminFactory.mockReturnValue(createAdminDb({}).client)
})

describe('getChapterStatusForUser', () => {
  it('returns ready when chapter exists and never queries stories.generation_status', async () => {
    const fixture = createAdminDb({
      chapter: { data: { story_id: STORY_A, number: 2 }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'ready' }))

    expect(mocks.queryStoryForUser).toHaveBeenCalledWith(STORY_A, USER_A)
    const tables = fixture.calls.map((call) => call.table)
    expect(tables).toContain('chapters')
    expect(tables).not.toContain('stories')
    expect(JSON.stringify(fixture.calls)).not.toContain('generation_status')
  })

  it('returns generating for exact active unexpired lease when chapter missing', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: {
        data: {
          id: 'lease-1',
          story_id: STORY_A,
          chapter_number: 2,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'generating' }))
  })

  it('ignores stale or other-chapter leases and falls through to latest failed attempt', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: {
        data: [
          {
            seq: 9,
            type: 'GENERATION_ATTEMPT',
            payload: {
              chapter_number: 2,
              outcome: 'REVIEW_REQUIRED',
            },
            created_at: '2026-07-15T01:00:00.000Z',
          },
        ],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'failed' }))
  })

  it('prefers active lease over older failed attempt', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: {
        data: {
          id: 'lease-active',
          story_id: STORY_A,
          chapter_number: 3,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + 30_000).toISOString(),
        },
        error: null,
      },
      events: {
        data: [
          {
            seq: 4,
            type: 'GENERATION_ATTEMPT',
            payload: { chapter_number: 3, outcome: 'REVIEW_REQUIRED' },
            created_at: '2026-07-15T00:00:00.000Z',
          },
        ],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 3,
    })).resolves.toEqual(expect.objectContaining({ status: 'generating' }))
  })

  it('returns failed when no chapter, no live lease, and no exact failure (dead generation)', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: { data: [], error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 4,
    })).resolves.toEqual(expect.objectContaining({ status: 'failed' }))
  })

  it('returns failed when PROSE_READY checkpoint exists without live evidence', async () => {
    const attemptId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: {
        data: [
          {
            seq: 9,
            type: 'GENERATION_ATTEMPT',
            payload: {
              chapter_number: 2,
              outcome: 'REVIEW_REQUIRED',
              correlation_id: attemptId,
            },
            created_at: '2026-07-15T01:00:00.000Z',
          },
        ],
        error: null,
      },
      checkpoint: {
        data: {
          story_id: STORY_A,
          chapter_number: 2,
          attempt_id: attemptId,
          correlation_id: attemptId,
          // PROSE_READY (durable prose) beats stale REVIEW_REQUIRED regardless of
          // active job. (CHOICES_RETRY_WAIT-with-no-job is covered by P1-3 tests.)
          status: 'PROSE_READY',
          title: 'Surat',
          paragraphs_json: ['Paragraf satu.', 'Paragraf dua.'],
          prose_fingerprint: 'abc123abc123abc123abc123abc123ab',
          canon_version: null,
          blueprint_version: null,
          direction_fingerprint: null,
          prose_attempt_count: 1,
          choice_attempt_count: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(
      getChapterStatusForUser({
        userId: USER_A,
        storyId: STORY_A,
        chapterNumber: 2,
      }),
    ).resolves.toEqual({ status: 'failed', chapterNumber: 2 })
  })

  it('denies private story for non-owner and anon before lease/event reads', async () => {
    mocks.queryStoryForUser.mockResolvedValue(null)
    const fixture = createAdminDb({})
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser, ChapterStatusError } = await import(
      '@/lib/api/chapter-status.server'
    )

    await expect(getChapterStatusForUser({
      userId: USER_B,
      storyId: STORY_A,
      chapterNumber: 2,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getChapterStatusForUser({
      userId: null,
      storyId: STORY_A,
      chapterNumber: 2,
    })).rejects.toBeInstanceOf(ChapterStatusError)

    expect(fixture.calls.some((call) => call.table === 'generation_leases')).toBe(false)
    expect(fixture.calls.some((call) => call.table === 'story_events')).toBe(false)
  })

  it('ignores failed attempts for different chapters and published outcomes', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: {
        data: [
          {
            seq: 1,
            type: 'GENERATION_ATTEMPT',
            payload: { chapter_number: 1, outcome: 'REVIEW_REQUIRED' },
            created_at: '2026-07-15T00:00:00.000Z',
          },
          {
            seq: 2,
            type: 'GENERATION_ATTEMPT',
            payload: { chapter_number: 2, outcome: 'PUBLISHED' },
            created_at: '2026-07-15T00:01:00.000Z',
          },
        ],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'failed' }))
  })

  // ---- P1-3: durable job-aware status semantics ----

  it('P1-3: RUNNING job → generating (writing)', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      jobs: { data: { status: 'RUNNING', available_at: null }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')
    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'generating' }))
  })

  it('P1-3: RETRY_WAIT with future available_at still counts as queued (retry scheduled)', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      jobs: {
        data: {
          status: 'RETRY_WAIT',
          available_at: new Date(Date.now() + 120_000).toISOString(),
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')
    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'queued' }))
  })

  it.each([
    ['PROSE_READY', 'RUNNING', 'generating'],
    ['RUNNING_CHOICES', 'RUNNING', 'generating'],
    ['PROSE_READY', 'QUEUED', 'queued'],
    ['CHOICES_RETRY_WAIT', 'RETRY_WAIT', 'queued'],
  ])(
    'uses reusable %s checkpoint to refine live %s job while preserving %s status',
    async (checkpointStatus, jobStatus, expectedStatus) => {
      const attemptId = '33333333-3333-4333-8333-333333333333'
      const fixture = createAdminDb({
        chapter: { data: null, error: null },
        leases: { data: null, error: null },
        jobs: {
          data: {
            status: jobStatus,
            available_at: jobStatus === 'RETRY_WAIT'
              ? new Date(Date.now() + 120_000).toISOString()
              : null,
          },
          error: null,
        },
        checkpoint: {
          data: {
            story_id: STORY_A,
            chapter_number: 2,
            attempt_id: attemptId,
            correlation_id: attemptId,
            status: checkpointStatus,
            title: 'T',
            paragraphs_json: ['p1'],
            prose_fingerprint: 'fp',
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            updated_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
          error: null,
        },
      })
      mocks.adminFactory.mockReturnValue(fixture.client)
      const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

      await expect(getChapterStatusForUser({
        userId: USER_A,
        storyId: STORY_A,
        chapterNumber: 2,
      })).resolves.toEqual({
        status: expectedStatus,
        chapterNumber: 2,
        progressPhase: 'preparing_choices',
      })
    },
  )

  it('P1-3: CHOICES_RETRY_WAIT checkpoint with NO active job → failed (stalled retry)', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      jobs: { data: null, error: null },
      checkpoint: {
        data: {
          story_id: STORY_A,
          chapter_number: 2,
          attempt_id: '33333333-3333-4333-8333-333333333333',
          correlation_id: '44444444-4444-4444-8444-444444444444',
          status: 'CHOICES_RETRY_WAIT',
          title: 'T',
          paragraphs_json: ['p1'],
          prose_fingerprint: 'fp',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')
    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: 'failed' }))
  })

  it('P1-3: PROSE_READY checkpoint alone is resumability, not liveness', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      jobs: { data: null, error: null },
      checkpoint: {
        data: {
          story_id: STORY_A,
          chapter_number: 2,
          attempt_id: '33333333-3333-4333-8333-333333333333',
          correlation_id: '44444444-4444-4444-8444-444444444444',
          status: 'PROSE_READY',
          title: 'T',
          paragraphs_json: ['p1'],
          prose_fingerprint: 'fp',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')
    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual({ status: 'failed', chapterNumber: 2 })
  })

  it.each([
    ['attempt match plus correlation mismatch', {
      attempt_id: REQUEST_IDENTITY.attemptId,
      correlation_id: '77777777-7777-4777-8777-777777777777',
    }],
    ['correlation match plus attempt mismatch', {
      attempt_id: '77777777-7777-4777-8777-777777777777',
      correlation_id: REQUEST_IDENTITY.correlationId,
    }],
    ['identity-less terminal', {}],
  ])('ignores %s for identity-bound terminal evidence', async (_label, eventIdentity) => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      jobs: { data: null, error: null },
      events: {
        data: [{
          seq: 10,
          type: 'GENERATION_ATTEMPT',
          payload: {
            chapter_number: 2,
            outcome: 'REVIEW_REQUIRED',
            ...eventIdentity,
          },
          created_at: '2026-07-31T00:00:00.000Z',
        }],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
      identity: REQUEST_IDENTITY,
    })).resolves.toEqual({
      status: 'failed',
      chapterNumber: 2,
      ...REQUEST_IDENTITY,
    })
  })

  it('keeps active identity-less lease as chapter-scoped liveness and echoes request identity', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: { id: 'lease-active' }, error: null },
      events: { data: [], error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
      identity: REQUEST_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      status: 'generating',
      chapterNumber: 2,
      ...REQUEST_IDENTITY,
    }))
  })

  it('preserves no-identity terminal compatibility', async () => {
    const fixture = createAdminDb({
      chapter: { data: null, error: null },
      leases: { data: null, error: null },
      events: {
        data: [{
          seq: 10,
          type: 'GENERATION_ATTEMPT',
          payload: { chapter_number: 2, outcome: 'REVIEW_REQUIRED' },
          created_at: '2026-07-31T00:00:00.000Z',
        }],
        error: null,
      },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual({ status: 'failed', chapterNumber: 2 })
  })

  it.each([
    ['queued durable job beats active lease', 'QUEUED', { phase: 'active' }, { id: 'lease' }, 'queued'],
    ['retry durable job beats active process slot', 'RETRY_WAIT', { phase: 'active' }, null, 'queued'],
    ['running durable job beats local queued slot', 'RUNNING', { phase: 'queued' }, null, 'generating'],
  ])('%s', async (_label, jobStatus, localProgress, lease, expectedStatus) => {
    mocks.getGenerationProgress.mockReturnValue({
      ...localProgress,
      queuePosition: localProgress.phase === 'queued' ? 1 : null,
      estimatedWaitSeconds: 10,
      active: 1,
      queued: 1,
      maxConcurrent: 1,
      estimateSource: 'fallback',
    })
    const fixture = createAdminDb({
      jobs: { data: { status: jobStatus }, error: null },
      leases: { data: lease, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({ status: expectedStatus }))
  })

  it.each([
    ['lease', { data: { id: 'lease' }, error: null }, null],
    ['local slot', { data: null, error: null }, {
      phase: 'active', queuePosition: null, estimatedWaitSeconds: 10,
      active: 1, queued: 0, maxConcurrent: 1, estimateSource: 'fallback',
    }],
  ])('checkpoint plus active %s refines generating phase', async (_label, leases, localProgress) => {
    mocks.getGenerationProgress.mockReturnValue(localProgress)
    const fixture = createAdminDb({
      leases,
      checkpoint: { data: { status: 'PROSE_READY' }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A, storyId: STORY_A, chapterNumber: 2,
    })).resolves.toEqual(expect.objectContaining({
      status: 'generating', progressPhase: 'preparing_choices',
    }))
  })

  it.each([
    ['attempt match with correlation mismatch', {
      id: REQUEST_IDENTITY.attemptId,
      correlation_id: '77777777-7777-4777-8777-777777777777',
    }],
    ['correlation match with attempt mismatch', {
      id: '77777777-7777-4777-8777-777777777777',
      correlation_id: REQUEST_IDENTITY.correlationId,
    }],
  ])('ignores durable job %s', async (_label, jobIdentity) => {
    const fixture = createAdminDb({
      jobs: { data: { status: 'RUNNING', ...jobIdentity }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A, storyId: STORY_A, chapterNumber: 2, identity: REQUEST_IDENTITY,
    })).resolves.toEqual({ status: 'failed', chapterNumber: 2, ...REQUEST_IDENTITY })
  })

  it.each([
    ['exact worker pair', REQUEST_IDENTITY, {
      id: REQUEST_IDENTITY.attemptId,
      correlation_id: REQUEST_IDENTITY.correlationId,
    }],
    ['legacy null attempt correlation-only', {
      attemptId: null,
      correlationId: REQUEST_IDENTITY.correlationId,
    }, {
      id: '77777777-7777-4777-8777-777777777777',
      correlation_id: REQUEST_IDENTITY.correlationId,
    }],
  ])('accepts %s durable RUNNING job', async (_label, identity, jobIdentity) => {
    const fixture = createAdminDb({
      jobs: { data: { status: 'RUNNING', ...jobIdentity }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A, storyId: STORY_A, chapterNumber: 2, identity,
    })).resolves.toEqual(expect.objectContaining({ status: 'generating' }))
  })

  it('finds identity match among five candidates and selects no nonexistent attempt_id', async () => {
    const fixture = createAdminDb({
      jobs: { data: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', correlation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'RUNNING' },
        { id: REQUEST_IDENTITY.attemptId, correlation_id: REQUEST_IDENTITY.correlationId, status: 'RUNNING' },
      ], error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A, storyId: STORY_A, chapterNumber: 2, identity: REQUEST_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({ status: 'generating' }))
    const jobSelect = fixture.calls.find((call) => call.table === 'generation_jobs' && call.method === 'select')
    expect(jobSelect?.args[0]).toBe('status, available_at, id, correlation_id')
    expect(fixture.calls).toContainEqual(expect.objectContaining({
      table: 'generation_jobs', method: 'limit', args: [5],
    }))
  })

  it.each([
    ['ready', { chapter: { data: { number: 2 }, error: null } }],
    ['queued', { jobs: { data: {
      id: REQUEST_IDENTITY.attemptId,
      correlation_id: REQUEST_IDENTITY.correlationId,
      status: 'QUEUED',
      available_at: null,
    }, error: null } }],
  ])('echoes requested identity for %s', async (expectedStatus, dbInput) => {
    const fixture = createAdminDb(dbInput)
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')

    await expect(getChapterStatusForUser({
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 2,
      identity: REQUEST_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      status: expectedStatus,
      ...REQUEST_IDENTITY,
    }))
  })
})

describe('GET /api/stories/[id]/chapters/[number]/status', () => {
  it('returns 400 for invalid chapter number', async () => {
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(STORY_A, 0), {
      params: Promise.resolve({ id: STORY_A, number: '0' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Nomor bab tidak valid.' })
  })

  it('returns 401 when session missing for private status', async () => {
    mocks.cookieFactory.mockResolvedValue(createCookieDb({ user: null }))
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Tidak diizinkan.' })
  })

  it('returns 404 for non-owner private story', async () => {
    mocks.queryStoryForUser.mockResolvedValue(null)
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Cerita tidak ditemukan.' })
  })

  it('forwards valid identity query and returns identity-bound response', async () => {
    const fixture = createAdminDb({
      jobs: { data: {
        id: REQUEST_IDENTITY.attemptId,
        correlation_id: REQUEST_IDENTITY.correlationId,
        status: 'QUEUED',
      }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/status/route')
    const url = `${request().url}?attemptId=${REQUEST_IDENTITY.attemptId}&correlationId=${REQUEST_IDENTITY.correlationId}`
    const response = await GET(new Request(url), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'queued', chapterNumber: 2, ...REQUEST_IDENTITY,
    })
  })

  it.each([
    ['invalid identity', '?correlationId=not-a-uuid'],
    ['partial worker identity', `?attemptId=${REQUEST_IDENTITY.attemptId}`],
  ])('returns 400 for %s query', async (_label, query) => {
    const { GET } = await import('@/app/api/stories/[id]/chapters/[number]/status/route')
    const response = await GET(new Request(`${request().url}${query}`), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Identitas generasi tidak valid.' })
  })

  it('returns reader-safe ready payload only', async () => {
    const fixture = createAdminDb({
      chapter: { data: { story_id: STORY_A, number: 2 }, error: null },
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { GET } = await import(
      '@/app/api/stories/[id]/chapters/[number]/status/route'
    )
    const response = await GET(request(), {
      params: Promise.resolve({ id: STORY_A, number: '2' }),
    })
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ status: 'ready', chapterNumber: 2 })
    expect(json).not.toHaveProperty('lease')
    expect(json).not.toHaveProperty('generation_status')
    expect(json).not.toHaveProperty('payload')
    expect(json).not.toHaveProperty('owner')
  })
})
