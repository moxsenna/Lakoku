import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import type { CanonSnapshot } from '@/lib/narrative/types'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import type { BuildChapterBriefInput, ChapterBrief, ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import type { ChoiceBranch, ChapterDraftParsed } from '@/lib/ai-gateway/schemas'
import type { GenerationProvider } from '@/lib/ai-gateway/provider'
import type { PublishChapterV2Input, PublishResult } from '@/lib/runtime/lifecycle'
import type { RealGenerateResult } from '@/lib/runtime/story-generation'
import {
  CHECKPOINT_AUDIT_SIGNALS_VERSION,
  proseFingerprint,
  verifyCheckpointFreshness,
  type ChapterGenerationCheckpoint,
  type CheckpointFreshnessContext,
  type CheckpointStatus,
} from '@/lib/runtime/chapter-generation-checkpoint.pure'
import type { CheckpointMutationResult } from '@/lib/runtime/chapter-generation-checkpoint.pure'
import { auditPlotDebts } from '@/lib/story-engine/plot-debt'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  generateNextChapterReal: vi.fn(),
  publishGenerationJobChapterV2: vi.fn(),
  publishGenerationJobChapterV3: vi.fn(),
  publishGenerationJobChapterV4: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@lakoku/narrative-core', async () => {
  const actual = await import('@/lib/narrative/index')
  return actual
})
vi.mock('@lakoku/narrative-core/server', async () => {
  const actual = await import('@/lib/narrative/server')
  return actual
})
vi.mock('@lakoku/ai-gateway', async () => {
  const actual = await import('@/lib/ai-gateway/index')
  return actual
})
vi.mock('@lakoku/ai-gateway/server', async () => {
  const actual = await import('@/lib/ai-gateway/server')
  return actual
})
vi.mock('@/lib/observability/server', () => ({
  recordGenerationAttempt: vi.fn(async () => undefined),
}))
vi.mock('@/lib/runtime/generation-jobs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/runtime/generation-jobs')>(
    '@/lib/runtime/generation-jobs',
  )
  return {
    ...actual,
    publishGenerationJobChapterV2: mocks.publishGenerationJobChapterV2,
    publishGenerationJobChapterV3: mocks.publishGenerationJobChapterV3,
    publishGenerationJobChapterV4: mocks.publishGenerationJobChapterV4,
  }
})
vi.mock('@/lib/runtime/story-generation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/runtime/story-generation')>(
    '@/lib/runtime/story-generation',
  )
  return {
    ...actual,
    generateNextChapterReal: mocks.generateNextChapterReal,
  }
})

const USER_A = '11111111-1111-4111-8111-111111111111'
const CORRELATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = '22222222-2222-4222-8222-222222222222'
const PREMIUM_TEMPLATE_ID = 'premium:rain-archive'
const PREMIUM_INSTANCE_A = 'ai:premium:rain-archive:11111111-1111-4111-8111-111111111111'
const PREMIUM_INSTANCE_B = 'ai:premium:rain-archive:22222222-2222-4222-8222-222222222222'
const STORY_A = PREMIUM_INSTANCE_A
const STORY_B = PREMIUM_INSTANCE_B

type CallName =
  | 'lease'
  | 'canon'
  | 'contract'
  | 'reader'
  | 'brief'
  | 'compile'
  | 'loadCheckpoint'
  | 'generateChapter'
  | 'persistCheckpoint'
  | 'markRunningChoices'
  | 'markChoicesRetryWait'
  | 'markPublished'
  | 'toReaderSafe'
  | 'assertConsumerSafe'
  | 'choices'
  | 'resolveEnding'
  | 'auditPlotDebts'
  | 'persistEndingLock'
  | 'publishV2'
  | 'markSelesai'
  | 'telemetry'
  | 'releaseLease'

function distinctEffect(index: number) {
  return {
    routeDeltas: { truth: index + 1 },
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
  }
}

function branchFor(chapterNumber: number): ChoiceBranch {
  const next = chapterNumber === 49 ? 50 : chapterNumber + 1
  return {
    choicePrompt: 'Apa yang Maya lakukan selanjutnya di arsip?',
    choices: [
      { id: 'open-door', label: 'Buka pintu arsip basah di depan Maya' },
      { id: 'investigate-light', label: 'Periksa lampu lorong yang berkedip' },
    ],
    outcomes: [
      {
        choiceId: 'open-door',
        consequence: ['Maya menemukan lembar basah di dalam arsip.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: distinctEffect(0),
      },
      {
        choiceId: 'investigate-light',
        consequence: ['Lampu padam dan langkah terdengar semakin dekat.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: distinctEffect(1),
      },
    ],
  }
}

type DraftAuditSignals = {
  opensNewThread?: boolean
  opensMajorMystery?: boolean
  opensNewConflict?: boolean
}

function draftFor(
  storyId: string,
  chapterNumber: number,
  signals: DraftAuditSignals = {},
): ChapterDraftParsed & DraftAuditSignals {
  return {
    storyId,
    chapterNumber,
    title: `Bab ${chapterNumber}`,
    paragraphs: [
      'Maya menahan napas di depan arsip basah.',
      'Lampu lorong berkedip di atas kepalanya.',
      'Suara langkah basah mendekat dari ujung koridor berdebu.',
      'Dia mengepal kertas hangat di tangan sambil melirik lampu lorong.',
    ],
    wordCount: 40,
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
    ...signals,
  }
}

function contractFor(storyId: string, debtsStatus: 'open' | 'progressing' | 'closed' = 'progressing'): StoryContract {
  const contract = structuredClone(misteriDramaContract)
  contract.storyId = storyId
  contract.plotDebts = contract.plotDebts.map((debt) => ({
    ...debt,
    status: debtsStatus,
  }))
  return contract
}

function snapshotFor(storyId: string): CanonSnapshot {
  const snapshot = structuredClone(buildFixtureSnapshot())
  snapshot.storyId = storyId
  for (const character of snapshot.characters) character.storyId = storyId
  for (const fact of snapshot.facts) fact.storyId = storyId
  return snapshot
}

function readerState(overrides: {
  lockedEndingKey?: string | null
  choiceHistory?: ChoiceHistoryEntry[]
} = {}) {
  return {
    user_id: USER_A,
    story_id: STORY_A,
    status: 'BERJALAN' as const,
    current_chapter: 12,
    jejak: [],
    ending_name: null,
    route_state: normalizeRouteState({
      truth: 3,
      risk: 1,
      endingBias: { 'publish-truth': 4, 'protect-witnesses': 1 },
    }),
    choice_history: overrides.choiceHistory ?? [],
    locked_ending_key: overrides.lockedEndingKey ?? null,
    updated_at: '2026-07-14T10:00:00.000Z',
  }
}

function briefStub(storyId: string, chapterNumber: number, lockedEndingKey: string | null = null): ChapterBrief {
  return {
    storyId,
    chapterNumber,
    totalChapters: 50,
    phase: 'tes',
    remainingChapters: 50 - chapterNumber,
    chapterGoal: 'Maju satu langkah.',
    mustInclude: ['Maya membuka arsip.'],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: 'truth=3',
    choiceHistorySummary: '',
    plotDebtsToProgress: ['main_mystery'],
    plotDebtsToClose: [],
    allowedNewThread: chapterNumber <= 40,
    allowedMajorNewConflict: chapterNumber <= 35,
    endingRunway: chapterNumber === 50
      ? 'final'
      : chapterNumber === 49
        ? 'emotional-resolution'
        : chapterNumber >= 46
          ? 'payoff'
          : chapterNumber === 45
            ? 'ending-lock'
            : 'expansion',
    lockedEndingKey,
    allowsChoices: chapterNumber < 50,
    finalChapter: chapterNumber === 50,
    goals: ['Maju satu langkah.'],
    routeSummary: 'truth=3',
    debtsToProgress: ['main_mystery'],
    debtsToClose: [],
    allowMajorNewConflict: chapterNumber <= 35,
    allowNewThread: chapterNumber <= 40,
    lockEnding: lockedEndingKey !== null,
    endingKey: lockedEndingKey,
    previousChoiceSummary: '',
  }
}

function makeDeps(options: {
  storyId?: string
  chapterNumber?: number
  lockedEndingKey?: string | null
  debtsStatus?: 'open' | 'progressing' | 'closed'
  publishOk?: boolean
  publishThrow?: Error
  generateStatus?: 'PUBLISHED' | 'FAILED_REVIEW_REQUIRED'
  draftSignals?: DraftAuditSignals
  closesPlotDebts?: Array<{ debtId: string; closureForm: 'RESOLVED' | 'SUBVERTED' | 'TRANSFORMED' | 'ABANDONED' }>
  useRealAudit?: boolean
  auditArtifact?: {
    opensNewThread: boolean
    opensMajorMystery: boolean
    opensNewConflict: boolean
    closesPlotDebts: Array<{ debtId: string; closureForm: 'RESOLVED' | 'SUBVERTED' | 'TRANSFORMED' | 'ABANDONED' }>
  }
  routeTruth?: number
  checkpoint?: ChapterGenerationCheckpoint | null
  rejectStaleCheckpoint?: boolean
  persistCheckpointResult?: CheckpointMutationResult
  checkpointStatusResult?: Partial<Record<CheckpointStatus, CheckpointMutationResult>>
  choiceFailure?: boolean
  choiceResults?: Array<ChoiceBranch | null>
  checkpointState?: { current: ChapterGenerationCheckpoint | null }
  capture?: {
    publishInputs: PublishChapterV2Input[]
    calls: CallName[]
    choiceCalls: number
    markCalls: Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>
    lockCalls: Array<{ userId: string; storyId: string; endingKey: string; endingName: string }>
    auditInputs: Array<Record<string, unknown>>
    storyIdsSeen: string[]
  }
}) {
  const storyId = options.storyId ?? STORY_A
  const chapterNumber = options.chapterNumber ?? 12
  // Use explicit null when provided; only default when option omitted.
  const lockedEndingKey = options.lockedEndingKey !== undefined
    ? options.lockedEndingKey
    : (chapterNumber >= 45 ? 'publish-truth' : null)
  const capture = options.capture ?? {
    publishInputs: [],
    calls: [],
    choiceCalls: 0,
    markCalls: [],
    lockCalls: [],
    auditInputs: [],
    storyIdsSeen: [],
  }
  const draft = draftFor(storyId, chapterNumber, options.draftSignals)
  draft.closesPlotDebts = options.closesPlotDebts ?? []
  const checkpointState = options.checkpointState ?? { current: options.checkpoint ?? null }
  let choiceResultIndex = 0
  const contractTitleByStory = new Map<string, string>()
  const routeTruthByStory = new Map<string, number>()
  const provider: GenerationProvider = {
    name: 'test-provider',
    generatePlan: async () => ({}),
    writeChapter: async () => ({}),
    generateChoices: async () => branchFor(chapterNumber),
  }

  const push = (name: CallName) => {
    capture.calls.push(name)
  }

  const deps = {
    acquireGenerationLease: vi.fn(async (args: { storyId: string; chapterNumber: number }) => {
      push('lease')
      capture.storyIdsSeen.push(args.storyId)
      return { ok: true as const, lease_id: `lease-${args.storyId}-${args.chapterNumber}`, chapter_number: args.chapterNumber }
    }),
    releaseGenerationLease: vi.fn(async () => {
      push('releaseLease')
    }),
    loadCanonSnapshot: vi.fn(async (id: string) => {
      push('canon')
      capture.storyIdsSeen.push(id)
      return snapshotFor(id)
    }),
    loadStoryGenerationContract: vi.fn(async (id: string) => {
      push('contract')
      capture.storyIdsSeen.push(id)
      return contractFor(id, options.debtsStatus ?? (chapterNumber >= 48 ? 'closed' : 'progressing'))
    }),
    loadReaderStateInternal: vi.fn(async (userId: string, id: string) => {
      push('reader')
      capture.storyIdsSeen.push(id)
      return {
        ...readerState({ lockedEndingKey }),
        user_id: userId,
        story_id: id,
        route_state: normalizeRouteState({
          truth: options.routeTruth ?? 3,
          risk: id === STORY_A ? 1 : 7,
          endingBias: id === STORY_A
            ? { 'publish-truth': 4 }
            : { 'protect-witnesses': 6 },
        }),
      }
    }),
    buildChapterBrief: vi.fn((input: BuildChapterBriefInput) => {
      push('brief')
      const inputStoryId = input.storyContract.storyId
      const routeState = normalizeRouteState(input.readerState.routeState)
      contractTitleByStory.set(inputStoryId, input.storyContract.title)
      routeTruthByStory.set(inputStoryId, routeState.truth)
      return briefStub(inputStoryId, chapterNumber, lockedEndingKey)
    }),
    compileContext: vi.fn(() => {
      push('compile')
      return {
        contextVersion: 1,
        storyId,
        targetChapterNo: chapterNumber,
        phase: 'tes',
        storyContractSummary: {},
        chapterGoal: 'goal',
        mandatoryBeats: [],
        forbiddenReveals: [],
        currentState: { activeThreads: [] },
        loadBearingFacts: [],
        relevantFacts: [],
        actRollups: [],
        voiceSheets: [],
        contextBudgetReport: {
          totalBudget: 4000,
          used: 0,
          perSection: {},
        },
        styleContractRef: 'lakoku_mobile_drama_v1',
        includedIds: [],
        excludedIds: [],
      }
    }),
    persistRetrievalLog: vi.fn(async () => undefined),
    selectProvider: vi.fn(async () => provider),
    loadUsableProseCheckpoint: vi.fn(async (args: { freshness?: CheckpointFreshnessContext }) => {
      push('loadCheckpoint')
      const checkpoint = checkpointState.current
      if (
        checkpoint &&
        options.rejectStaleCheckpoint &&
        args.freshness &&
        !verifyCheckpointFreshness(checkpoint, args.freshness).fresh
      ) {
        return null
      }
      return checkpoint
    }),
    persistProseReadyCheckpoint: vi.fn(async (args: {
      attemptId: string
      correlationId: string
      title: string
      paragraphs: string[]
      proseAttemptCount?: number
    }) => {
      push('persistCheckpoint')
      checkpointState.current = personalizedCheckpoint({
        attemptId: args.attemptId,
        correlationId: args.correlationId,
        title: args.title,
        paragraphs: args.paragraphs,
        proseFingerprint: proseFingerprint(args.title, args.paragraphs),
        status: 'PROSE_READY',
        proseAttemptCount: args.proseAttemptCount ?? 0,
        choiceAttemptCount: 0,
        jobAttemptNumber: PERSONALIZED_JOB_CONTEXT.attemptNumber,
      })
      return options.persistCheckpointResult ?? {
        ok: true as const,
        outcome: 'UPDATED' as const,
        checkpointAttemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      }
    }),
    markCheckpointStatus: vi.fn(async (args: { status: CheckpointStatus; choiceAttemptCount?: number }) => {
      if (args.status === 'RUNNING_CHOICES') push('markRunningChoices')
      if (args.status === 'CHOICES_RETRY_WAIT') push('markChoicesRetryWait')
      if (args.status === 'PUBLISHED') push('markPublished')
      if (checkpointState.current) {
        checkpointState.current = {
          ...checkpointState.current,
          status: args.status,
          choiceAttemptCount: args.choiceAttemptCount ?? checkpointState.current.choiceAttemptCount,
        }
      }
      return options.checkpointStatusResult?.[args.status] ?? {
        ok: true as const,
        outcome: 'UPDATED' as const,
        checkpointAttemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      }
    }),
    generateChapter: vi.fn(async (
      _providerInput: unknown,
      input: { snapshot: CanonSnapshot; chapterNumber: number },
    ) => {
      push('generateChapter')
      if (options.generateStatus === 'FAILED_REVIEW_REQUIRED') {
        return {
          status: 'FAILED_REVIEW_REQUIRED' as const,
          chapterNumber,
          draft: null,
          attempts: 2,
          findings: [],
          failedLayer: 'A' as const,
          reason: 'fail',
        }
      }
      const generatedDraft = structuredClone(draft)
      generatedDraft.paragraphs = [
        `Cerita ${input.snapshot.storyId} berlanjut di arsip basah.`,
        `Rute ${routeTruthByStory.get(input.snapshot.storyId)} dengan lampu lorong berkedip menjaga bab ${input.chapterNumber}.`,
        ...draft.paragraphs.slice(2),
      ]
      return {
        status: 'PUBLISHED' as const,
        chapterNumber,
        draft: generatedDraft,
        attempts: 0,
        findings: [],
      }
    }),
    toReaderSafe: vi.fn((d: ChapterDraftParsed) => {
      push('toReaderSafe')
      return {
        chapterNumber: d.chapterNumber,
        title: d.title,
        paragraphs: d.paragraphs,
        hasChoiceOrGate: d.hasChoiceOrGate,
      }
    }),
    assertConsumerSafe: vi.fn(() => {
      push('assertConsumerSafe')
    }),
    generateChoiceBranch: vi.fn(async () => {
      push('choices')
      capture.choiceCalls += 1
      if (options.choiceResults) {
        return options.choiceResults[choiceResultIndex++] ?? null
      }
      return options.choiceFailure ? null : branchFor(chapterNumber)
    }),
    resolveEnding: vi.fn(() => {
      push('resolveEnding')
      return {
        key: lockedEndingKey ?? 'publish-truth',
        name: 'Arsip Dibuka',
        requiredClosure: ['Dalang sabotase banjir terungkap.'],
      }
    }),
    auditPlotDebts: vi.fn((input: Parameters<typeof auditPlotDebts>[0] & {
      closesPlotDebts: Array<{ debtId: string; closureForm: 'RESOLVED' | 'SUBVERTED' | 'TRANSFORMED' | 'ABANDONED' }>
    }) => {
      push('auditPlotDebts')
      capture.auditInputs.push(structuredClone(input as unknown as Record<string, unknown>))
      if (options.useRealAudit) {
        const { closesPlotDebts, ...plotDebtInput } = input
        const result = auditPlotDebts(plotDebtInput)
        return {
          ...result,
          auditSignals: {
            opensNewThread: input.opensNewThread,
            opensMajorMystery: input.opensMajorMystery,
            opensNewConflict: input.opensNewConflict,
            closesPlotDebts,
          },
        }
      }
      return {
        ok: true,
        findings: [],
        auditSignals: options.auditArtifact ?? {
          opensNewThread: input.opensNewThread,
          opensMajorMystery: input.opensMajorMystery,
          opensNewConflict: input.opensNewConflict,
          closesPlotDebts: options.closesPlotDebts ?? [],
        },
      }
    }),
    persistEndingLock: vi.fn(async (args: {
      userId: string
      storyId: string
      endingKey: string
      endingName: string
      chapterNumber: number
    }) => {
      push('persistEndingLock')
      capture.lockCalls.push({
        userId: args.userId,
        storyId: args.storyId,
        endingKey: args.endingKey,
        endingName: args.endingName,
      })
    }),
    publishChapterV2: vi.fn(async (input: PublishChapterV2Input): Promise<PublishResult> => {
      push('publishV2')
      capture.publishInputs.push(structuredClone(input))
      capture.storyIdsSeen.push(input.storyId)
      if (options.publishThrow) throw options.publishThrow
      if (options.publishOk === false) {
        return { ok: false, reason: 'CHAPTER_EXISTS' }
      }
      return { ok: true, chapter_number: input.chapterNumber, seq: 9 }
    }),
    markReaderStateSelesai: vi.fn(async (args: {
      userId: string
      storyId: string
      endingName: string
      endingKey: string
    }) => {
      push('markSelesai')
      capture.markCalls.push(args)
    }),
    recordGenerationAttempt: vi.fn(async () => {
      push('telemetry')
    }),
  }

  return { deps, capture, draft, provider }
}

const PERSONALIZED_JOB_CONTEXT = {
  jobId: '00000000-0000-4000-8000-000000000001',
  workerId: 'worker-x',
  claimToken: '00000000-0000-4000-8000-000000000002',
  leaseId: '00000000-0000-4000-8000-000000000003',
  attemptNumber: 2,
  correlationId: CORRELATION_ID,
  generationKind: 'personalized' as const,
  signal: new AbortController().signal,
}

function personalizedDirectionFingerprint(storyId = STORY_A): string {
  return createHash('sha256')
    .update(JSON.stringify(contractFor(storyId)))
    .digest('hex')
    .slice(0, 32)
}

function personalizedCheckpoint(
  overrides: Partial<ChapterGenerationCheckpoint> = {},
): ChapterGenerationCheckpoint {
  const title = 'Bab 12 dari checkpoint'
  const paragraphs = [
    'Maya membuka arsip yang tersimpan dari percobaan sebelumnya.',
    'Lampu lorong berkedip saat langkah basah kembali terdengar.',
  ]
  return {
    storyId: STORY_A,
    chapterNumber: 12,
    attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
    correlationId: CORRELATION_ID,
    status: 'CHOICES_RETRY_WAIT',
    title,
    paragraphs,
    proseFingerprint: proseFingerprint(title, paragraphs),
    auditSignals: {
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
      closesPlotDebts: [],
    },
    auditSignalsVersion: CHECKPOINT_AUDIT_SIGNALS_VERSION,
    canonVersion: 1,
    blueprintVersion: 1,
    directionFingerprint: personalizedDirectionFingerprint(),
    generationMode: 'personalized',
    generationPolicyVersion: 2,
    promptContractVersion: 2,
    jobId: PERSONALIZED_JOB_CONTEXT.jobId,
    jobAttemptNumber: 1,
    schemaVersion: 2,
    proseAttemptCount: 1,
    choiceAttemptCount: 1,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:01:00.000Z',
    expiresAt: '2099-07-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('generateNextPersonalizedChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.adminFactory.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    })
  })

  it('uses stored V2 audit artifact directly on resume despite mutable contract state', async () => {
    const storedArtifact = {
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
      closesPlotDebts: [{ debtId: 'main_mystery', closureForm: 'RESOLVED' as const }],
    }
    const checkpoint = personalizedCheckpoint({ auditSignals: storedArtifact })
    const { deps } = makeDeps({
      chapterNumber: 12,
      checkpoint,
      debtsStatus: 'open',
      lockedEndingKey: null,
    })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({ ok: true, fromCheckpoint: true })

    expect(deps.auditPlotDebts).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledWith(
      expect.objectContaining({ closures: storedArtifact.closesPlotDebts }),
    )
  })

  it('persists and publishes exact artifact returned by fresh successful audit', async () => {
    const auditArtifact = {
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
      closesPlotDebts: [{ debtId: 'main_mystery', closureForm: 'SUBVERTED' as const }],
    }
    const { deps } = makeDeps({ chapterNumber: 12, auditArtifact })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)

    const persistCalls = deps.persistProseReadyCheckpoint.mock.calls as unknown as Array<
      [{ auditSignals: unknown; auditSignalsVersion: number }]
    >
    const persisted = persistCalls[0]?.[0]
    const published = mocks.publishGenerationJobChapterV4.mock.calls[0]?.[0] as {
      closures: unknown
    }
    expect(persisted.auditSignals).toBe(auditArtifact)
    expect(persisted.auditSignalsVersion).toBe(2)
    expect(published.closures).toBe(auditArtifact.closesPlotDebts)
  })

  it('reuses same-job earlier-attempt prose with current claim identity and skips prose provider', async () => {
    const checkpoint = personalizedCheckpoint()
    const { deps, capture } = makeDeps({ chapterNumber: 12, checkpoint })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({ ok: true, fromCheckpoint: true })

    expect(deps.loadUsableProseCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      storyId: STORY_A,
      chapterNumber: 12,
      attemptId: null,
      jobContext: PERSONALIZED_JOB_CONTEXT,
      freshness: expect.objectContaining({
        canonVersion: 1,
        blueprintVersion: 1,
        directionFingerprint: personalizedDirectionFingerprint(),
        generationMode: 'personalized',
        generationPolicyVersion: 2,
        promptContractVersion: 2,
        requireJobProvenance: true,
        jobId: PERSONALIZED_JOB_CONTEXT.jobId,
        jobAttemptNumber: 2,
      }),
    }))
    expect(deps.generateChapter).not.toHaveBeenCalled()
    expect(deps.selectProvider).toHaveBeenCalledTimes(1)
    expect(deps.persistProseReadyCheckpoint).not.toHaveBeenCalled()
    expect(deps.markCheckpointStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      status: 'RUNNING_CHOICES',
      choiceAttemptCount: 2,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }))
    expect(deps.markCheckpointStatus).toHaveBeenCalledTimes(1)
    expect(capture.calls.indexOf('loadCheckpoint')).toBeLessThan(capture.calls.indexOf('markRunningChoices'))
    expect(capture.calls.indexOf('markRunningChoices')).toBeLessThan(capture.calls.indexOf('choices'))
    expect(capture.calls).not.toContain('markPublished')
  })

  it.each([
    ['different job', { jobId: '00000000-0000-4000-8000-000000000099' }],
    ['attempt ahead', { jobAttemptNumber: 3 }],
  ] as const)('rejects %s checkpoint and generates fresh prose', async (_name, overrides) => {
    const { deps } = makeDeps({
      chapterNumber: 12,
      checkpoint: personalizedCheckpoint(overrides),
      rejectStaleCheckpoint: true,
    })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)

    expect(result).toMatchObject({ ok: true })
    expect(deps.generateChapter).toHaveBeenCalledTimes(1)
    expect(deps.persistProseReadyCheckpoint).toHaveBeenCalledTimes(1)
  })

  it('persists fresh worker prose before first choice using complete freshness and current identity', async () => {
    const { deps, capture } = makeDeps({ chapterNumber: 12 })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)

    expect(deps.persistProseReadyCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      storyId: STORY_A,
      auditSignalsVersion: 2,
      auditSignals: expect.objectContaining({ closesPlotDebts: [] }),
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      correlationId: CORRELATION_ID,
      canonVersion: 1,
      blueprintVersion: 1,
      directionFingerprint: personalizedDirectionFingerprint(),
      generationMode: 'personalized',
      generationPolicyVersion: 2,
      promptContractVersion: 2,
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobAttemptNumber: 2,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }))
    expect(capture.calls.indexOf('generateChapter')).toBeLessThan(capture.calls.indexOf('persistCheckpoint'))
    expect(capture.calls.indexOf('persistCheckpoint')).toBeLessThan(capture.calls.indexOf('markRunningChoices'))
    expect(capture.calls.indexOf('markRunningChoices')).toBeLessThan(capture.calls.indexOf('choices'))
  })

  it.each([12, 50])(
    'keeps committed worker chapter %i successful when PUBLISHED checkpoint reconciliation fails',
    async (chapterNumber) => {
      const { deps } = makeDeps({
        chapterNumber,
        lockedEndingKey: chapterNumber === 50 ? 'publish-truth' : null,
        debtsStatus: chapterNumber === 50 ? 'closed' : 'progressing',
        checkpointStatusResult: {
          PUBLISHED: { ok: false, outcome: 'OWNERSHIP_LOST', errorCode: 'GENERATION_JOB_OWNERSHIP_LOST', disposition: 'OWNERSHIP_LOST' },
        },
      })
      mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
        jobId: PERSONALIZED_JOB_CONTEXT.jobId,
        chapterNumber,
        seq: 9,
      })
      const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

      await expect(generateNextPersonalizedChapter({
        storyId: STORY_A,
        userId: USER_A,
        correlationId: CORRELATION_ID,
        chapterNumber,
        attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
        jobContext: PERSONALIZED_JOB_CONTEXT,
      }, deps)).resolves.toMatchObject({ ok: true, chapterNumber, seq: 9 })
      expect(deps.markCheckpointStatus).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps committed worker chapter 50 successful when PUBLISHED checkpoint transition throws', async () => {
    const { deps } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
    })
    deps.markCheckpointStatus.mockImplementation(async (args: { status: CheckpointStatus }) => {
      if (args.status === 'PUBLISHED') throw new Error('checkpoint unavailable')
      return { ok: true, outcome: 'UPDATED' as const, checkpointAttemptId: PERSONALIZED_JOB_CONTEXT.jobId }
    })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 50,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({ ok: true, chapterNumber: 50, seq: 9 })
  })

  it('keeps committed worker chapter 50 successful when markReaderStateSelesai throws', async () => {
    const { deps } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
    })
    deps.markReaderStateSelesai.mockRejectedValueOnce(new Error('reader state unavailable'))
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 50,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({ ok: true, chapterNumber: 50, seq: 9 })
    expect(deps.recordGenerationAttempt).toHaveBeenCalledTimes(1)
  })

  it('keeps committed worker chapter 50 successful when recordGenerationAttempt throws', async () => {
    const { deps } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
    })
    deps.recordGenerationAttempt.mockRejectedValueOnce(new Error('telemetry unavailable'))
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 50,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({ ok: true, chapterNumber: 50, seq: 9 })
    expect(deps.markReaderStateSelesai).toHaveBeenCalledTimes(1)
  })

  it('stops before choices when worker checkpoint persistence loses ownership', async () => {
    const { deps } = makeDeps({
      chapterNumber: 12,
      persistCheckpointResult: { ok: false, outcome: 'OWNERSHIP_LOST', errorCode: 'GENERATION_JOB_OWNERSHIP_LOST', disposition: 'OWNERSHIP_LOST' },
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({
      ok: false,
      reason: 'FAILED_REVIEW_REQUIRED',
      detail: {
        checkpointMutation: {
          ok: false,
          outcome: 'OWNERSHIP_LOST',
          errorCode: 'GENERATION_JOB_OWNERSHIP_LOST',
          disposition: 'OWNERSHIP_LOST',
        },
      },
    })
    expect(deps.generateChoiceBranch).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()
  })

  it('generates prose once, resumes same fingerprint after exhausted choices, and publishes V4 once', async () => {
    const checkpointState = { current: null as ChapterGenerationCheckpoint | null }
    const { deps } = makeDeps({
      chapterNumber: 12,
      checkpointState,
      choiceResults: [null, null, branchFor(12)],
    })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')
    const input = {
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }

    const first = await generateNextPersonalizedChapter(input, deps)
    expect(first).toMatchObject({ ok: false, reason: 'CHOICE_GENERATION_FAILED' })
    expect(checkpointState.current).toMatchObject({
      status: 'CHOICES_RETRY_WAIT',
      proseAttemptCount: 0,
    })
    const savedFingerprint = checkpointState.current?.proseFingerprint
    expect(savedFingerprint).toBeTruthy()
    expect(deps.generateChapter).toHaveBeenCalledTimes(1)
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()

    const retry = await generateNextPersonalizedChapter(input, deps)
    expect(retry).toMatchObject({ ok: true, fromCheckpoint: true, chapterNumber: 12, seq: 9 })
    expect(deps.generateChapter).toHaveBeenCalledTimes(1)
    expect(deps.generateChoiceBranch).toHaveBeenCalledTimes(3)
    expect(checkpointState.current?.proseFingerprint).toBe(savedFingerprint)
    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledTimes(1)
    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledWith(expect.objectContaining({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      storyId: STORY_A,
      chapterNumber: 12,
    }))
  }, 15_000)

  it('retains checkpoint as CHOICES_RETRY_WAIT when choices fail', async () => {
    const checkpoint = personalizedCheckpoint({ status: 'PROSE_READY' })
    const { deps } = makeDeps({ chapterNumber: 12, checkpoint, choiceFailure: true })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)).resolves.toMatchObject({ ok: false, reason: 'CHOICE_GENERATION_FAILED' })

    expect(deps.markCheckpointStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      attemptId: checkpoint.attemptId,
      status: 'CHOICES_RETRY_WAIT',
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }))
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()
  })

  it('runs lease → canon → contract → reader → brief → compile → generate → safe → choices → publishV2 → telemetry for chapter < 50', async () => {
    const { deps, capture } = makeDeps({ chapterNumber: 12 })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result: RealGenerateResult = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, deps)

    expect(result).toEqual({
      ok: true,
      chapterNumber: 12,
      seq: 9,
      repairAttempts: 0,
    })
    const expectedContext = {
      userId: USER_A,
      storyId: STORY_A,
      chapterNumber: 12,
      generationKind: 'personalized',
      jobId: null,
      correlationId: CORRELATION_ID,
      attemptNumber: null,
    }
    expect(deps.selectProvider).toHaveBeenNthCalledWith(1, expectedContext)
    expect(deps.selectProvider).toHaveBeenNthCalledWith(2, expectedContext)

    expect(capture.calls).toEqual([
      'lease',
      'canon',
      'contract',
      'reader',
      'brief',
      'compile',
      'loadCheckpoint',
      'generateChapter',
      'auditPlotDebts',
      'persistCheckpoint',
      'markRunningChoices',
      'toReaderSafe',
      'assertConsumerSafe',
      'choices',
      'publishV2',
      'markPublished',
      'telemetry',
    ])
    expect(deps.generateChoiceBranch).toHaveBeenCalledTimes(1)
    expect(deps.resolveEnding).not.toHaveBeenCalled()
    expect(deps.markReaderStateSelesai).not.toHaveBeenCalled()
    expect(deps.persistEndingLock).not.toHaveBeenCalled()
    expect(capture.publishInputs[0]).toMatchObject({
      storyId: STORY_A,
      chapterNumber: 12,
      choicePrompt: 'Apa yang Maya lakukan selanjutnya di arsip?',
      choices: [
        { id: 'open-door', label: 'Buka pintu arsip basah di depan Maya' },
        { id: 'investigate-light', label: 'Periksa lampu lorong yang berkedip' },
      ],
    })
    expect(capture.publishInputs[0].outcomes).toHaveLength(2)
    expect(capture.publishInputs[0].outcomes[0]).toMatchObject({
      choiceId: 'open-door',
      choiceKind: 'normal',
      effect: distinctEffect(0),
    })
  })

  it('releases owned lease once when non-final legacy publish returns CHAPTER_EXISTS', async () => {
    const { deps } = makeDeps({ chapterNumber: 12, publishOk: false })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, deps)

    expect(result).toEqual({ ok: false, reason: 'CHAPTER_EXISTS' })
    expect(deps.releaseGenerationLease).toHaveBeenCalledTimes(1)
    expect(deps.releaseGenerationLease).toHaveBeenCalledWith({
      storyId: STORY_A,
      leaseId: `lease-${STORY_A}-12`,
    })
  })

  it('does not manually release owned lease after successful legacy publish', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, deps)

    expect(result.ok).toBe(true)
    expect(deps.publishChapterV2).toHaveBeenCalledTimes(1)
    expect(deps.releaseGenerationLease).not.toHaveBeenCalled()
  })

  it('worker-ON chapter 50 skips choice providers and publishes null/empty choices through V4 exactly once', async () => {
    const { deps } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
    })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      chapterNumber: 50,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)

    expect(result).toMatchObject({ ok: true, chapterNumber: 50, seq: 9 })
    expect(deps.selectProvider).toHaveBeenCalledTimes(1)
    expect(deps.generateChoiceBranch).not.toHaveBeenCalled()
    expect(deps.resolveEnding).toHaveBeenCalledTimes(1)
    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledTimes(1)
    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledWith(expect.objectContaining({
      jobId: PERSONALIZED_JOB_CONTEXT.jobId,
      storyId: STORY_A,
      chapterNumber: 50,
      choicePrompt: null,
      choices: null,
      outcomes: [],
    }))
    expect(mocks.publishGenerationJobChapterV2).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV3).not.toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
    expect(deps.markReaderStateSelesai).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingName: 'Arsip Dibuka',
      endingKey: 'publish-truth',
    })
  })

  it('does not mark SELESAI when chapter 50 publish fails for non-exists reasons', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
      publishThrow: new Error('publishChapterV2: network down'),
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
    }, deps)).rejects.toThrow(/network down/)
    expect(deps.markReaderStateSelesai).not.toHaveBeenCalled()
    expect(capture.markCalls).toEqual([])
  })

  it('marks SELESAI after CHAPTER_EXISTS on chapter 50 when reader not yet SELESAI', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
      publishOk: false,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
    }, deps)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.chapterNumber).toBe(50)
      expect(result.seq).toBe(0)
    }
    expect(deps.markReaderStateSelesai).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingName: 'Arsip Dibuka',
      endingKey: 'publish-truth',
    })
    expect(deps.releaseGenerationLease).toHaveBeenCalledTimes(1)
    expect(deps.releaseGenerationLease).toHaveBeenCalledWith({
      storyId: STORY_A,
      leaseId: `lease-${STORY_A}-50`,
    })
    const publishIdx = capture.calls.indexOf('publishV2')
    const releaseIdx = capture.calls.indexOf('releaseLease')
    const markIdx = capture.calls.indexOf('markSelesai')
    expect(releaseIdx).toBeGreaterThan(publishIdx)
    expect(markIdx).toBeGreaterThan(releaseIdx)
  })

  it('checks abort before classifying or logging a deferred V4 rejection', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const controller = new AbortController()
    let rejectPublish: ((reason: unknown) => void) | undefined
    mocks.publishGenerationJobChapterV4.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectPublish = reject
    }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const promise = generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: { ...PERSONALIZED_JOB_CONTEXT, signal: controller.signal },
    }, deps)
    await vi.waitFor(() => expect(rejectPublish).toBeTypeOf('function'), { timeout: 10_000 })
    controller.abort()
    rejectPublish?.(new Error('deferred personalized secret sentinel'))

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('deferred personalized secret sentinel')
  })

  it('classifies untyped V4 errors as TRANSIENT without logging secret sentinel', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.publishGenerationJobChapterV4.mockRejectedValueOnce(new Error('network secret sentinel'))
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      attemptId: PERSONALIZED_JOB_CONTEXT.jobId,
      jobContext: PERSONALIZED_JOB_CONTEXT,
    }, deps)

    expect(result).toMatchObject({ ok: false, reason: 'TRANSIENT' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('network secret sentinel')
  })

  it('returns CHAPTER_EXISTS after chapter 50 worker reader-state reconciliation', async () => {
    const { deps } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
    })
    const { GenerationJobError } = await import('@/lib/runtime/generation-jobs')
    mocks.publishGenerationJobChapterV4.mockRejectedValueOnce(
      new GenerationJobError('CHAPTER_EXISTS'),
    )
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
      jobContext: {
        jobId: '00000000-0000-4000-8000-000000000001',
        workerId: 'worker-x',
        claimToken: '00000000-0000-4000-8000-000000000002',
        leaseId: 'lease-worker',
        attemptNumber: 1,
        correlationId: CORRELATION_ID,
        generationKind: 'personalized',
        signal: new AbortController().signal,
      },
    }, deps)

    expect(result).toEqual({ ok: false, reason: 'CHAPTER_EXISTS' })
    expect(deps.markReaderStateSelesai).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingName: 'Arsip Dibuka',
      endingKey: 'publish-truth',
    })
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
    expect(deps.releaseGenerationLease).not.toHaveBeenCalled()
  })

  it('keeps chapter 50 publish successful when mark SELESAI throws after publish ok', async () => {
    const firstCapture = {
      publishInputs: [] as PublishChapterV2Input[],
      calls: [] as CallName[],
      choiceCalls: 0,
      markCalls: [] as Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>,
      lockCalls: [] as Array<{ userId: string; storyId: string; endingKey: string; endingName: string }>,
      auditInputs: [] as Array<Record<string, unknown>>,
      storyIdsSeen: [] as string[],
    }
    const first = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
      capture: firstCapture,
    })
    first.deps.markReaderStateSelesai = vi.fn(async () => {
      firstCapture.calls.push('markSelesai')
      throw new Error('markReaderStateSelesai: transient write failure')
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    // Publikasi sudah commit: kegagalan rekonsiliasi pasca-publish tidak boleh
    // mengubah hasil menjadi gagal atau melempar ke pemanggil.
    const firstResult = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
    }, first.deps)

    expect(firstResult.ok).toBe(true)
    expect(first.deps.publishChapterV2).toHaveBeenCalledTimes(1)
    expect(first.deps.markReaderStateSelesai).toHaveBeenCalledTimes(1)
    expect(first.deps.releaseGenerationLease).not.toHaveBeenCalled()

    // Retry: chapter already published → CHAPTER_EXISTS; must still mark SELESAI.
    const secondCapture = {
      publishInputs: [] as PublishChapterV2Input[],
      calls: [] as CallName[],
      choiceCalls: 0,
      markCalls: [] as Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>,
      lockCalls: [] as Array<{ userId: string; storyId: string; endingKey: string; endingName: string }>,
      auditInputs: [] as Array<Record<string, unknown>>,
      storyIdsSeen: [] as string[],
    }
    const second = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
      publishOk: false,
      capture: secondCapture,
    })
    const recovery = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
    }, second.deps)

    expect(recovery.ok).toBe(true)
    expect(second.deps.markReaderStateSelesai).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingName: 'Arsip Dibuka',
      endingKey: 'publish-truth',
    })
    expect(secondCapture.calls.indexOf('markSelesai')).toBeGreaterThan(
      secondCapture.calls.indexOf('publishV2'),
    )
  })

  it('persists ending lock at chapter 45 before publish', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 45,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
    })
    deps.resolveEnding = vi.fn(() => {
      capture.calls.push('resolveEnding')
      return {
        key: 'publish-truth',
        name: 'Arsip Dibuka',
        requiredClosure: ['Dalang sabotase banjir terungkap.'],
      }
    })
    deps.buildChapterBrief = vi.fn(() => {
      capture.calls.push('brief')
      return briefStub(STORY_A, 45, null)
    })

    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')
    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 45,
    }, deps)

    expect(result.ok).toBe(true)
    expect(deps.persistEndingLock).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingKey: 'publish-truth',
      endingName: 'Arsip Dibuka',
      chapterNumber: 45,
    })
    const lockIdx = capture.calls.indexOf('persistEndingLock')
    const publishIdx = capture.calls.indexOf('publishV2')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeLessThan(publishIdx)
  })

  it('worker chapter 45 publishes V3 with proposed lock and never persists separately', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 45,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
    })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      ok: true,
      jobId: '00000000-0000-4000-8000-000000000001',
      chapterNumber: 45,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 45,
      jobContext: {
        jobId: '00000000-0000-4000-8000-000000000001',
        workerId: 'worker-x',
        claimToken: '00000000-0000-4000-8000-000000000002',
        leaseId: '00000000-0000-4000-8000-000000000003',
        attemptNumber: 1,
        correlationId: CORRELATION_ID,
        generationKind: 'personalized',
        signal: new AbortController().signal,
      },
    }, deps)

    expect(result.ok).toBe(true)
    expect(deps.resolveEnding).toHaveBeenCalledTimes(1)
    expect(deps.persistEndingLock).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledWith(expect.objectContaining({
      jobId: '00000000-0000-4000-8000-000000000001',
      workerId: 'worker-x',
      claimToken: '00000000-0000-4000-8000-000000000002',
      leaseId: '00000000-0000-4000-8000-000000000003',
      storyId: STORY_A,
      chapterNumber: 45,
      endingLock: { key: 'publish-truth', name: 'Arsip Dibuka' },
    }))
    expect(capture.auditInputs[0]).toMatchObject({ endingLocked: true })
  })

  it('worker non-45 chapter always publishes V3 with null ending lock', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      ok: true,
      jobId: '00000000-0000-4000-8000-000000000001',
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      jobContext: {
        jobId: '00000000-0000-4000-8000-000000000001',
        workerId: 'worker-x',
        claimToken: '00000000-0000-4000-8000-000000000002',
        leaseId: '00000000-0000-4000-8000-000000000003',
        attemptNumber: 1,
        correlationId: CORRELATION_ID,
        generationKind: 'personalized',
        signal: new AbortController().signal,
      },
    }, deps)

    expect(mocks.publishGenerationJobChapterV4).toHaveBeenCalledWith(
      expect.objectContaining({ chapterNumber: 12, endingLock: null }),
    )
    expect(deps.persistEndingLock).not.toHaveBeenCalled()
  })

  it('defaultPersistEndingLock calls atomic RPC with reader + contract lock payload', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
    mocks.adminFactory.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
      rpc,
    })
    const mod = await import('@/lib/runtime/personalized-generation')
    await mod.defaultPersistEndingLockForTest({
      userId: USER_A,
      storyId: STORY_A,
      endingKey: 'publish-truth',
      endingName: 'Arsip Dibuka',
      chapterNumber: 45,
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'persist_ending_lock_v1',
      expect.objectContaining({
        p_user_id: USER_A,
        p_story_id: STORY_A,
        p_ending_key: 'publish-truth',
        p_ending_name: 'Arsip Dibuka',
        p_chapter_number: 45,
      }),
    )
    const rpcArgs = rpc.mock.calls.at(0) as unknown as [string, Record<string, unknown>]
    expect(rpcArgs[0]).toBe('persist_ending_lock_v1')
  })

  it('chapter 41 choices failure then retry cannot bypass opensNewThread audit', async () => {
    const first = makeDeps({
      chapterNumber: 41,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
      draftSignals: { opensNewThread: true },
      choiceFailure: true,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const firstResult = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 41,
    }, first.deps)
    expect(firstResult).toMatchObject({ ok: false, reason: 'CHOICE_GENERATION_FAILED' })
    const persistCalls = first.deps.persistProseReadyCheckpoint.mock.calls as unknown as Array<[{
      title: string
      paragraphs: string[]
      auditSignals: NonNullable<ChapterGenerationCheckpoint['auditSignals']>
      auditSignalsVersion: typeof CHECKPOINT_AUDIT_SIGNALS_VERSION
    }]>
    const saved = persistCalls[0]?.[0] as {
      title: string
      paragraphs: string[]
      auditSignals: NonNullable<ChapterGenerationCheckpoint['auditSignals']>
      auditSignalsVersion: typeof CHECKPOINT_AUDIT_SIGNALS_VERSION
    }
    expect(saved).toBeDefined()
    expect(saved.auditSignals).toEqual({
      opensNewThread: true,
      opensMajorMystery: false,
      opensNewConflict: false,
      closesPlotDebts: [],
    })
    expect(saved.auditSignalsVersion).toBe(CHECKPOINT_AUDIT_SIGNALS_VERSION)

    const checkpoint = personalizedCheckpoint({
      chapterNumber: 41,
      title: saved.title,
      paragraphs: saved.paragraphs,
      proseFingerprint: proseFingerprint(saved.title, saved.paragraphs),
      auditSignals: saved.auditSignals,
      auditSignalsVersion: saved.auditSignalsVersion,
      status: 'CHOICES_RETRY_WAIT',
    })
    const retry = makeDeps({
      chapterNumber: 41,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
      checkpoint,
      useRealAudit: true,
    })
    const retryResult = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 41,
    }, retry.deps)

    expect(retryResult).toMatchObject({ ok: true, fromCheckpoint: true })
    expect(retry.deps.generateChapter).not.toHaveBeenCalled()
    expect(retry.deps.persistProseReadyCheckpoint).not.toHaveBeenCalled()
    expect(retry.deps.auditPlotDebts).not.toHaveBeenCalled()
    expect(retry.capture.auditInputs).toEqual([])
  }, 15_000)

  it('fails audit when draft opens new thread after chapter 40', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 41,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
      draftSignals: { opensNewThread: true },
      useRealAudit: true,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 41,
    }, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('FAILED_REVIEW_REQUIRED')
    expect(capture.auditInputs[0]).toMatchObject({
      chapterNumber: 41,
      opensNewThread: true,
      endingLocked: false,
    })
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
  })

  it('fails audit when draft opens major mystery after chapter 35', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 36,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
      draftSignals: { opensMajorMystery: true },
      useRealAudit: true,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 36,
    }, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('FAILED_REVIEW_REQUIRED')
      expect(JSON.stringify(result.detail)).toMatch(/MAJOR_MYSTERY_AFTER_35/)
    }
    expect(capture.auditInputs[0]).toMatchObject({
      chapterNumber: 36,
      opensMajorMystery: true,
    })
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
  })

  it('fails audit when chapter 50 draft opens new conflict', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
      draftSignals: { opensNewConflict: true },
      useRealAudit: true,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 50,
    }, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('FAILED_REVIEW_REQUIRED')
      expect(JSON.stringify(result.detail)).toMatch(/NEW_CONFLICT_AT_END/)
    }
    expect(capture.auditInputs[0]).toMatchObject({
      chapterNumber: 50,
      opensNewConflict: true,
      endingLocked: true,
    })
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
    expect(deps.markReaderStateSelesai).not.toHaveBeenCalled()
  })

  it('does not force endingLocked true solely because chapterNumber >= 45 without lock', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 46,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
      useRealAudit: true,
    })
    deps.resolveEnding = vi.fn(() => {
      capture.calls.push('resolveEnding')
      return {
        key: 'publish-truth',
        name: 'Arsip Dibuka',
        requiredClosure: ['Dalang sabotase banjir terungkap.'],
      }
    })
    deps.buildChapterBrief = vi.fn(() => {
      capture.calls.push('brief')
      return briefStub(STORY_A, 46, null)
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 46,
    }, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('FAILED_REVIEW_REQUIRED')
      expect(JSON.stringify(result.detail)).toMatch(/ENDING_NOT_LOCKED/)
    }
    expect(capture.auditInputs[0]).toMatchObject({
      chapterNumber: 46,
      endingLocked: false,
    })
    expect(deps.persistEndingLock).not.toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
  })

  it('treats ending lock written this turn as endingLocked for audit at chapter 45', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 45,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
      useRealAudit: true,
    })
    deps.resolveEnding = vi.fn(() => {
      capture.calls.push('resolveEnding')
      return {
        key: 'publish-truth',
        name: 'Arsip Dibuka',
        requiredClosure: ['Dalang sabotase banjir terungkap.'],
      }
    })
    deps.buildChapterBrief = vi.fn(() => {
      capture.calls.push('brief')
      return briefStub(STORY_A, 45, null)
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 45,
    }, deps)

    expect(result.ok).toBe(true)
    expect(capture.auditInputs[0]).toMatchObject({
      chapterNumber: 45,
      endingLocked: true,
    })
    expect(deps.persistEndingLock).toHaveBeenCalled()
  })

  it('keeps same-number A/B generation isolated on shared dependencies and capture', async () => {
    const sharedCapture = {
      publishInputs: [] as PublishChapterV2Input[],
      calls: [] as CallName[],
      choiceCalls: 0,
      markCalls: [] as Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>,
      lockCalls: [] as Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>,
      auditInputs: [] as Array<Record<string, unknown>>,
      storyIdsSeen: [] as string[],
    }
    const shared = makeDeps({ storyId: STORY_A, chapterNumber: 12, capture: sharedCapture })
    const contractTitleByStory = new Map<string, string>()
    const routeTruthByStory = new Map<string, number>()
    const sourceTemplateByStory = new Map([
      [STORY_A, PREMIUM_TEMPLATE_ID],
      [STORY_B, PREMIUM_TEMPLATE_ID],
    ])
    const factByStory = new Map([
      [STORY_A, 'Arsip A terbakar.'],
      [STORY_B, 'Arsip B terendam.'],
    ])
    shared.deps.loadCanonSnapshot = vi.fn(async (storyId: string) => {
      const snapshot = snapshotFor(storyId)
      snapshot.facts[0].statement = factByStory.get(storyId) ?? 'Fakta cerita tidak dikenal.'
      return snapshot
    })
    shared.deps.loadStoryGenerationContract = vi.fn(async (storyId: string) => ({
      ...contractFor(storyId),
      title: storyId === STORY_A ? 'Kontrak Arsip Merah' : 'Kontrak Arsip Biru',
    }))
    shared.deps.loadReaderStateInternal = vi.fn(async (userId: string, storyId: string) => ({
      ...readerState(),
      user_id: userId,
      story_id: storyId,
      route_state: normalizeRouteState(storyId === STORY_A
        ? { truth: 8, risk: 1, endingBias: { 'publish-truth': 5 } }
        : { truth: 1, risk: 9, endingBias: { 'protect-witnesses': 7 } }),
    }))
    shared.deps.buildChapterBrief = vi.fn((input: BuildChapterBriefInput) => {
      const routeState = normalizeRouteState(input.readerState.routeState)
      contractTitleByStory.set(input.storyContract.storyId, input.storyContract.title)
      routeTruthByStory.set(input.storyContract.storyId, routeState.truth)
      const brief = briefStub(input.storyContract.storyId, 12)
      brief.routeSummary = `truth=${routeState.truth}`
      brief.routeStateSummary = brief.routeSummary
      return brief
    })
    shared.deps.generateChapter = vi.fn(async (
      _providerInput: unknown,
      input: { snapshot: CanonSnapshot; chapterNumber: number },
    ) => ({
      status: 'PUBLISHED' as const,
      chapterNumber: input.chapterNumber,
      draft: {
        ...draftFor(input.snapshot.storyId, input.chapterNumber),
        paragraphs: [
          `Snapshot ${input.snapshot.storyId}: Maya di depan arsip basah. ${input.snapshot.facts[0].statement}`,
          `${contractTitleByStory.get(input.snapshot.storyId)}; lampu lorong berkedip. truth=${routeTruthByStory.get(input.snapshot.storyId)}.`,
        ],
      },
      attempts: 0,
      findings: [],
    }))
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await Promise.all([
      generateNextPersonalizedChapter({
        storyId: STORY_A,
        userId: USER_A,
        correlationId: CORRELATION_ID,
        chapterNumber: 12,
      }, shared.deps),
      generateNextPersonalizedChapter({
        storyId: STORY_B,
        userId: USER_B,
        correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        chapterNumber: 12,
      }, shared.deps),
    ])

    expect(shared.deps.loadCanonSnapshot.mock.calls).toEqual([[STORY_A, 12], [STORY_B, 12]])
    expect(shared.deps.loadStoryGenerationContract.mock.calls).toEqual([[STORY_A], [STORY_B]])
    expect(shared.deps.loadReaderStateInternal.mock.calls).toEqual([
      [USER_A, STORY_A],
      [USER_B, STORY_B],
    ])
    // Concurrent A/B completion order is intentionally nondeterministic; assert
    // isolation by membership, not Promise.all scheduling order.
    expect(sharedCapture.publishInputs.map((input) => input.storyId).sort()).toEqual(
      [STORY_A, STORY_B].sort(),
    )
    expect(sharedCapture.publishInputs.map((input) => input.chapterNumber)).toEqual([12, 12])
    const publishedByStory = new Map(sharedCapture.publishInputs.map((input) => [input.storyId, input]))
    expect(publishedByStory.get(STORY_A)?.paragraphs).toEqual([
      `Snapshot ${STORY_A}: Maya di depan arsip basah. Arsip A terbakar.`,
      'Kontrak Arsip Merah; lampu lorong berkedip. truth=8.',
    ])
    expect(publishedByStory.get(STORY_B)?.paragraphs).toEqual([
      `Snapshot ${STORY_B}: Maya di depan arsip basah. Arsip B terendam.`,
      'Kontrak Arsip Biru; lampu lorong berkedip. truth=1.',
    ])
    expect(JSON.stringify(publishedByStory.get(STORY_A)?.paragraphs)).not.toMatch(
      /Arsip B terendam|Kontrak Arsip Biru|truth=1/,
    )
    expect(JSON.stringify(publishedByStory.get(STORY_B)?.paragraphs)).not.toMatch(
      /Arsip A terbakar|Kontrak Arsip Merah|truth=8/,
    )
    expect(sourceTemplateByStory).toEqual(new Map([
      [PREMIUM_INSTANCE_A, PREMIUM_TEMPLATE_ID],
      [PREMIUM_INSTANCE_B, PREMIUM_TEMPLATE_ID],
    ]))
    expect(sharedCapture.publishInputs.map((input) => input.storyId).sort()).toEqual([
      PREMIUM_INSTANCE_A,
      PREMIUM_INSTANCE_B,
    ].sort())
    expect(sharedCapture.publishInputs.every((input) => input.storyId !== PREMIUM_TEMPLATE_ID)).toBe(true)
  })

  it('exports generateNextChapterReal unchanged and never calls it from personalized path', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const runtime = await import('@/lib/runtime')

    expect(typeof runtime.generateNextChapterReal).toBe('function')
    expect(typeof runtime.generateNextPersonalizedChapter).toBe('function')

    await runtime.generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, deps)

    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
  })

  it('returns LEASE_HELD without loading canon', async () => {
    const { deps, capture } = makeDeps({ chapterNumber: 12 })
    const leaseHeld = vi.fn(async (_args: {
      storyId: string
      chapterNumber: number
      holder: string
      ttlSeconds?: number
      idempotencyKey: string
    }) => {
      capture.calls.push('lease')
      return { ok: false as const, reason: 'LEASE_HELD' as const }
    })
    const heldDeps = {
      ...deps,
      acquireGenerationLease: leaseHeld,
    }
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, heldDeps)

    expect(result).toEqual({ ok: false, reason: 'LEASE_HELD' })
    expect(deps.loadCanonSnapshot).not.toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
  })

  it('provider ignoring abort cannot continue to choices or publish', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const controller = new AbortController()
    let resolveProse: ((value: Awaited<ReturnType<typeof deps.generateChapter>>) => void) | undefined
    deps.generateChapter.mockImplementationOnce(() => new Promise((resolve) => {
      resolveProse = resolve
    }))
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')
    const run = generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      jobContext: {
        jobId: '00000000-0000-4000-8000-000000000001',
        workerId: 'worker-x',
        claimToken: '00000000-0000-4000-8000-000000000002',
        leaseId: 'lease-worker',
        attemptNumber: 1,
        correlationId: CORRELATION_ID,
        generationKind: 'personalized',
        signal: controller.signal,
      },
    }, deps)
    await vi.waitFor(() => expect(resolveProse).toBeTypeOf('function'))

    controller.abort()
    resolveProse?.({
      status: 'PUBLISHED',
      chapterNumber: 12,
      draft: draftFor(STORY_A, 12),
      attempts: 0,
      findings: [],
    })

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.persistProseReadyCheckpoint).not.toHaveBeenCalled()
    expect(deps.markCheckpointStatus).not.toHaveBeenCalled()
    expect(deps.generateChoiceBranch).not.toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()
  })

  it('ch45 abort skips checkpoint, ending-lock write, choices, and publish', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 45,
      lockedEndingKey: null,
      debtsStatus: 'progressing',
    })
    const controller = new AbortController()
    deps.auditPlotDebts = vi.fn((input) => {
      controller.abort()
      capture.calls.push('auditPlotDebts')
      return {
        ok: true,
        findings: [],
        auditSignals: {
          opensNewThread: input.opensNewThread,
          opensMajorMystery: input.opensMajorMystery,
          opensNewConflict: input.opensNewConflict,
          closesPlotDebts: input.closesPlotDebts,
        },
      }
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const run = generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 45,
      jobContext: {
        jobId: '00000000-0000-4000-8000-000000000001',
        workerId: 'worker-x',
        claimToken: '00000000-0000-4000-8000-000000000002',
        leaseId: 'lease-worker',
        attemptNumber: 1,
        correlationId: CORRELATION_ID,
        generationKind: 'personalized',
        signal: controller.signal,
      },
    }, deps)

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.generateChapter).toHaveBeenCalled()
    expect(deps.persistProseReadyCheckpoint).not.toHaveBeenCalled()
    expect(deps.markCheckpointStatus).not.toHaveBeenCalled()
    expect(deps.generateChoiceBranch).not.toHaveBeenCalled()
    expect(deps.persistEndingLock).not.toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
    expect(mocks.publishGenerationJobChapterV4).not.toHaveBeenCalled()
    expect(capture.calls).not.toContain('persistEndingLock')
    expect(capture.calls).not.toContain('publishV2')
  })

  it('passes the exact worker signal into personalized prose execution', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const controller = new AbortController()
    mocks.publishGenerationJobChapterV4.mockResolvedValueOnce({
      jobId: '00000000-0000-4000-8000-000000000001',
      chapterNumber: 12,
      seq: 9,
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
      jobContext: {
        jobId: '00000000-0000-4000-8000-000000000001',
        workerId: 'worker-x',
        claimToken: '00000000-0000-4000-8000-000000000002',
        leaseId: 'lease-worker',
        attemptNumber: 1,
        correlationId: CORRELATION_ID,
        generationKind: 'personalized',
        signal: controller.signal,
      },
    }, deps)

    const proseArgs = deps.generateChapter.mock.calls[0][1] as unknown as {
      executionOptions: { signal?: AbortSignal }
    }
    expect(proseArgs.executionOptions.signal).toBe(controller.signal)
  })

  it('releases lease and returns FAILED_REVIEW_REQUIRED when generation fails review', async () => {
    const { deps } = makeDeps({
      chapterNumber: 12,
      generateStatus: 'FAILED_REVIEW_REQUIRED',
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('FAILED_REVIEW_REQUIRED')
    expect(deps.releaseGenerationLease).toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
    expect(deps.recordGenerationAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'REVIEW_REQUIRED' }),
    )
  })

  it('keeps internal route/effect fields out of consumer-safe path inputs', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      correlationId: CORRELATION_ID,
      chapterNumber: 12,
    }, deps)

    const safeArg = deps.toReaderSafe.mock.calls[0][0] as ChapterDraftParsed
    const blob = JSON.stringify(safeArg)
    expect(blob).not.toMatch(/route_state|effect_json|choice_kind|locked_ending_key|story_contract/)
    expect(deps.assertConsumerSafe).toHaveBeenCalledTimes(1)
  })
})

describe('runtime barrel', () => {
  it('re-exports personalized and standard generators', async () => {
    const runtime = await import('@/lib/runtime')
    expect(runtime).toHaveProperty('generateNextPersonalizedChapter')
    expect(runtime).toHaveProperty('generateNextChapterReal')
    expect(runtime).toHaveProperty('publishChapterV2')
  })
})
