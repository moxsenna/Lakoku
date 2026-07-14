import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import type { CanonSnapshot } from '@/lib/narrative/types'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import type { ChapterBrief, ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import type { ChoiceBranch, ChapterDraftParsed } from '@/lib/ai-gateway/schemas'
import type { GenerationProvider } from '@/lib/ai-gateway/provider'
import type { PublishChapterV2Input, PublishResult } from '@/lib/runtime/lifecycle'
import type { RealGenerateResult } from '@/lib/runtime/story-generation'
import { auditPlotDebts } from '@/lib/story-engine/plot-debt'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  generateNextChapterReal: vi.fn(),
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
const USER_B = '22222222-2222-4222-8222-222222222222'
const STORY_A = 'ai:story-a'
const STORY_B = 'ai:story-b'

type CallName =
  | 'lease'
  | 'canon'
  | 'contract'
  | 'reader'
  | 'brief'
  | 'compile'
  | 'generateChapter'
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

function emptyEffect() {
  return {
    routeDeltas: {},
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
    choicePrompt: 'Apa yang Maya lakukan sekarang?',
    choices: [
      { id: 'open-door', label: 'Buka pintu arsip basah' },
      { id: 'call-saksi', label: 'Telepon saksi sebelum lari' },
    ],
    outcomes: [
      {
        choiceId: 'open-door',
        consequence: ['Maya menemukan lembar basah.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: emptyEffect(),
      },
      {
        choiceId: 'call-saksi',
        consequence: ['Saksi menjawab dengan suara gemetar.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: emptyEffect(),
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
      'Suara langkah basah mendekat dari ujung koridor.',
      'Dia mengepal kertas yang masih hangat di tangannya.',
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
  const snapshot = buildFixtureSnapshot()
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
  useRealAudit?: boolean
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
      }
    }),
    buildChapterBrief: vi.fn(() => {
      push('brief')
      return briefStub(storyId, chapterNumber, lockedEndingKey)
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
    generateChapter: vi.fn(async () => {
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
      return {
        status: 'PUBLISHED' as const,
        chapterNumber,
        draft,
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
      return branchFor(chapterNumber)
    }),
    resolveEnding: vi.fn(() => {
      push('resolveEnding')
      return {
        key: lockedEndingKey ?? 'publish-truth',
        name: 'Arsip Dibuka',
        requiredClosure: ['Dalang sabotase banjir terungkap.'],
      }
    }),
    auditPlotDebts: vi.fn((input: Parameters<typeof auditPlotDebts>[0]) => {
      push('auditPlotDebts')
      capture.auditInputs.push(structuredClone(input as unknown as Record<string, unknown>))
      if (options.useRealAudit) return auditPlotDebts(input)
      return { ok: true, findings: [] }
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

  it('runs lease → canon → contract → reader → brief → compile → generate → safe → choices → publishV2 → telemetry for chapter < 50', async () => {
    const { deps, capture } = makeDeps({ chapterNumber: 12 })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result: RealGenerateResult = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      chapterNumber: 12,
    }, deps)

    expect(result).toEqual({
      ok: true,
      chapterNumber: 12,
      seq: 9,
      repairAttempts: 0,
    })

    expect(capture.calls).toEqual([
      'lease',
      'canon',
      'contract',
      'reader',
      'brief',
      'compile',
      'generateChapter',
      'toReaderSafe',
      'assertConsumerSafe',
      'choices',
      'auditPlotDebts',
      'publishV2',
      'telemetry',
    ])
    expect(deps.generateChoiceBranch).toHaveBeenCalledTimes(1)
    expect(deps.resolveEnding).not.toHaveBeenCalled()
    expect(deps.markReaderStateSelesai).not.toHaveBeenCalled()
    expect(deps.persistEndingLock).not.toHaveBeenCalled()
    expect(capture.publishInputs[0]).toMatchObject({
      storyId: STORY_A,
      chapterNumber: 12,
      choicePrompt: 'Apa yang Maya lakukan sekarang?',
      choices: [
        { id: 'open-door', label: 'Buka pintu arsip basah' },
        { id: 'call-saksi', label: 'Telepon saksi sebelum lari' },
      ],
    })
    expect(capture.publishInputs[0].outcomes).toHaveLength(2)
    expect(capture.publishInputs[0].outcomes[0]).toMatchObject({
      choiceId: 'open-door',
      choiceKind: 'normal',
      effect: emptyEffect(),
    })
  })

  it('chapter 50 skips choices, resolves ending, publishes null/empty choices, marks SELESAI only after publish', async () => {
    const { deps, capture } = makeDeps({
      chapterNumber: 50,
      lockedEndingKey: 'publish-truth',
      debtsStatus: 'closed',
    })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    const result = await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      chapterNumber: 50,
    }, deps)

    expect(result.ok).toBe(true)
    expect(deps.generateChoiceBranch).not.toHaveBeenCalled()
    expect(deps.resolveEnding).toHaveBeenCalledTimes(1)
    expect(capture.publishInputs[0]).toMatchObject({
      storyId: STORY_A,
      chapterNumber: 50,
      choicePrompt: null,
      choices: null,
      outcomes: [],
    })
    expect(deps.markReaderStateSelesai).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingName: 'Arsip Dibuka',
      endingKey: 'publish-truth',
    })

    const publishIdx = capture.calls.indexOf('publishV2')
    const markIdx = capture.calls.indexOf('markSelesai')
    expect(publishIdx).toBeGreaterThan(-1)
    expect(markIdx).toBeGreaterThan(publishIdx)
    expect(capture.calls).toEqual([
      'lease',
      'canon',
      'contract',
      'reader',
      'brief',
      'compile',
      'generateChapter',
      'toReaderSafe',
      'assertConsumerSafe',
      'resolveEnding',
      'auditPlotDebts',
      'publishV2',
      'markSelesai',
      'telemetry',
    ])
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
      chapterNumber: 50,
    }, deps)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.chapterNumber).toBe(50)
    }
    expect(deps.markReaderStateSelesai).toHaveBeenCalledWith({
      userId: USER_A,
      storyId: STORY_A,
      endingName: 'Arsip Dibuka',
      endingKey: 'publish-truth',
    })
    const publishIdx = capture.calls.indexOf('publishV2')
    const markIdx = capture.calls.indexOf('markSelesai')
    expect(markIdx).toBeGreaterThan(publishIdx)
  })

  it('recovers chapter 50 when first mark SELESAI throws after publish ok', async () => {
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

    await expect(generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      chapterNumber: 50,
    }, first.deps)).rejects.toThrow(/transient write failure/)
    expect(first.deps.publishChapterV2).toHaveBeenCalledTimes(1)

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
      chapterNumber: 45,
    }, deps)

    expect(result.ok).toBe(true)
    expect(capture.auditInputs[0]).toMatchObject({
      chapterNumber: 45,
      endingLocked: true,
    })
    expect(deps.persistEndingLock).toHaveBeenCalled()
  })

  it('keeps story A/B IDs and snapshots isolated', async () => {
    const captureA = {
      publishInputs: [] as PublishChapterV2Input[],
      calls: [] as CallName[],
      choiceCalls: 0,
      markCalls: [] as Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>,
      lockCalls: [] as Array<{ userId: string; storyId: string; endingKey: string; endingName: string }>,
      auditInputs: [] as Array<Record<string, unknown>>,
      storyIdsSeen: [] as string[],
    }
    const captureB = {
      publishInputs: [] as PublishChapterV2Input[],
      calls: [] as CallName[],
      choiceCalls: 0,
      markCalls: [] as Array<{ userId: string; storyId: string; endingName: string; endingKey: string }>,
      lockCalls: [] as Array<{ userId: string; storyId: string; endingKey: string; endingName: string }>,
      auditInputs: [] as Array<Record<string, unknown>>,
      storyIdsSeen: [] as string[],
    }
    const a = makeDeps({ storyId: STORY_A, chapterNumber: 12, capture: captureA })
    const b = makeDeps({ storyId: STORY_B, chapterNumber: 12, capture: captureB })
    const { generateNextPersonalizedChapter } = await import('@/lib/runtime/personalized-generation')

    await generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
      chapterNumber: 12,
    }, a.deps)
    await generateNextPersonalizedChapter({
      storyId: STORY_B,
      userId: USER_B,
      chapterNumber: 12,
    }, b.deps)

    expect(captureA.publishInputs[0].storyId).toBe(STORY_A)
    expect(captureB.publishInputs[0].storyId).toBe(STORY_B)
    expect(captureA.storyIdsSeen.every((id) => id === STORY_A)).toBe(true)
    expect(captureB.storyIdsSeen.every((id) => id === STORY_B)).toBe(true)
    expect(captureA.publishInputs[0].storyId).not.toBe(captureB.publishInputs[0].storyId)
  })

  it('exports generateNextChapterReal unchanged and never calls it from personalized path', async () => {
    const { deps } = makeDeps({ chapterNumber: 12 })
    const runtime = await import('@/lib/runtime')

    expect(typeof runtime.generateNextChapterReal).toBe('function')
    expect(typeof runtime.generateNextPersonalizedChapter).toBe('function')

    await runtime.generateNextPersonalizedChapter({
      storyId: STORY_A,
      userId: USER_A,
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
      chapterNumber: 12,
    }, heldDeps)

    expect(result).toEqual({ ok: false, reason: 'LEASE_HELD' })
    expect(deps.loadCanonSnapshot).not.toHaveBeenCalled()
    expect(deps.publishChapterV2).not.toHaveBeenCalled()
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
