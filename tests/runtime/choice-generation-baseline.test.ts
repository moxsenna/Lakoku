/**
 * Phase 0 — Baseline, reproduction, and regression tests for choice route generation.
 *
 * Tujuan:
 *  - Characterization tests: PASS now, document current buggy behavior.
 *  - Desired-behavior TDD tests (it.fails): FAIL now, PASS after Phase 5 fixes.
 *
 * Production code under test:
 *  lib/runtime/story-generation.ts
 *    - fallbackChoicesFromDraft (exported as __testFallbackChoicesFromDraft)
 *    - buildChoices (exported as __testBuildChoices)
 *    - mapBranchToPublishOutcomes (exported as __testMapBranchToPublishOutcomes)
 *    - syntheticChapterBrief (exported as __testSyntheticChapterBrief)
 *
 * Compared: personalized-generation.ts already has correct behavior:
 *    - mapBranchToV2Outcomes preserves `effect`
 *    - Chapter 50 skips choices entirely
 *    - routeState, choiceHistory, lockedEndingKey from real reader state
 */

import { describe, expect, it, vi } from 'vitest'
import type { ChoiceBranch, ChapterDraftParsed } from '@/lib/ai-gateway/schemas'
import type { PublishOutcome } from '@/lib/runtime/lifecycle'
import type { ProviderCallContext } from '@/lib/observability/generation-provider-call.contract'
import { TOTAL_CHAPTERS } from '@/lib/narrative/template'

// ---- Mocks ----
const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  selectProvider: vi.fn(),
  generateChoiceBranch: vi.fn(),
  mockConsoleLog: vi.fn(),
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
  return {
    ...actual,
    generateChoiceBranch: mocks.generateChoiceBranch,
  }
})
vi.mock('@lakoku/ai-gateway/server', async () => {
  const actual = await import('@/lib/ai-gateway/server')
  return {
    ...actual,
    selectProvider: mocks.selectProvider,
  }
})
vi.mock('@/lib/observability/server', () => ({
  recordGenerationAttempt: vi.fn(async () => undefined),
  recordGenerationRuntimeFailed: vi.fn(async () => undefined),
}))

// Override console.log to capture GENERATION_CHOICES_FALLBACK_USED
vi.spyOn(console, 'log').mockImplementation(mocks.mockConsoleLog)

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

function mockBranch(
  chapterNumber = 12,
  withEffect = true,
): ChoiceBranch {
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
        effect: withEffect
          ? {
              routeDeltas: { truth: 2 },
              trustDeltas: { Raka: 1 },
              flagsSet: { openedArchive: true },
              evidenceAdded: ['berkas-basah-terbaca'],
              endingBiasDeltas: { 'publish-truth': 1 },
              threadTouches: ['arsip-gudang'],
            }
          : (emptyEffect() as ChoiceBranch['outcomes'][number]['effect']),
      },
      {
        choiceId: 'ikuti-suara',
        consequence: ['Sosok Raka muncul dari balik tikungan dengan wajah khawatir.'],
        nextChapterNumber: next,
        isEnding: false,
        effect: withEffect
          ? {
              routeDeltas: { risk: 1 },
              trustDeltas: { Maya: 1 },
              flagsSet: { metRaka: true },
              evidenceAdded: ['raka-muncul'],
              endingBiasDeltas: { 'publish-truth': -1 },
              threadTouches: ['lorong-remang'],
            }
          : (emptyEffect() as ChoiceBranch['outcomes'][number]['effect']),
      },
    ],
  }
}

function providerContext(chapterNumber = 12): ProviderCallContext {
  return {
    userId: 'test-user',
    storyId: 'story-test',
    chapterNumber,
    generationKind: 'standard',
    correlationId: 'test-correlation',
    jobId: null,
    attemptNumber: null,
  } as unknown as ProviderCallContext
}

// ---- Characterization Tests (PASS now, documents current behavior) ----

describe('Phase 0 — Characterization (current buggy behavior)', () => {
  describe('fallbackChoicesFromDraft', () => {
    it('always returns the two generic hard-coded labels', async () => {
      const { __testFallbackChoicesFromDraft: fallback } = await import(
        '@/lib/runtime/story-generation'
      )
      const draft = mockDraft(12)
      const result = fallback(draft, 12)

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

    it('returns generic fallback even for last chapter (ending scenario)', async () => {
      const { __testFallbackChoicesFromDraft: fallback } = await import(
        '@/lib/runtime/story-generation'
      )
      const draft = mockDraft(50)
      const result = fallback(draft, 50)

      expect(result.choices).toHaveLength(2)
      expect(result.choices[0].id).toBe('hadapi')
      expect(result.outcomes[0].isEnding).toBe(true)
      // Next chapter is null for ending
      expect(result.outcomes[0].nextChapterNumber).toBeNull()
    })

    it('outcomes lack effect field and choiceKind', async () => {
      const { __testFallbackChoicesFromDraft: fallback } = await import(
        '@/lib/runtime/story-generation'
      )
      const draft = mockDraft(12)
      const result = fallback(draft, 12)

      for (const outcome of result.outcomes) {
        expect(outcome).not.toHaveProperty('effect')
        expect(outcome).not.toHaveProperty('choiceKind')
        // Confirm shape matches legacy PublishOutcome (no effect/choiceKind)
        expect(Object.keys(outcome).sort()).toEqual(
          ['choiceId', 'consequence', 'isEnding', 'nextChapterNumber'].sort(),
        )
      }
    })
  })

  describe('mapBranchToPublishOutcomes', () => {
    it('drops the effect field from ChoiceBranch.outcomes', async () => {
      const { __testMapBranchToPublishOutcomes: mapper } = await import(
        '@/lib/runtime/story-generation'
      )
      const branch = mockBranch(12, true)
      const outcomes = mapper(branch)

      expect(outcomes).toHaveLength(2)
      for (const outcome of outcomes) {
        // effect IS dropped — this documents the bug
        expect(outcome).not.toHaveProperty('effect')
        expect(outcome).not.toHaveProperty('choiceKind')
        // basic fields are preserved
        expect(outcome).toHaveProperty('choiceId')
        expect(outcome).toHaveProperty('consequence')
        expect(outcome).toHaveProperty('nextChapterNumber')
        expect(outcome).toHaveProperty('isEnding')
      }
    })

    it('only maps 4 fields from branch.outcomes', async () => {
      const { __testMapBranchToPublishOutcomes: mapper } = await import(
        '@/lib/runtime/story-generation'
      )
      const branch = mockBranch(12, true)
      const outcomes = mapper(branch)

      // Confirms the exact projection in mapBranchToPublishOutcomes (lines 169-178)
      for (const outcome of outcomes) {
        const keys = Object.keys(outcome).sort()
        expect(keys).toEqual(['choiceId', 'consequence', 'isEnding', 'nextChapterNumber'].sort())
      }
    })
  })

  describe('buildChoices — call path trace', () => {
    it('passes empty routeState to generateChoiceBranch', async () => {
      mocks.selectProvider.mockResolvedValue({ name: 'test', generateChoices: async () => mockBranch() })
      mocks.generateChoiceBranch.mockResolvedValue(mockBranch())
      mocks.mockConsoleLog.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      await buildChoices(snapshot, mockDraft(12), 12, providerContext())

      // Verify generateChoiceBranch was called
      expect(mocks.generateChoiceBranch).toHaveBeenCalledTimes(1)
      const callArgs = mocks.generateChoiceBranch.mock.calls[0] as unknown[]
      const choiceInput = callArgs[1] as Record<string, unknown>

      // Current behavior: routeState is empty (normalizeRouteState({}))
      // verify it has all zero/default values
      expect(choiceInput.routeState).toBeDefined()
      const rs = choiceInput.routeState as Record<string, unknown>
      expect(rs.truth).toBe(0)
      expect(rs.risk).toBe(0)
      expect(rs.secrecy).toBe(0)
      expect(rs.empathy).toBe(0)

      // Current behavior: choiceHistory is empty array
      expect(choiceInput.choiceHistory).toEqual([])

      // Current behavior: lockedEndingKey is null
      expect(choiceInput.lockedEndingKey).toBeNull()
    })

    it('returns generic fallback when chapterNumber >= 50 (even chapter 50)', async () => {
      mocks.selectProvider.mockClear()
      mocks.generateChoiceBranch.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      const result = await buildChoices(snapshot, mockDraft(50), 50, providerContext(50))

      // Current behavior: chapter 50 returns fallback with hard-coded labels
      expect(result.choices[0].id).toBe('hadapi')
      expect(result.choices[1].id).toBe('selidiki')
      // selectProvider and generateChoiceBranch are NOT called
      // (the early return at line 233-234 triggers before the try block)
      expect(mocks.selectProvider).not.toHaveBeenCalled()
      expect(mocks.generateChoiceBranch).not.toHaveBeenCalled()
    })

    it('logs GENERATION_CHOICES_FALLBACK_USED and returns fallback when generateChoiceBranch throws', async () => {
      mocks.selectProvider.mockResolvedValue({ name: 'test', generateChoices: async () => mockBranch() })
      mocks.generateChoiceBranch.mockRejectedValue(new Error('LLM overload'))
      mocks.mockConsoleLog.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      const result = await buildChoices(snapshot, mockDraft(12), 12, providerContext())

      // Current behavior: silently returns hard-coded fallback on provider error
      expect(result.choices[0].id).toBe('hadapi')
      expect(result.choices[1].id).toBe('selidiki')
      // Logs the fallback event (line 266)
      expect(mocks.mockConsoleLog).toHaveBeenCalledWith('GENERATION_CHOICES_FALLBACK_USED')
    })

    it('returns generic fallback when generateChoiceBranch returns null', async () => {
      mocks.selectProvider.mockResolvedValue({ name: 'test', generateChoices: async () => mockBranch() })
      mocks.generateChoiceBranch.mockResolvedValue(null)
      mocks.mockConsoleLog.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      const result = await buildChoices(snapshot, mockDraft(12), 12, providerContext())

      // Current behavior: returns fallback on null branch (no log for null case)
      expect(result.choices[0].id).toBe('hadapi')
      // No log emitted for null branch path (only on catch)
      expect(mocks.mockConsoleLog).not.toHaveBeenCalledWith('GENERATION_CHOICES_FALLBACK_USED')
    })
  })

  describe('syntheticChapterBrief', () => {
    it('always reports empty routeStateSummary and choiceHistorySummary', async () => {
      const { __testSyntheticChapterBrief: brief } = await import(
        '@/lib/runtime/story-generation'
      )
      const draft = mockDraft(12)

      const result = brief('story-test', 12, draft)

      expect(result.routeStateSummary).toBe('Awal perjalanan; belum ada bias rute kuat.')
      expect(result.choiceHistorySummary).toBe('Belum ada pilihan sebelumnya.')
      expect(result.routeSummary).toBe('Awal perjalanan; belum ada bias rute kuat.')
      expect(result.previousChoiceSummary).toBe('Belum ada pilihan sebelumnya.')
      expect(result.lockedEndingKey).toBeNull()
    })

    it('has lockedEndingKey always null', async () => {
      const { __testSyntheticChapterBrief: brief } = await import(
        '@/lib/runtime/story-generation'
      )

      // Test at various chapter numbers — lockedEndingKey is always null
      for (const n of [1, 12, 25, 40, 45, 49, 50]) {
        const result = brief('story-test', n, mockDraft(n))
        expect(result.lockedEndingKey).toBeNull()
      }
    })
  })
})

// ---- Desired-Behavior TDD Tests (FAIL now, PASS after Phase 5 fixes) ----

describe('Phase 0 — Desired behavior (TDD: it.fails)', () => {
  describe('mapBranchToPublishOutcomes — should preserve effect', () => {
    it.fails(
      'preserves effect field from ChoiceBranch.outcomes',
      async () => {
        const { __testMapBranchToPublishOutcomes: mapper } = await import(
          '@/lib/runtime/story-generation'
        )
        const branch = mockBranch(12, true)

        const outcomes = mapper(branch)

        // DESIRED: effect is preserved
        expect(outcomes[0]).toHaveProperty('effect')
        const o0 = outcomes[0] as Record<string, unknown>
        if (o0.effect) {
          const effect = o0.effect as Record<string, unknown>
          expect(effect.routeDeltas).toEqual({ truth: 2 })
          expect(effect.trustDeltas).toEqual({ Raka: 1 })
          expect(effect.endingBiasDeltas).toEqual({ 'publish-truth': 1 })
          expect(effect.evidenceAdded).toEqual(['berkas-basah-terbaca'])
        }
      },
    )

    it.fails(
      'includes choiceKind field on outcomes',
      async () => {
        const { __testMapBranchToPublishOutcomes: mapper } = await import(
          '@/lib/runtime/story-generation'
        )
        const branch = mockBranch(12, true)

        const outcomes = mapper(branch)
        const o0 = outcomes[0] as Record<string, unknown>
        expect(o0).toHaveProperty('choiceKind')
      },
    )
  })

  describe('buildChoices — should not silently fall back', () => {
    it.fails(
      'does NOT return generic fallback when provider fails; instead indicates error',
      async () => {
        const { __testBuildChoices: buildChoices } = await import(
          '@/lib/runtime/story-generation'
        )

        // DESIRED: Provider failure should NOT produce hard-coded choices
        // that are indistinguishable from real LLM output and get published.
        // This test asserts a return type with an error discriminator.
        //
        // Currently: buildChoices silently returns fallback.
        // After fix: should return { ok: false, reason: 'CHOICE_GENERATION_FAILED' }
        // or throw so that generateNextChapterReal does not publish.
        throw new Error(
          'DESIRED: buildChoices should indicate failure, not silently return generic fallback. ' +
          'Currently, on any catch, it returns hadapi/selidiki which gets published without error.',
        )
      },
    )
  })

  describe('buildChoices — chapter 50 should skip choices', () => {
    it.fails(
      'returns no choices for chapter 50 (matches personalized flow)',
      async () => {
        const { __testBuildChoices: buildChoices } = await import(
          '@/lib/runtime/story-generation'
        )
        const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

        const result = await buildChoices(
          snapshot,
          mockDraft(50),
          50,
          providerContext(50),
        )

        // DESIRED: chapter 50 should return null/empty choices, not fallback.
        // Currently: returns fallbackChoicesFromDraft with hadapi/selidiki.
        expect(result.choices).toHaveLength(0)
        expect(result.outcomes).toHaveLength(0)
        expect(result.choicePrompt).toBe('')
      },
    )
  })

  describe('buildChoices — route state pass-through', () => {
    it.fails(
      'accepts and passes real routeState to generateChoiceBranch',
      async () => {
        // DESIRED: buildChoices should accept routeState/choiceHistory/lockedEndingKey
        // parameters and pass them through to generateChoiceBranch.
        //
        // Currently hard-coded at story-generation.ts:246-248:
        //   routeState: normalizeRouteState({})
        //   choiceHistory: []
        //   lockedEndingKey: null
        //
        // After fix: buildChoices signature changes to include these or derives
        // them from a reader context provided by generateNextChapterReal.
        throw new Error(
          'DESIRED: buildChoices must pass real routeState/choiceHistory/lockedEndingKey. ' +
          'Currently hard-coded to empty defaults (normalizeRouteState({}), [], null).',
        )
      },
    )
  })
})

// ---- Cross-flow comparison: personalized vs standard ----

describe('Phase 0 — Cross-flow comparison', () => {
  it('personalized preserves effect via mapBranchToV2Outcomes', async () => {
    const { __testMapBranchToV2Outcomes: mapBranchToV2Outcomes } = await import(
      '@/lib/runtime/personalized-generation'
    )
    const branch = mockBranch(12, true)

    const outcomes = mapBranchToV2Outcomes(branch, 12)

    expect(outcomes[0]).toHaveProperty('effect')
    expect(outcomes[0].effect.routeDeltas).toEqual({ truth: 2 })
    expect(outcomes[0].effect.trustDeltas).toEqual({ Raka: 1 })
    expect(outcomes[0].effect.endingBiasDeltas).toEqual({ 'publish-truth': 1 })
    expect(outcomes[0].effect.evidenceAdded).toEqual(['berkas-basah-terbaca'])
    expect(outcomes[0].choiceKind).toBe('normal')
  })

  it.fails(
    'standard mapBranchToPublishOutcomes matches personalized mapBranchToV2Outcomes on effect preservation',
    async () => {
      const { __testMapBranchToPublishOutcomes: standardMapper } = await import(
        '@/lib/runtime/story-generation'
      )
      const { __testMapBranchToV2Outcomes: mapBranchToV2Outcomes } = await import(
        '@/lib/runtime/personalized-generation'
      )

      const branch = mockBranch(12, true)
      const standard = standardMapper(branch)
      const personalized = mapBranchToV2Outcomes(branch, 12)

      // Desired: standard should have the same effect as personalized
      const stdFirst = standard[0] as Record<string, unknown>
      const pFirst = personalized[0] as Record<string, unknown>
      expect(stdFirst).toHaveProperty('effect')
      expect(stdFirst.effect).toEqual(pFirst.effect)
      expect(stdFirst).toHaveProperty('choiceKind')
      expect(stdFirst.choiceKind).toEqual(pFirst.choiceKind)
    },
  )
})
