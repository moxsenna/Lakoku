import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadCanonSnapshot: vi.fn(),
  persistRetrievalLog: vi.fn(),
  generateChapter: vi.fn(),
  buildChoiceBranch: vi.fn(),
  loadCheckpoint: vi.fn(),
  persistCheckpoint: vi.fn(),
  markCheckpointStatus: vi.fn(),
  publishGenerationJobChapterV2: vi.fn(),
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
vi.mock('@/lib/runtime/generation-jobs', () => ({
  publishGenerationJobChapterV2: mocks.publishGenerationJobChapterV2,
}))
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
  mocks.publishGenerationJobChapterV2.mockImplementation(async (input: { chapterNumber: number }) => ({
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

describe('standard generation post-publish checkpoint reconciliation', () => {
  it.each([
    ['normal choice non-UPDATED', 12, { ok: false, result: 'OWNERSHIP_LOST' }],
    ['normal choice throw', 12, new Error('checkpoint transition unavailable')],
    ['final chapter non-UPDATED', 50, { ok: false, result: 'OWNERSHIP_LOST' }],
    ['final chapter throw', 50, new Error('checkpoint transition unavailable')],
  ] as const)(
    'returns committed publish success when %s PUBLISHED checkpoint transition fails',
    async (_name, chapterNumber, checkpointFailure) => {
      mocks.markCheckpointStatus
        .mockResolvedValueOnce({ ok: true, result: 'UPDATED', changed: true })
      if (checkpointFailure instanceof Error) {
        mocks.markCheckpointStatus.mockRejectedValueOnce(checkpointFailure)
      } else {
        mocks.markCheckpointStatus.mockResolvedValueOnce(checkpointFailure)
      }

      await expect(run(chapterNumber)).resolves.toMatchObject({
        ok: true,
        chapterNumber,
        seq: 17,
      })
      expect(mocks.publishGenerationJobChapterV2).toHaveBeenCalledTimes(1)
      expect(mocks.consoleLog).toHaveBeenCalledWith(
        'CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED',
        expect.objectContaining({
          storyId: expect.any(String),
          chapterNumber,
          jobId: JOB_CONTEXT.jobId,
          checkpointAttemptId: JOB_CONTEXT.jobId,
        }),
      )
    },
  )

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
    expect(mocks.publishGenerationJobChapterV2).not.toHaveBeenCalled()
  })
})
