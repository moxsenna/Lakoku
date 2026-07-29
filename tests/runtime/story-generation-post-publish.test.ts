import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadCanonSnapshot: vi.fn(),
  persistRetrievalLog: vi.fn(),
  generateChapter: vi.fn(),
  buildChoiceBranch: vi.fn(),
  loadCheckpoint: vi.fn(),
  persistCheckpoint: vi.fn(),
  markCheckpointStatus: vi.fn(),
  publishGenerationJobChapterV4: vi.fn(),
  recordGenerationAttempt: vi.fn(),
  recordGenerationRuntimeFailed: vi.fn(),
  consoleLog: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/runtime/generation-concurrency', () => ({
  withGenerationSlot: async (_key: unknown, work: (input: { waitMs: number }) => unknown) =>
    work({ waitMs: 0 }),
}))
vi.mock('@lakoku/narrative-core', async () => import('@/lib/narrative/index'))
vi.mock('@lakoku/narrative-core/server', () => ({
  loadCanonSnapshot: mocks.loadCanonSnapshot,
  persistRetrievalLog: mocks.persistRetrievalLog,
}))
vi.mock('@lakoku/ai-gateway', () => ({
  generateChapter: mocks.generateChapter,
  generateChoiceBranch: vi.fn(),
  toReaderSafe: (value: unknown) => value,
  assertConsumerSafe: vi.fn(),
  scanForLeaks: vi.fn(() => []),
}))
vi.mock('@lakoku/ai-gateway/server', () => ({
  selectProvider: vi.fn(async () => ({ id: 'provider-test' })),
}))
vi.mock('@/lib/runtime/choice-generation', async () => {
  const actual = await import('@/lib/runtime/choice-generation')
  return {
    ...actual,
    buildChoiceBranch: mocks.buildChoiceBranch,
  }
})
vi.mock('@/lib/runtime/chapter-generation-checkpoint', async () => {
  const pure = await import('@/lib/runtime/chapter-generation-checkpoint.pure')
  return {
    ...pure,
    loadUsableProseCheckpoint: mocks.loadCheckpoint,
    persistProseReadyCheckpoint: mocks.persistCheckpoint,
    markCheckpointStatus: mocks.markCheckpointStatus,
  }
})
vi.mock('@/lib/runtime/generation-jobs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/runtime/generation-jobs')>(
    '@/lib/runtime/generation-jobs',
  )
  return {
    ...actual,
    publishGenerationJobChapterV4: mocks.publishGenerationJobChapterV4,
  }
})
vi.mock('@/lib/observability/server', () => ({
  recordGenerationAttempt: mocks.recordGenerationAttempt,
  recordGenerationRuntimeFailed: mocks.recordGenerationRuntimeFailed,
}))
vi.mock('@/lib/authoring/persist-creative-direction', () => ({
  loadStoryCreativeDirection: vi.fn(async () => null),
}))
vi.mock('@/lib/feature-flags', () => ({
  isStoryCreativeDirectionV1Enabled: vi.fn(() => false),
}))
vi.mock('@lakoku/db', () => ({
  createAdminClient: () => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    return { from: vi.fn(() => chain) }
  },
}))
vi.mock('@/lib/runtime/content-boundaries', async () => {
  const actual = await import('@/lib/runtime/content-boundaries')
  return {
    ...actual,
    validateContentBoundaries: vi.fn(() => []),
  }
})

const JOB_CONTEXT = {
  jobId: '11111111-1111-4111-8111-111111111111',
  workerId: 'worker-test',
  claimToken: '22222222-2222-4222-8222-222222222222',
  leaseId: '33333333-3333-4333-8333-333333333333',
  attemptNumber: 1,
  correlationId: '44444444-4444-4444-8444-444444444444',
  generationKind: 'standard' as const,
  signal: new AbortController().signal,
}

function draft(chapterNumber: number) {
  return {
    storyId: 'story-test',
    chapterNumber,
    title: `Bab ${chapterNumber}`,
    paragraphs: ['Maya membuka pintu dan menemukan surat lama.'],
    wordCount: 9,
    sceneCount: 1,
    hasChoiceOrGate: chapterNumber < 50,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
}

async function run(chapterNumber: number) {
  const { buildFixtureSnapshot } = await import('@/fixtures/narrative/fixture-50')
  const snapshot = buildFixtureSnapshot()
  mocks.loadCanonSnapshot.mockResolvedValue(snapshot)
  mocks.generateChapter.mockResolvedValue({
    status: 'PUBLISHED',
    draft: draft(chapterNumber),
    attempts: 1,
    findings: [],
  })

  return (await import('@/lib/runtime/story-generation')).generateNextChapterReal({
    storyId: snapshot.storyId,
    userId: '55555555-5555-4555-8555-555555555555',
    chapterNumber,
    correlationId: JOB_CONTEXT.correlationId,
    attemptId: JOB_CONTEXT.jobId,
    jobContext: JOB_CONTEXT,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadCheckpoint.mockResolvedValue(null)
  mocks.persistCheckpoint.mockResolvedValue({ ok: true, result: 'UPDATED', changed: true })
  mocks.markCheckpointStatus.mockResolvedValue({ ok: true, result: 'UPDATED', changed: true })
  mocks.publishGenerationJobChapterV4.mockImplementation(async (input: { chapterNumber: number }) => ({
    jobId: JOB_CONTEXT.jobId,
    chapterNumber: input.chapterNumber,
    seq: 17,
  }))
  mocks.persistRetrievalLog.mockResolvedValue(undefined)
  mocks.recordGenerationAttempt.mockResolvedValue(undefined)
  mocks.recordGenerationRuntimeFailed.mockResolvedValue(undefined)
  mocks.buildChoiceBranch.mockImplementation(async (_deps: unknown, input: { chapterNumber: number }) => {
    if (input.chapterNumber === 50) {
      return {
        ok: false,
        reason: 'FINAL_CHAPTER',
        validationFindings: [],
        repairAttempts: 0,
      }
    }
    return {
      ok: true,
      source: 'INITIAL',
      repairAttempts: 0,
      branch: {
        choicePrompt: 'Apa yang Maya lakukan?',
        choices: [
          { id: 'baca', label: 'Baca surat' },
          { id: 'simpan', label: 'Simpan surat' },
        ],
        outcomes: [
          {
            choiceId: 'baca',
            consequence: ['Maya membaca surat.'],
            nextChapterNumber: input.chapterNumber + 1,
            isEnding: false,
            effect: {},
          },
          {
            choiceId: 'simpan',
            consequence: ['Maya menyimpan surat.'],
            nextChapterNumber: input.chapterNumber + 1,
            isEnding: false,
            effect: {},
          },
        ],
      },
    }
  })
  vi.spyOn(console, 'log').mockImplementation(mocks.consoleLog)
})

describe('standard worker V4 publication', () => {
  it.each([12, 50])(
    'publishes chapter %i through V4 exactly once with empty closures and no post-publish checkpoint write',
    async (chapterNumber) => {
      await expect(run(chapterNumber)).resolves.toMatchObject({
        ok: true,
        chapterNumber,
        seq: 17,
      })
      expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledTimes(1)
      expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledWith(
        expect.objectContaining({ closures: [] }),
      )
      expect(mocks.markCheckpointStatus).toHaveBeenCalledTimes(1)
      expect(mocks.markCheckpointStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'RUNNING_CHOICES' }),
      )
    },
  )

  it('returns structured choice failure, preserves retry checkpoint, and never publishes generic choices', async () => {
    mocks.buildChoiceBranch.mockResolvedValueOnce({
      ok: false,
      reason: 'REPAIR_EXHAUSTED',
      validationFindings: [{
        code: 'NULL_BRANCH',
        message: 'Choice provider returned no branch',
        severity: 'ERROR',
      }],
      repairAttempts: 1,
    })

    await expect(run(12)).resolves.toEqual({
      ok: false,
      reason: 'CHOICE_GENERATION_FAILED',
      detail: expect.objectContaining({
        choiceReason: 'REPAIR_EXHAUSTED',
        findingCodes: ['NULL_BRANCH'],
        repairAttempts: 1,
        fromCheckpoint: false,
      }),
    })
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()
    expect(mocks.markCheckpointStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'CHOICES_RETRY_WAIT' }),
    )
  })

  it('does not expose production generic choice fallback', async () => {
    const storyGeneration = await import('@/lib/runtime/story-generation')
    const choiceGeneration = await import('@/lib/runtime/choice-generation')

    expect(Object.keys(storyGeneration)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('FallbackChoices')]),
    )
    expect(Object.keys(choiceGeneration)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('FallbackChoices')]),
    )
  })

  it.each([
    ['CHAPTER_EXISTS', 'CHAPTER_EXISTS'],
    ['GENERATION_JOB_OWNERSHIP_LOST', 'LEASE_HELD'],
    ['IDEMPOTENCY_CONFLICT', 'FAILED_REVIEW_REQUIRED'],
    ['PROVENANCE_CONFLICT', 'FAILED_REVIEW_REQUIRED'],
    ['CHECKPOINT_CONFLICT', 'FAILED_REVIEW_REQUIRED'],
    ['CONTRACT_CONFLICT', 'FAILED_REVIEW_REQUIRED'],
    ['PLOT_DEBT_CONFLICT', 'FAILED_REVIEW_REQUIRED'],
    ['INTERNAL_ERROR', 'TRANSIENT'],
  ] as const)('classifies typed V4 %s as %s', async (code, reason) => {
    const { GenerationJobError } = await import('@/lib/runtime/generation-jobs')
    mocks.publishGenerationJobChapterV4.mockRejectedValueOnce(new GenerationJobError(code))

    await expect(run(12)).resolves.toMatchObject({ ok: false, reason })
  })

  it('does not classify untyped message substrings as V4 outcomes', async () => {
    mocks.publishGenerationJobChapterV4.mockRejectedValueOnce(new Error('CHAPTER_EXISTS'))

    await expect(run(12)).resolves.toMatchObject({
      ok: false,
      reason: 'TRANSIENT',
    })
  })

  it('does not log raw publication error secret sentinel', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.publishGenerationJobChapterV4.mockRejectedValueOnce(new Error('network secret sentinel'))

    await expect(run(12)).resolves.toMatchObject({ ok: false, reason: 'TRANSIENT' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('network secret sentinel')
  })

  it('provider ignoring abort cannot persist checkpoint, choices, or publish', async () => {
    const controller = new AbortController()
    let resolveProse: ((value: unknown) => void) | undefined
    mocks.generateChapter.mockImplementationOnce(() => new Promise((resolve) => {
      resolveProse = resolve
    }))

    const { buildFixtureSnapshot } = await import('@/fixtures/narrative/fixture-50')
    const snapshot = buildFixtureSnapshot()
    mocks.loadCanonSnapshot.mockResolvedValue(snapshot)

    const runPromise = (await import('@/lib/runtime/story-generation')).generateNextChapterReal({
      storyId: snapshot.storyId,
      userId: '55555555-5555-4555-8555-555555555555',
      chapterNumber: 12,
      correlationId: JOB_CONTEXT.correlationId,
      attemptId: JOB_CONTEXT.jobId,
      jobContext: {
        ...JOB_CONTEXT,
        signal: controller.signal,
      },
    })
    await vi.waitFor(() => expect(resolveProse).toBeTypeOf('function'))

    controller.abort()
    resolveProse?.({
      status: 'PUBLISHED',
      draft: draft(12),
      attempts: 1,
      findings: [],
    })

    await expect(runPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.persistCheckpoint).not.toHaveBeenCalled()
    expect(mocks.markCheckpointStatus).not.toHaveBeenCalled()
    expect(mocks.buildChoiceBranch).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()
  })
})
