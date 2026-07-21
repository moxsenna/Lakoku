/**
 * Phase 1 — Unit tests for extracted choice-generation module.
 *
 * Tests the new buildChoiceBranch orchestrator with mock DI deps,
 * verifying that the shared seam works correctly for both standard
 * and personalized call sites.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ChoiceBranch, ChapterDraftParsed } from '@/lib/ai-gateway/schemas'
import type { ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import type { ChoiceBuildDeps, BuildChoiceBranchInput } from '@/lib/runtime/choice-generation'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
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

// ---- Helpers ----

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

function mockDraft(chapterNumber = 12): ChapterDraftParsed {
  return {
    storyId: 'story-test',
    chapterNumber,
    title: `Bab ${chapterNumber}: Pintu yang Terbuka`,
    paragraphs: [
      'Maya berdiri di depan pintu gudang arsip yang basah.',
      'Suara langkah mendekat dari ujung lorong yang remang.',
      'Lampu berkedip di atas kepalanya, menciptakan bayangan aneh di dinding.',
      'Hawa dingin merayap dari balik pintu yang setengah terbuka.',
      'Di tangannya, kertas laporan Magang masih terasa hangat dari printer.',
    ],
    wordCount: 85,
    sceneCount: 1,
    hasChoiceOrGate: true,
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

function mockBranch(chapterNumber = 12): ChoiceBranch {
  const next = chapterNumber === 49 ? 50 : chapterNumber + 1
  return {
    choicePrompt: 'Apa yang Maya lakukan sekarang?',
    choices: [
      { id: 'buka-pintu', label: 'Buka pintu gudang arsip dengan hati-hati' },
      { id: 'ikuti-suara', label: 'Ikuti sumber suara langkah di lorong' },
    ],
    outcomes: [
      {
        choiceId: 'buka-pintu',
        consequence: ['Maya menemukan berkas basah yang masih bisa dibaca.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: emptyEffect() as ChoiceBranch['outcomes'][number]['effect'],
      },
      {
        choiceId: 'ikuti-suara',
        consequence: ['Sosok Raka muncul dari balik tikungan dengan wajah khawatir.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: emptyEffect() as ChoiceBranch['outcomes'][number]['effect'],
      },
    ],
  }
}

function mockBrief(snapshot: unknown, chapterNumber = 12) {
  const snap = snapshot as { storyId: string }
  return {
    storyId: snap.storyId ?? 'story-test',
    chapterNumber,
    totalChapters: 50,
    phase: 'setup',
    remainingChapters: 50 - chapterNumber,
    chapterGoal: 'Buka misteri arsip lama',
    mustInclude: [],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: 'Awal perjalanan; belum ada bias rute kuat.',
    choiceHistorySummary: 'Belum ada pilihan sebelumnya.',
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    allowedNewThread: chapterNumber < 40,
    allowedMajorNewConflict: chapterNumber < 45,
    endingRunway: 'expansion' as const,
    lockedEndingKey: null,
    allowsChoices: chapterNumber < 50,
    finalChapter: chapterNumber >= 50,
    goals: ['Buka misteri arsip lama'],
    routeSummary: 'Awal perjalanan; belum ada bias rute kuat.',
    debtsToProgress: [],
    debtsToClose: [],
    allowMajorNewConflict: chapterNumber < 45,
    allowNewThread: chapterNumber < 40,
    lockEnding: false,
    endingKey: null,
    previousChoiceSummary: 'Belum ada pilihan sebelumnya.',
  }
}

describe('Phase 1 — choice-generation module unit tests', () => {
  describe('isFinalChapter', () => {
    it('returns true when chapter >= totalChapters (default 50)', async () => {
      const { isFinalChapter } = await import('@/lib/runtime/choice-generation')
      expect(isFinalChapter(50)).toBe(true)
      expect(isFinalChapter(51)).toBe(true)
      expect(isFinalChapter(49)).toBe(false)
      expect(isFinalChapter(1)).toBe(false)
    })

    it('respects custom totalChapters', async () => {
      const { isFinalChapter } = await import('@/lib/runtime/choice-generation')
      expect(isFinalChapter(5, 5)).toBe(true)
      expect(isFinalChapter(4, 5)).toBe(false)
      expect(isFinalChapter(10, 10)).toBe(true)
    })
  })

  describe('fallbackChoicesFromDraft', () => {
    it('returns the two hard-coded choice labels', async () => {
      const { fallbackChoicesFromDraft } = await import('@/lib/runtime/choice-generation')
      const draft = mockDraft(12)
      const result = fallbackChoicesFromDraft(draft, 12)

      expect(result.choices).toHaveLength(2)
      expect(result.choices[0]).toEqual({
        id: 'hadapi',
        label: 'Hadapi langsung apa yang baru terbuka',
      })
      expect(result.choices[1]).toEqual({
        id: 'selidiki',
        label: 'Selidiki dulu jejak yang tersisa',
      })
    })

    it('returns ending-specific fallback for chapter 50', async () => {
      const { fallbackChoicesFromDraft } = await import('@/lib/runtime/choice-generation')
      const draft = mockDraft(50)
      const result = fallbackChoicesFromDraft(draft, 50)

      expect(result.outcomes[0].isEnding).toBe(true)
      expect(result.outcomes[0].nextChapterNumber).toBeNull()
    })

    it('choicePrompt is at most 120 chars', async () => {
      const { fallbackChoicesFromDraft } = await import('@/lib/runtime/choice-generation')
      const draft = mockDraft(12)
      const result = fallbackChoicesFromDraft(draft, 12)

      expect(result.choicePrompt.length).toBeLessThanOrEqual(120)
    })
  })

  describe('buildChoiceBranch', () => {
    it('returns result with branch when provider succeeds', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const selectProvider = vi.fn().mockResolvedValue({ name: 'test' })
      const generateChoiceBranch = vi.fn().mockResolvedValue(mockBranch())
      const deps: ChoiceBuildDeps = {
        selectProvider,
        generateChoiceBranch,
      }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(12)
      const brief = mockBrief(snapshot, 12)

      const result = await buildChoiceBranch(deps, {
        snapshot,
        draft,
        chapterNumber: 12,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: { correlationId: 'test' },
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.source).toBe('INITIAL')
        expect(result.branch.choicePrompt).toBe('Apa yang Maya lakukan sekarang?')
        expect(result.branch.choices).toHaveLength(2)
        expect(result.repairAttempts).toBe(0)
        expect(result.validationFindings).toEqual([])
      }

      expect(selectProvider).toHaveBeenCalledTimes(1)
      expect(generateChoiceBranch).toHaveBeenCalledTimes(1)
    })

    it('returns PROVIDER_FAILED when generateChoiceBranch returns null', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const selectProvider = vi.fn().mockResolvedValue({ name: 'test' })
      const generateChoiceBranch = vi.fn().mockResolvedValue(null)
      const deps: ChoiceBuildDeps = { selectProvider, generateChoiceBranch }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(12)
      const brief = mockBrief(snapshot, 12)

      const result = await buildChoiceBranch(deps, {
        snapshot,
        draft,
        chapterNumber: 12,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('PROVIDER_FAILED')
        expect(result.validationFindings.some((f) => f.code === 'NULL_BRANCH')).toBe(true)
        expect(result.repairAttempts).toBe(0)
      }
    })

    it('returns PROVIDER_FAILED when provider throws', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const selectProvider = vi.fn().mockRejectedValue(new Error('LLM timeout'))
      const generateChoiceBranch = vi.fn()
      const onChoiceFallback = vi.fn()
      const deps: ChoiceBuildDeps = {
        selectProvider,
        generateChoiceBranch,
        telemetry: { onChoiceFallback },
      }

      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(12)
      const brief = mockBrief(snapshot, 12)

      const result = await buildChoiceBranch(deps, {
        snapshot,
        draft,
        chapterNumber: 12,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('PROVIDER_FAILED')
        expect(result.validationFindings.some((f) => f.code === 'PROVIDER_ERROR')).toBe(true)
        expect(result.repairAttempts).toBe(0)
      }

      // Telemetry callback fires
      expect(onChoiceFallback).toHaveBeenCalledWith({
        chapterNumber: 12,
        reason: 'provider_error',
      })
    })

    it('returns FINAL_CHAPTER for chapter 50 without calling provider', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const selectProvider = vi.fn()
      const generateChoiceBranch = vi.fn()
      const deps: ChoiceBuildDeps = { selectProvider, generateChoiceBranch }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(50)
      const brief = mockBrief(snapshot, 50)

      const result = await buildChoiceBranch(deps, {
        snapshot,
        draft,
        chapterNumber: 50,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('FINAL_CHAPTER')
        expect(result.validationFindings.some((f) => f.code === 'FINAL_CHAPTER_NO_CHOICES')).toBe(true)
      }

      // Provider is never called
      expect(selectProvider).not.toHaveBeenCalled()
      expect(generateChoiceBranch).not.toHaveBeenCalled()
    })

    it('passes real routeState, choiceHistory, lockedEndingKey through to generateChoiceBranch', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const selectProvider = vi.fn().mockResolvedValue({ name: 'test' })
      const generateChoiceBranch = vi.fn().mockResolvedValue(mockBranch())
      const deps: ChoiceBuildDeps = { selectProvider, generateChoiceBranch }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(12)
      const brief = mockBrief(snapshot, 12)

      const routeState = normalizeRouteState({ truth: 5, risk: 2 })
      const choiceHistory: ChoiceHistoryEntry[] = [
        {
          chapterNumber: 3,
          choiceId: 'open-chest',
          label: 'Buka peti harta',
          consequence: ['Kau menemukan surat wasiat.'],
          effectSummary: { truth: 1, risk: 0, secrecy: 0, empathy: 0, flagsSet: ['found-chest'] },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]

      await buildChoiceBranch(deps, {
        snapshot,
        draft,
        chapterNumber: 12,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState,
        choiceHistory,
        lockedEndingKey: 'secret-ending-a',
        providerContext: { correlationId: 'test' },
      })

      expect(generateChoiceBranch).toHaveBeenCalledTimes(1)
      const callArgs = generateChoiceBranch.mock.calls[0] as unknown[]
      const input = callArgs[1] as Record<string, unknown>

      const rs = input.routeState as Record<string, number>
      expect(rs.truth).toBe(5)
      expect(rs.risk).toBe(2)

      const history = input.choiceHistory as ChoiceHistoryEntry[]
      expect(history).toHaveLength(1)
      expect(history[0].choiceId).toBe('open-chest')

      expect(input.lockedEndingKey).toBe('secret-ending-a')
    })

    it('does NOT require a database connection (unit-testable pure)', async () => {
      // Verify the module can be fully tested without Supabase/DB mocks beyond
      // what server-only flag requires. The mock for @lakoku/db covers it.
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      expect(typeof buildChoiceBranch).toBe('function')
    })
  })

  describe('ChoiceBuildDeps interface', () => {
    it('allows minimal deps (only selectProvider + generateChoiceBranch)', () => {
      const deps: ChoiceBuildDeps = {
        selectProvider: async () => ({ name: 'test' }) as never,
        generateChoiceBranch: async () => mockBranch() as never,
      }
      expect(typeof deps.selectProvider).toBe('function')
      expect(typeof deps.generateChoiceBranch).toBe('function')
      expect(deps.repairChoiceBranch).toBeUndefined()
      expect(deps.telemetry).toBeUndefined()
    })

    it('allows optional repairChoiceBranch and telemetry', () => {
      const repairChoiceBranch = vi.fn()
      const telemetry = { onChoiceFallback: vi.fn() }
      const deps: ChoiceBuildDeps = {
        selectProvider: async () => ({ name: 'test' }) as never,
        generateChoiceBranch: async () => mockBranch() as never,
        repairChoiceBranch,
        telemetry,
      }
      expect(typeof deps.repairChoiceBranch).toBe('function')
      expect(typeof deps.telemetry!.onChoiceFallback).toBe('function')
    })
  })

  describe('BuildChoiceBranchInput', () => {
    it('accepts all required fields', async () => {
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(12)
      const brief = mockBrief(snapshot, 12)

      const input: BuildChoiceBranchInput = {
        snapshot,
        draft,
        chapterNumber: 12,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
      }
      expect(input.chapterNumber).toBe(12)
      expect(input.snapshot).toBeDefined()
    })

    it('accepts optional totalChapters', async () => {
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(12)
      const brief = mockBrief(snapshot, 12)

      const input: BuildChoiceBranchInput = {
        snapshot,
        draft,
        chapterNumber: 12,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
        totalChapters: 30,
      }
      expect(input.totalChapters).toBe(30)
    })
  })

  describe('Phase 3 — unified standard/personalized narrative context', () => {
    it('emptyChoiceNarrativeContext is the single default factory', async () => {
      const {
        emptyChoiceNarrativeContext,
      } = await import('@/lib/runtime/choice-context')
      const a = emptyChoiceNarrativeContext()
      const b = emptyChoiceNarrativeContext()
      expect(a).toEqual(b)
      expect(a.routeState.truth).toBe(0)
      expect(a.choiceHistory).toEqual([])
      expect(a.previousChoice).toBeNull()
      expect(a.lockedEndingKey).toBeNull()
    })

    it('choiceNarrativeContextFromReader forwards route state, history, previous, lock', async () => {
      const { choiceNarrativeContextFromReader } = await import(
        '@/lib/runtime/choice-context'
      )
      const ctx = choiceNarrativeContextFromReader({
        route_state: { truth: 4, risk: 1, secrecy: 0, empathy: 2 },
        choice_history: [
          {
            chapterNumber: 2,
            choiceId: 'open-door',
            label: 'Buka pintu',
            consequence: ['Pintu berderit.'],
            effectSummary: {
              truth: 1,
              risk: 0,
              secrecy: 0,
              empathy: 0,
              flagsSet: [],
            },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            chapterNumber: 3,
            choiceId: 'hide',
            label: 'Bersembunyi',
            consequence: ['Nafas tertahan.'],
            effectSummary: {
              truth: 0,
              risk: 1,
              secrecy: 1,
              empathy: 0,
              flagsSet: [],
            },
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        locked_ending_key: 'ending-truth',
        triggerChoiceId: 'open-door',
      })
      expect(ctx.routeState.truth).toBe(4)
      expect(ctx.routeState.risk).toBe(1)
      expect(ctx.choiceHistory).toHaveLength(2)
      expect(ctx.previousChoice?.choiceId).toBe('open-door')
      expect(ctx.lockedEndingKey).toBe('ending-truth')
    })

    it('buildChoiceBranch receives non-empty standard narrative context when provided', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const generateChoiceBranch = vi.fn(async () => mockBranch(12))
      const deps: ChoiceBuildDeps = {
        selectProvider: async () => ({ name: 'test' }) as never,
        generateChoiceBranch,
      }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const brief = mockBrief(snapshot, 12)
      const routeState = normalizeRouteState({ truth: 7, risk: 3, secrecy: 1 })

      await buildChoiceBranch(deps, {
        snapshot,
        draft: mockDraft(12),
        chapterNumber: 12,
        chapterBrief: brief,
        routeState,
        choiceHistory: [
          {
            chapterNumber: 5,
            choiceId: 'inspect',
            label: 'Periksa jejak',
            consequence: ['Jejak basah.'],
            effectSummary: {
              truth: 1,
              risk: 0,
              secrecy: 0,
              empathy: 0,
              flagsSet: [],
            },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        previousChoice: {
          chapterNumber: 5,
          choiceId: 'inspect',
          label: 'Periksa jejak',
          consequence: ['Jejak basah.'],
          effectSummary: {
            truth: 1,
            risk: 0,
            secrecy: 0,
            empathy: 0,
            flagsSet: [],
          },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        lockedEndingKey: 'ending-a',
        providerContext: {},
      })

      const sent = generateChoiceBranch.mock.calls[0][1] as {
        routeState: { truth: number; risk: number }
        choiceHistory: unknown[]
        lockedEndingKey: string | null
      }
      expect(sent.routeState.truth).toBe(7)
      expect(sent.routeState.risk).toBe(3)
      expect(sent.choiceHistory).toHaveLength(1)
      expect(sent.lockedEndingKey).toBe('ending-a')
    })
  })

  describe('Phase 2 — final repaired prose as source of truth', () => {
    it('buildEndingParagraphs uses only final draft paragraphs (last 3–5)', async () => {
      const { buildEndingParagraphs } = await import('@/lib/runtime/choice-context')
      const paragraphs = [
        'Awal yang tidak relevan.',
        'Setup lama yang sudah lewat.',
        'Maya di gudang arsip basah.',
        'Suara langkah dari tangga.',
        'Pintu besi terbuka setengah.',
        'Kalung ibu tergantung di gagang.',
        'Nara menahan napas.',
      ]
      const ending = buildEndingParagraphs(paragraphs, 'Judul')
      expect(ending.length).toBeGreaterThanOrEqual(3)
      expect(ending.length).toBeLessThanOrEqual(5)
      expect(ending).toEqual(paragraphs.slice(-5))
      expect(ending.join(' ')).toContain('Kalung ibu')
      expect(ending.join(' ')).not.toContain('tidak relevan')
      expect(ending.join(' ')).not.toContain('Setup lama')
    })

    it('sends exact final paragraphs to generateChoiceBranch, not pre-repair text', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const preRepair = mockDraft(12)
      preRepair.paragraphs = [
        'Draft awal: Nara belum menemukan apa-apa.',
        'Draft awal: Lorong masih gelap.',
        'Draft awal: Tidak ada petunjuk.',
        'Draft awal: Hanya debu.',
        'Draft awal: Nara ragu.',
      ]
      const finalRepaired = mockDraft(12)
      finalRepaired.paragraphs = [
        'Nara menahan napas di balik lemari.',
        'Pintu besi terbuka setengah jengkal.',
        'Langkah sepatu semakin dekat dari tangga.',
        'Kalung milik ibunya tergantung di gagang.',
        'Nara harus memilih sekarang.',
      ]
      finalRepaired.title = 'Bab 12: Kalung di Pintu Besi'

      const generateChoiceBranch = vi.fn(async (_deps, input) => {
        expect(input.draft.paragraphs).toEqual(finalRepaired.paragraphs)
        expect(input.draft.title).toBe(finalRepaired.title)
        expect(input.lastParagraphs).toEqual(finalRepaired.paragraphs.slice(-5))
        expect(input.lastParagraphs.join(' ')).toContain('Kalung milik ibunya')
        expect(input.lastParagraphs.join(' ')).not.toContain('Draft awal')
        return mockBranch(12)
      })
      const deps: ChoiceBuildDeps = {
        selectProvider: async () => ({ name: 'test' }) as never,
        generateChoiceBranch,
      }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const brief = mockBrief(snapshot, 12)

      // Caller only has finalRepaired after generateChapter PUBLISHED — never preRepair.
      const result = await buildChoiceBranch(deps, {
        snapshot,
        draft: finalRepaired,
        chapterNumber: 12,
        chapterBrief: brief,
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
      })

      expect(result.ok).toBe(true)
      expect(generateChoiceBranch).toHaveBeenCalledTimes(1)
      // Prove pre-repair was never sent
      const sent = generateChoiceBranch.mock.calls[0][1] as {
        draft: ChapterDraftParsed
        lastParagraphs: string[]
      }
      expect(sent.draft.paragraphs).not.toEqual(preRepair.paragraphs)
      expect(sent.lastParagraphs.some((p) => p.includes('Draft awal'))).toBe(false)
    })

    it('groundedChoiceProseFromFinalDraft derives ending from final draft only', async () => {
      const { groundedChoiceProseFromFinalDraft } = await import(
        '@/lib/runtime/choice-context'
      )
      const finalDraft = mockDraft(12)
      finalDraft.paragraphs = [
        'P1 irrelevant setup',
        'P2 Nara di tangga',
        'P3 pintu besi',
        'P4 kalung ibu',
        'P5 langkah mendekat',
      ]
      const grounded = groundedChoiceProseFromFinalDraft(finalDraft)
      expect(grounded.finalChapter.title).toBe(finalDraft.title)
      expect(grounded.finalChapter.paragraphs).toEqual(finalDraft.paragraphs)
      expect(grounded.endingParagraphs).toEqual(finalDraft.paragraphs.slice(-5))
    })
  })

  describe('ending-policy guard', () => {
    it('rejects choice generation for chapter >= totalChapters with custom total', async () => {
      const { buildChoiceBranch } = await import('@/lib/runtime/choice-generation')
      const selectProvider = vi.fn()
      const generateChoiceBranch = vi.fn()
      const deps: ChoiceBuildDeps = { selectProvider, generateChoiceBranch }
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()
      const draft = mockDraft(30)
      const brief = mockBrief(snapshot, 30)

      const result = await buildChoiceBranch(deps, {
        snapshot,
        draft,
        chapterNumber: 30,
        chapterBrief: brief,
        lastParagraphs: draft.paragraphs.slice(-5) as [string,string,string,string,string],
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
        providerContext: {},
        totalChapters: 30,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('FINAL_CHAPTER')
      }
      expect(selectProvider).not.toHaveBeenCalled()
    })
  })
})
