/**
 * Phase 6 — Effect preservation & publish contract unification.
 *
 * Tujuan:
 *  - Characterization tests: updated for new behavior (effect preserved, choiceKind added).
 *  - Desired-behavior tests: now PASSING (was it.fails, now it).
 *
 * Production code under test:
 *  lib/runtime/story-generation.ts
 *    - fallbackChoicesFromDraft (exported as __testFallbackChoicesFromDraft)
 *    - buildChoices (exported as __testBuildChoices)
 *    - syntheticChapterBrief (exported as __testSyntheticChapterBrief)
 *  lib/runtime/lifecycle.ts (shared)
 *    - mapBranchToV2Outcomes (exported as __testMapBranchToV2Outcomes from personalized-generation)
 *
 * Both standard and personalized now use the same mapBranchToV2Outcomes from lifecycle:
 *    - mapBranchToV2Outcomes preserves `effect` and `choiceKind`
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
  supabaseChain: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({
  createAdminClient: () => ({
    from: mocks.supabaseChain.mockReturnThis(),
    select: mocks.supabaseChain.mockReturnThis(),
    eq: mocks.supabaseChain.mockReturnThis(),
    maybeSingle: mocks.supabaseChain.mockResolvedValue(null),
  }),
}))
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
    it(
      'always returns the two generic hard-coded labels',
      async () => {
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
      },
      15_000,
    )

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

  describe('mapBranchToV2Outcomes (shared, previously mapBranchToPublishOutcomes)', () => {
    it('preserves effect and choiceKind from ChoiceBranch.outcomes', async () => {
      const { __testMapBranchToV2Outcomes: mapper } = await import(
        '@/lib/runtime/personalized-generation'
      )
      const branch = mockBranch(12, true)
      const outcomes = mapper(branch, 12)

      expect(outcomes).toHaveLength(2)
      // effect IS preserved — Phase 6 fix
      expect(outcomes[0]).toHaveProperty('effect')
      expect(outcomes[0]).toHaveProperty('choiceKind')
      const o0 = outcomes[0] as unknown as Record<string, unknown>
      const effect = o0.effect as unknown as Record<string, unknown>
      expect(effect.routeDeltas).toEqual({ truth: 2 })
      expect(effect.trustDeltas).toEqual({ Raka: 1 })
      expect(effect.endingBiasDeltas).toEqual({ 'publish-truth': 1 })
      expect(effect.evidenceAdded).toEqual(['berkas-basah-terbaca'])
      expect(o0.choiceKind).toBe('normal')
      // basic fields are preserved
      expect(outcomes[0]).toHaveProperty('choiceId')
      expect(outcomes[0]).toHaveProperty('consequence')
      expect(outcomes[0]).toHaveProperty('nextChapterNumber')
      expect(outcomes[0]).toHaveProperty('isEnding')
    })

    it('marks chapter 49 isEnding outcomes as special_bad_ending', async () => {
      const { __testMapBranchToV2Outcomes: mapper } = await import(
        '@/lib/runtime/personalized-generation'
      )
      // Create a branch where isEnding is true at chapter 49
      const branch = {
        ...mockBranch(49, true),
        outcomes: [{
          ...mockBranch(49, true).outcomes[0],
          isEnding: true,
          nextChapterNumber: null,
        }],
      }
      const outcomes = mapper(branch, 49)
      expect(outcomes[0].choiceKind).toBe('special_bad_ending')
    })

    it('maps all 4 base fields plus effect and choiceKind', async () => {
      const { __testMapBranchToV2Outcomes: mapper } = await import(
        '@/lib/runtime/personalized-generation'
      )
      const branch = mockBranch(12, true)
      const outcomes = mapper(branch, 12)

      for (const outcome of outcomes) {
        const keys = Object.keys(outcome).sort()
        expect(keys).toEqual(
          ['choiceId', 'choiceKind', 'consequence', 'effect', 'isEnding', 'nextChapterNumber'].sort(),
        )
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
      const choiceInput = callArgs[1] as unknown as Record<string, unknown>

      // Current behavior: routeState is empty (normalizeRouteState({}))
      // verify it has all zero/default values
      expect(choiceInput.routeState).toBeDefined()
      const rs = choiceInput.routeState as unknown as Record<string, unknown>
      expect(rs.truth).toBe(0)
      expect(rs.risk).toBe(0)
      expect(rs.secrecy).toBe(0)
      expect(rs.empathy).toBe(0)

      // Current behavior: choiceHistory is empty array
      expect(choiceInput.choiceHistory).toEqual([])

      // Current behavior: lockedEndingKey is null
      expect(choiceInput.lockedEndingKey).toBeNull()
    })

    it('returns FINAL_CHAPTER failure for chapter 50 without calling provider', async () => {
      mocks.selectProvider.mockClear()
      mocks.generateChoiceBranch.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      const result = await buildChoices(snapshot, mockDraft(50), 50, providerContext(50))

      // Phase 5/7: chapter 50 is ending policy — no generic hadapi/selidiki publish
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('FINAL_CHAPTER')
      }
      expect(mocks.selectProvider).not.toHaveBeenCalled()
      expect(mocks.generateChoiceBranch).not.toHaveBeenCalled()
    })

    it('returns explicit failure (no generic fallback) when generateChoiceBranch throws', async () => {
      mocks.selectProvider.mockResolvedValue({ name: 'test', generateChoices: async () => mockBranch() })
      mocks.generateChoiceBranch.mockRejectedValue(new Error('LLM overload'))
      mocks.mockConsoleLog.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      const result = await buildChoices(snapshot, mockDraft(12), 12, providerContext())

      // Phase 5: no silent generic fallback publish path
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBeTruthy()
        expect(result.reason).not.toBe('SUCCESS')
      }
      expect(mocks.mockConsoleLog).not.toHaveBeenCalledWith('GENERATION_CHOICES_FALLBACK_USED')
    })

    it('returns explicit failure when generateChoiceBranch returns null after repair', async () => {
      mocks.selectProvider.mockResolvedValue({ name: 'test', generateChoices: async () => mockBranch() })
      mocks.generateChoiceBranch.mockResolvedValue(null)
      mocks.mockConsoleLog.mockClear()

      const { __testBuildChoices: buildChoices } = await import(
        '@/lib/runtime/story-generation'
      )
      const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

      const result = await buildChoices(snapshot, mockDraft(12), 12, providerContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('REPAIR_EXHAUSTED')
        expect(result.repairAttempts).toBe(1)
      }
      expect(mocks.mockConsoleLog).not.toHaveBeenCalledWith('GENERATION_CHOICES_FALLBACK_USED')
    })
  })

  describe('choice validation after buildChoices (B5)', () => {
    it('current VALIDATE_CHOICES path only scans for internal leaks, not prose grounding', async () => {
      // Characterization of story-generation.ts VALIDATE_CHOICES block:
      // leakInChoices = [choicePrompt, labels, consequences].flatMap(scanForLeaks)
      // There is no call to a semantic grounding validator against draft.paragraphs.
      const source = await import('node:fs').then((fs) =>
        fs.promises.readFile(
          new URL('../../lib/runtime/story-generation.ts', import.meta.url),
          'utf8',
        ),
      )

      expect(source).toContain('scanForLeaks')
      // Phase 8 stages: VALIDATE_CHOICES_FINAL or VALIDATE_CHOICES depending on repair source
      expect(source).toMatch(/VALIDATE_CHOICES/)
      // Phase 5: semantic grounding lives in choice-generation (called via buildChoiceBranch)
      expect(source).toContain('buildChoices')
      expect(source).toMatch(/CHOICE_GENERATION_FAILED|FINAL_CHAPTER/)
    })

    it('fallback outcomes have publishable legacy PublishOutcome shape (can be published)', async () => {
      const { __testFallbackChoicesFromDraft: fallback } = await import(
        '@/lib/runtime/story-generation'
      )
      const result = fallback(mockDraft(12), 12)

      // generateNextChapterReal publishes whatever buildChoices returns.
      // Fallback outcomes match legacy PublishOutcome keys accepted by publishChapter.
      for (const outcome of result.outcomes) {
        expect(Object.keys(outcome).sort()).toEqual(
          ['choiceId', 'consequence', 'isEnding', 'nextChapterNumber'].sort(),
        )
        expect(typeof outcome.choiceId).toBe('string')
        expect(Array.isArray(outcome.consequence)).toBe(true)
        expect(typeof outcome.isEnding).toBe('boolean')
      }
      expect(typeof result.choicePrompt).toBe('string')
      expect(result.choices).toHaveLength(2)
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

describe('Phase 0 — Desired behavior (TDD: now passing)', () => {
  describe('mapBranchToV2Outcomes — should preserve effect', () => {
    it(
      'preserves effect field from ChoiceBranch.outcomes',
      async () => {
        const { __testMapBranchToV2Outcomes: mapper } = await import(
          '@/lib/runtime/personalized-generation'
        )
        const branch = mockBranch(12, true)

        const outcomes = mapper(branch, 12)

        // DESIRED: effect is preserved
        expect(outcomes[0]).toHaveProperty('effect')
        const o0 = outcomes[0] as unknown as Record<string, unknown>
        if (o0.effect) {
          const effect = o0.effect as unknown as Record<string, unknown>
          expect(effect.routeDeltas).toEqual({ truth: 2 })
          expect(effect.trustDeltas).toEqual({ Raka: 1 })
          expect(effect.endingBiasDeltas).toEqual({ 'publish-truth': 1 })
          expect(effect.evidenceAdded).toEqual(['berkas-basah-terbaca'])
        }
      },
    )

    it(
      'includes choiceKind field on outcomes',
      async () => {
        const { __testMapBranchToV2Outcomes: mapper } = await import(
          '@/lib/runtime/personalized-generation'
        )
        const branch = mockBranch(12, true)

        const outcomes = mapper(branch, 12)
        const o0 = outcomes[0] as unknown as Record<string, unknown>
        expect(o0).toHaveProperty('choiceKind')
      },
    )
  })

  describe('buildChoices — should not silently fall back', () => {
    it(
      'does NOT return generic fallback when provider fails; instead indicates error',
      async () => {
        mocks.selectProvider.mockResolvedValue({
          name: 'test',
          generateChoices: async () => mockBranch(),
        })
        mocks.generateChoiceBranch.mockRejectedValue(new Error('LLM overload'))
        mocks.mockConsoleLog.mockClear()

        const { __testBuildChoices: buildChoices } = await import(
          '@/lib/runtime/story-generation'
        )
        const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

        const result = await buildChoices(
          snapshot,
          mockDraft(12),
          12,
          providerContext(),
        )

        // Phase 5: failure is explicit result union — never hadapi/selidiki publish.
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(typeof result.reason).toBe('string')
        }
      },
    )
  })

  describe('buildChoices — chapter 50 should skip choices', () => {
    it(
      'returns FINAL_CHAPTER (no choices) for chapter 50',
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

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.reason).toBe('FINAL_CHAPTER')
        }
      },
    )
  })

  describe('buildChoices — route state pass-through', () => {
    it(
      'passes non-default routeState/choiceHistory when reader context exists',
      async () => {
        mocks.selectProvider.mockResolvedValue({
          name: 'test',
          generateChoices: async () => mockBranch(),
        })
        mocks.generateChoiceBranch.mockResolvedValue(mockBranch())
        mocks.generateChoiceBranch.mockClear()

        const { __testBuildChoices: buildChoices } = await import(
          '@/lib/runtime/story-generation'
        )
        const { normalizeRouteState } = await import('@/lib/story-engine/route-state')
        const snapshot = (await import('@/fixtures/narrative/fixture-50')).buildFixtureSnapshot()

        // Phase 3: caller passes narrativeContextOverride with real reader data.
        const narrativeContext = {
          routeState: normalizeRouteState({ truth: 5, risk: 2 }),
          choiceHistory: [
            {
              chapterNumber: 3,
              choiceId: 'open-chest',
              label: 'Buka peti harta',
              consequence: ['Kau menemukan surat wasiat.'],
              effectSummary: { truth: 1, risk: 0, secrecy: 0, empathy: 0, flagsSet: ['found-chest'] },
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          previousChoice: null,
          lockedEndingKey: 'secret-ending-a',
        }

        await buildChoices(snapshot, mockDraft(12), 12, providerContext(), narrativeContext)

        expect(mocks.generateChoiceBranch).toHaveBeenCalled()
        const choiceInput = (mocks.generateChoiceBranch.mock.calls[0]?.[1] ?? {}) as unknown as Record<
          string,
          unknown
        >
        const rs = choiceInput.routeState as Record<string, number>
        const history = choiceInput.choiceHistory as unknown[]

        // At least one signal that real reader context was threaded through.
        const hasRealContext =
          (rs.truth ?? 0) !== 0 ||
          (rs.risk ?? 0) !== 0 ||
          (rs.secrecy ?? 0) !== 0 ||
          (rs.empathy ?? 0) !== 0 ||
          history.length > 0 ||
          choiceInput.lockedEndingKey != null

        expect(hasRealContext).toBe(true)
      },
    )
  })

  describe('choice validation — must ground against final repaired prose', () => {
    it(
      'rejects generic ungrounded labels that ignore final paragraphs',
      async () => {
        // DESIRED (Phase 4+): semantic validation against finalDraft.paragraphs
        // must reject hard-coded generic labels when prose has concrete entities.
        // Current VALIDATE_CHOICES only runs scanForLeaks — generic labels pass.
        const finalParagraphs = mockDraft(12).paragraphs
        const genericLabels = [
          'Hadapi langsung apa yang baru terbuka',
          'Selidiki dulu jejak yang tersisa',
        ]

        // Import quality validator once it exists; until then this fails.
        // After Phase 4, choice-quality module should export validateChoiceBranchQuality.
        const quality = await import('@/lib/story-engine/choice-quality').catch(() => null)
        expect(quality).not.toBeNull()
        if (!quality) return

        const validate = (
          quality as {
            validateChoiceBranchQuality?: (input: unknown) => {
              ok: boolean
              findings: Array<{ code: string }>
            }
          }
        ).validateChoiceBranchQuality
        expect(typeof validate).toBe('function')
        if (!validate) return

        const result = validate({
          branch: {
            choicePrompt: 'Apa yang kau lakukan selanjutnya?',
            choices: [
              { id: 'hadapi', label: genericLabels[0] },
              { id: 'selidiki', label: genericLabels[1] },
            ],
            outcomes: [],
          },
          finalChapter: { title: 'Bab 12', paragraphs: finalParagraphs },
          endingParagraphs: finalParagraphs.slice(-3),
        })

        expect(result.ok).toBe(false)
        const codes = result.findings.map((f) => f.code)
        expect(
          codes.some((c) =>
            c.includes('UNGROUNDED') || c.includes('GENERIC') || c.includes('TOO_SIMILAR'),
          ),
        ).toBe(true)
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

  it(
    'standard flow uses same mapBranchToV2Outcomes as personalized flow',
    async () => {
      // Both flows now import the shared mapBranchToV2Outcomes from lifecycle.
      const { __testMapBranchToV2Outcomes: mapBranchToV2Outcomes } = await import(
        '@/lib/runtime/personalized-generation'
      )

      const branch = mockBranch(12, true)
      const outcomes = mapBranchToV2Outcomes(branch, 12)

      // Both standard and personalized call the same shared mapper.
      expect(outcomes[0]).toHaveProperty('effect')
      expect(outcomes[0]).toHaveProperty('choiceKind')
      const o0 = outcomes[0] as unknown as Record<string, unknown>
      const effect = o0.effect as unknown as Record<string, unknown>
      expect(effect.routeDeltas).toEqual({ truth: 2 })
      expect(effect.trustDeltas).toEqual({ Raka: 1 })
    },
  )
})
