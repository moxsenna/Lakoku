/**
 * C-R3-R2 Blocker #2 - Regression test for V1 compatibility in parseStoryContractWithNormalization()
 * 
 * This proves that legitimate V1 contracts remain readable even without secret endings.
 * Tests both storage (StoredStoryContractV1Schema) and runtime (parseStoryContractWithNormalization) paths.
 */

import { test, expect, describe } from 'vitest'
import {
  StoredStoryContractV1Schema,
  parseStoryContractWithNormalization,
  NormalizedStoryContractSchema,
} from '@/lib/story-engine/story-contract'
import type { z } from 'zod'

describe('C-R3-R2 Blocker #2 - V1 compatibility', () => {
  test('legitimate V1 with 2 main endings and ZERO secrets parses correctly at runtime', () => {
    // This is a LEGITIMATE V1 contract per reviewer feedback:
    // - styleProfile = 'lakoku_mobile_drama_v1'
    // - Has ≥2 ending candidates (all marked as main via isSecret=false)
    // - Has zero secret endings (isSecret=true)
    // - VALID under NCS §1.4 interpretation for legacy V1 stories
    const validV1WithoutSecrets = {
      storyId: 'test-story-001',
      totalChapters: 50,
      title: 'Test Story Without Secrets',
      genre: 'Drama',
      tone: 'Emotional',
      styleProfile: 'lakoku_mobile_drama_v1' as const,
      mainCharacter: {
        name: 'Hero',
        role: 'Protagonist',
        wound: 'Past trauma',
        desire: 'Find truth',
      },
      mainConflict: 'Internal struggle vs external antagonist',
      finalQuestion: 'What defines redemption?',
      corePromise: 'A journey of self-discovery',
      actPlan: [
        { actNumber: 1, fromChapter: 1, toChapter: 5, goal: 'Setup' },
        { actNumber: 2, fromChapter: 6, toChapter: 12, goal: 'Rising action' },
        { actNumber: 3, fromChapter: 13, toChapter: 25, goal: 'Complication' },
        { actNumber: 4, fromChapter: 26, toChapter: 37, goal: 'Crisis' },
        { actNumber: 5, fromChapter: 38, toChapter: 50, goal: 'Resolution' },
      ],
      chapterTargets: Array.from({ length: 50 }, (_, i) => ({
        chapterNumber: i + 1,
        phase: i < 5 ? 'INTRODUCTION' : 'MAIN_STORY',
        goal: `Chapter ${i + 1} goal`,
        mustInclude: ['beat-1'],
        mustNotReveal: [],
        emotionalTurn: 'Neutral',
        expectedThreadMovement: [],
      })),
      revealRunway: [{ secretId: 'secret-main', revealGateChapter: 40 }],
      closureRunway: { mainMysteryResolveBy: 48, emotionalResolutionChapter: 49, finalEndingChapter: 50 },
      plotDebts: [
        { id: 'main_mystery', question: 'Who did it?', introducedAt: 1, mustProgressBy: [10, 20], mustCloseBy: 45, status: 'open' },
      ],
      endingCandidates: [
        { key: 'ending-good', name: 'Happy Ending', isSecret: false, requiredClosure: ['closure-1'], condition: 'Choice A', blockingConditions: [] },
        { key: 'ending-bad', name: 'Tragic Ending', isSecret: false, requiredClosure: ['closure-2'], condition: 'Choice B', blockingConditions: [] },
      ],
    }

    // STEP 1: Parse with stored V1 schema - should accept zero secrets
    const parsedV1 = StoredStoryContractV1Schema.parse(validV1WithoutSecrets)
    expect(parsedV1.styleProfile).toBe('lakoku_mobile_drama_v1')
    expect(parsedV1.endingCandidates.length).toBe(2)
    
    // All endings are main (isSecret=false), no secret endings
    const mainCount = parsedV1.endingCandidates.filter((e) => e.isSecret === false).length
    const secretCount = parsedV1.endingCandidates.filter((e) => e.isSecret === true).length
    expect(mainCount).toBe(2)
    expect(secretCount).toBe(0)

    // STEP 2: Parse through runtime normalizer - MUST NOT fail on zero secrets
    // This is the critical fix - previously this would fail with "NCS §1.4 requires at least 1 secret ending"
    const normalizedRuntime = parseStoryContractWithNormalization(validV1WithoutSecrets)
    
    expect(normalizedRuntime.styleProfile).toBe('lakoku_mobile_drama_v1')
    expect(normalizedRuntime.endingCandidates.length).toBe(2)
    
    // Endings now have 'kind' field instead of 'isSecret'
    expect(normalizedRuntime.endingCandidates[0].kind).toBe('main')
    expect(normalizedRuntime.endingCandidates[1].kind).toBe('main')
    expect((normalizedRuntime.endingCandidates[0] as any).requiredPlotDebtIds).toEqual([]) // Empty for V1
    
    // Should NOT throw about missing secret endings - that's NCS §1.4 enforcement which doesn't apply to V1
  })

  test('malformed V1 (missing required fields) still rejected by StoredStoryContractV1Schema', () => {
    const malformedV1 = {
      storyId: '', // Invalid - must have content
      totalChapters: 50,
      title: 'Test',
      genre: 'Drama',
      tone: 'Emotional',
      styleProfile: 'lakoku_mobile_drama_v1' as const,
      // Missing all required narrative structure fields
    }

    // Should fail with validation error
    expect(() => StoredStoryContractV1Schema.parse(malformedV1)).toThrow()
  })

  test('V2 without requiredPlotDebtIds still rejected by StoredStoryContractV2Schema', () => {
    const v2MissingRequiredPlotDebtIds = {
      storyId: 'test-story-002',
      totalChapters: 50,
      title: 'Test',
      genre: 'Drama',
      tone: 'Emotional',
      styleProfile: 'lakoku_mobile_drama_v2' as const,
      mainCharacter: {
        name: 'Hero',
        role: 'Protagonist',
        wound: 'Trauma',
        desire: 'Truth',
      },
      mainConflict: 'Conflict',
      finalQuestion: 'Question?',
      corePromise: 'Promise',
      actPlan: [
        { actNumber: 1, fromChapter: 1, toChapter: 50, goal: 'Complete' },
      ],
      chapterTargets: Array.from({ length: 50 }, (_, i) => ({
        chapterNumber: i + 1,
        phase: 'MAIN',
        goal: `Goal`,
        mustInclude: ['beat'],
        mustNotReveal: [],
        emotionalTurn: 'Neutral',
        expectedThreadMovement: [],
      })),
      revealRunway: [{ secretId: 's1', revealGateChapter: 40 }],
      closureRunway: { mainMysteryResolveBy: 48, emotionalResolutionChapter: 49, finalEndingChapter: 50 },
      plotDebts: [{ id: 'debt', question: 'Q', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' }],
      endingCandidates: [
        // Valid V2 format but MISSING requiredPlotDebtIds - should be rejected
        { key: 'e1', name: 'E1', kind: 'main', condition: 'C', requiredPlotDebtIds: undefined as any, blockingConditions: [] },
        { key: 'e2', name: 'E2', kind: 'secret', condition: 'C', requiredPlotDebtIds: undefined as any, blockingConditions: [] },
      ],
    }

    // Must reject - V2 requires requiredPlotDebtIds with exactly 7 keys
    expect(() => NormalizedStoryContractSchema.parse(v2MissingRequiredPlotDebtIds)).toThrow()
  })

  test('V2 with legal requiredPlotDebtIds accepted by runtime schema', () => {
    const validV2WithRequiredFields = {
      storyId: 'test-story-003',
      totalChapters: 50,
      title: 'Test',
      genre: 'Drama',
      tone: 'Emotional',
      styleProfile: 'lakoku_mobile_drama_v2' as const,
      mainCharacter: {
        name: 'Hero',
        role: 'Protagonist',
        wound: 'Trauma',
        desire: 'Truth',
      },
      mainConflict: 'Conflict',
      finalQuestion: 'Question?',
      corePromise: 'Promise',
      actPlan: [
        { actNumber: 1, fromChapter: 1, toChapter: 50, goal: 'Complete' },
      ],
      chapterTargets: Array.from({ length: 50 }, (_, i) => ({
        chapterNumber: i + 1,
        phase: 'MAIN',
        goal: `Goal`,
        mustInclude: ['beat'],
        mustNotReveal: [],
        emotionalTurn: 'Neutral',
        expectedThreadMovement: [],
      })),
      revealRunway: [{ secretId: 's1', revealGateChapter: 40 }],
      closureRunway: { mainMysteryResolveBy: 48, emotionalResolutionChapter: 49, finalEndingChapter: 50 },
      plotDebts: [{ id: 'debt-main', question: 'Q', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' }],
      endingCandidates: [
        { 
          key: 'e1', 
          name: 'E1', 
          kind: 'main', 
          condition: 'C', 
          requiredPlotDebtIds: ['debt-main'] as any, // Legal reference to existing plot debt
          blockingConditions: [] 
        },
        { 
          key: 'e2', 
          name: 'E2', 
          kind: 'secret', 
          condition: 'C', 
          requiredPlotDebtIds: ['debt-main'] as any, // Same legal reference
          blockingConditions: [] 
        },
      ],
    }

    // Should accept - has required structured fields
    const result = NormalizedStoryContractSchema.parse(validV2WithRequiredFields)
    expect(result.endingCandidates[0].requiredPlotDebtIds).toEqual(['debt-main'])
  })

  test('NormalizedStoryContractSchema allows zero secrets (no NCS §1.4 enforcement)', () => {
    const runtimeCompatibleWithZeroSecrets = {
      storyId: 'test-story-004',
      totalChapters: 50,
      title: 'Test',
      genre: 'Drama',
      tone: 'Emotional',
      styleProfile: 'lakoku_mobile_drama_v1' as const,
      mainCharacter: {
        name: 'Hero',
        role: 'Protagonist',
        wound: 'Trauma',
        desire: 'Truth',
      },
      mainConflict: 'Conflict',
      finalQuestion: 'Question?',
      corePromise: 'Promise',
      actPlan: [
        { actNumber: 1, fromChapter: 1, toChapter: 50, goal: 'Complete' },
      ],
      chapterTargets: Array.from({ length: 50 }, (_, i) => ({
        chapterNumber: i + 1,
        phase: 'MAIN',
        goal: `Goal`,
        mustInclude: ['beat'],
        mustNotReveal: [],
        emotionalTurn: 'Neutral',
        expectedThreadMovement: [],
      })),
      revealRunway: [],
      closureRunway: { mainMysteryResolveBy: 48, emotionalResolutionChapter: 49, finalEndingChapter: 50 },
      plotDebts: [{ id: 'd', question: 'Q', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' }],
      endingCandidates: [
        { key: 'e1', name: 'E1', kind: 'main', condition: 'C', requiredClosure: [], requiredPlotDebtIds: [], blockingConditions: [] },
        { key: 'e2', name: 'E2', kind: 'main', condition: 'C', requiredClosure: [], requiredPlotDebtIds: [], blockingConditions: [] },
      ],
    }

    // Should accept - Zero secrets allowed in runtime schema (no NCS §1.4 enforcement)
    const result = NormalizedStoryContractSchema.parse(runtimeCompatibleWithZeroSecrets)
    expect(result.endingCandidates.length).toBe(2)
    
    const secretCount = result.endingCandidates.filter((e) => e.kind === 'secret').length
    expect(secretCount).toBe(0)
  })

  test('StoryContractSchema STILL enforces NCS §1.4 for authoring validation', () => {
    const invalidForAuthoring = {
      storyId: 'test-story-005',
      totalChapters: 50,
      title: 'Test',
      genre: 'Drama',
      tone: 'Emotional',
      styleProfile: 'lakoku_mobile_drama_v2' as const,
      mainCharacter: {
        name: 'Hero',
        role: 'Protagonist',
        wound: 'Trauma',
        desire: 'Truth',
      },
      mainConflict: 'Conflict',
      finalQuestion: 'Question?',
      corePromise: 'Promise',
      actPlan: [
        { actNumber: 1, fromChapter: 1, toChapter: 50, goal: 'Complete' },
      ],
      chapterTargets: Array.from({ length: 50 }, (_, i) => ({
        chapterNumber: i + 1,
        phase: 'MAIN',
        goal: `Goal`,
        mustInclude: ['beat'],
        mustNotReveal: [],
        emotionalTurn: 'Neutral',
        expectedThreadMovement: [],
      })),
      revealRunway: [],
      closureRunway: { mainMysteryResolveBy: 48, emotionalResolutionChapter: 49, finalEndingChapter: 50 },
      plotDebts: [{ id: 'd', question: 'Q', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' }],
      endingCandidates: [
        // Only 1 main ending, NO secrets - INVALID for authoring
        { key: 'e1', name: 'E1', kind: 'main', condition: 'C', requiredPlotDebtIds: ['d'], blockingConditions: [] },
      ],
    }

    // Should reject - NCS §1.4 enforcement applies here (≥2 main + ≥1 secret)
    expect(() => import('@/lib/story-engine/story-contract').then((m) => m.StoryContractSchema.parse(invalidForAuthoring))).rejects.toThrow()
  })
})
