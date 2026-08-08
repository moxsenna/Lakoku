/**
 * C-R3-R2 Blocker #2 - Regression test for V1 compatibility in parseStoryContractWithNormalization()
 * 
 * This proves that legitimate V1 contracts remain readable even without secret endings.
 * Tests both storage (StoredStoryContractV1Schema) and runtime (parseStoryContractWithNormalization) paths.
 */

import { test, expect, describe } from 'vitest'
import {
  StoredStoryContractV1Schema,
  StoredStoryContractV2Schema,
  parseStoryContractWithNormalization,
  NormalizedStoryContractSchema,
} from '@/lib/story-engine/story-contract'

describe('C-R3-R2 Blocker #2 - V1 compatibility', () => {
  // Helper: Full ClosureRunwaySchema (all 6 literal fields required)
  const fullClosureRunway = {
    noNewMajorConflictAfter: 35,
    noNewThreadAfter: 40,
    endingLockChapter: 45,
    mainMysteryResolveBy: 48,
    emotionalResolutionChapter: 49,
    finalEndingChapter: 50,
  } as const

  // Helper: Minimal valid revealRunway (min 1 entry required by schema)
  const minimalRevealRunway = [{ secretId: 'secret-main', revealGateChapter: 40 }]

  // Helper: Full act plan (5 acts covering chapters 1-50)
  const fullActPlan = [
    { actNumber: 1, fromChapter: 1, toChapter: 5, goal: 'Setup' },
    { actNumber: 2, fromChapter: 6, toChapter: 12, goal: 'Rising action' },
    { actNumber: 3, fromChapter: 13, toChapter: 25, goal: 'Complication' },
    { actNumber: 4, fromChapter: 26, toChapter: 37, goal: 'Crisis' },
    { actNumber: 5, fromChapter: 38, toChapter: 50, goal: 'Resolution' },
  ]

  // Helper: Full chapter targets (length 50, ordered sequentially)
  const fullChapterTargets = Array.from({ length: 50 }, (_, i) => ({
    chapterNumber: i + 1,
    phase: i < 5 ? 'INTRODUCTION' : 'MAIN_STORY',
    goal: `Chapter ${i + 1} goal`,
    mustInclude: ['beat-1'],
    mustNotReveal: [],
    emotionalTurn: 'Neutral',
    expectedThreadMovement: ['thread-A'],
  }))

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
      actPlan: fullActPlan,
      chapterTargets: fullChapterTargets,
      revealRunway: minimalRevealRunway, // FULL structural requirement
      closureRunway: fullClosureRunway,   // ALL 6 literal fields
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
    expect(normalizedRuntime.endingCandidates[0].requiredPlotDebtIds).toEqual([]) // Empty for V1
    
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

  test('V2 without requiredPlotDebtIds rejected by StoredStoryContractV2Schema (authoring)', () => {
    // CRITICAL: Use StoredStoryContractV2Schema (authoring schema) not NormalizedStoryContractSchema (runtime)
    // The runtime schema intentionally allows empty requiredPlotDebtIds for V1→V2 transition
    // But authoring schema requires ≥1 PlotDebtId reference for V2 structuring
    
    // Fixture design: 2 main + 1 secret to satisfy NCS §1.4 base requirement
    // Only first main is missing requiredPlotDebtIds - that's the ONLY intentional defect
    
    // CRITICAL: Must have exactly one 'main_mystery' plot debt per StoredStoryContractV2Schema refinement
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
      actPlan: fullActPlan,
      chapterTargets: fullChapterTargets,
      revealRunway: minimalRevealRunway,
      closureRunway: fullClosureRunway,
      // Must have exactly one 'main_mystery' plot debt (schema requirement)
      plotDebts: [
        { id: 'main_mystery', question: 'Who did it?', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' },
      ],
      endingCandidates: [
        // First main MISSING requiredPlotDebtIds - INTENTIONAL DEFECT
        { key: 'e1', name: 'E1', kind: 'main', condition: 'C', requiredClosure: ['closure-e1'], blockingConditions: [] },
        // Second main WITH valid requiredPlotDebtIds
        { 
          key: 'e2', 
          name: 'E2', 
          kind: 'main', 
          condition: 'C',
          requiredClosure: ['closure-e2'], 
          requiredPlotDebtIds: ['main_mystery'], // Legal reference to main_mystery
          blockingConditions: [] 
        },
        // Secret WITH valid requiredPlotDebtIds
        { 
          key: 'e3', 
          name: 'E3', 
          kind: 'secret', 
          condition: 'C',
          requiredClosure: ['closure-e3'], 
          requiredPlotDebtIds: ['main_mystery'], // Same legal reference (multiple endings can share same debt)
          blockingConditions: [] 
        },
      ],
    }

    // Must reject - V2 authoring schema requires requiredPlotDebtIds with exactly ≥1 entry
    const result = StoredStoryContractV2Schema.safeParse(v2MissingRequiredPlotDebtIds)
    expect(result.success).toBe(false)
    
    if (!result.success) {
      // Assert error exists specifically at endingCandidates[0].requiredPlotDebtIds path
      const hasSpecificError = result.error.issues.some((issue) => {
        return (
          issue.path.length === 3 &&
          issue.path[0] === 'endingCandidates' &&
          issue.path[1] === 0 &&
          issue.path[2] === 'requiredPlotDebtIds'
        )
      })
      
      expect(hasSpecificError).toBe(true)
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })

  test('V2 with legal requiredPlotDebtIds accepted by authoring schema', () => {
    // This is the POSITIVE counterpart to the negative test above
    // Uses StoredStoryContractV2Schema (authoring) with FULL requirements:
    // - ≥2 main endings
    // - ≥1 secret ending  
    // - ALL requiredPlotDebtIds present and legal
    
    // CRITICAL: Must have exactly one 'main_mystery' plot debt per StoredStoryContractV2Schema refinement
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
      actPlan: fullActPlan,
      chapterTargets: fullChapterTargets,
      revealRunway: minimalRevealRunway,
      closureRunway: fullClosureRunway,
      plotDebts: [
        { id: 'main_mystery', question: 'Who did it?', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' },
      ],
      endingCandidates: [
        { 
          key: 'e1', 
          name: 'E1', 
          kind: 'main', 
          condition: 'C',
          requiredClosure: ['closure-e1'], 
          requiredPlotDebtIds: ['main_mystery'], // Legal reference
          blockingConditions: [] 
        },
        { 
          key: 'e2', 
          name: 'E2', 
          kind: 'main', 
          condition: 'C',
          requiredClosure: ['closure-e2'], 
          requiredPlotDebtIds: ['main_mystery'], // Same legal reference
          blockingConditions: [] 
        },
        { 
          key: 'e3', 
          name: 'E3', 
          kind: 'secret', 
          condition: 'C',
          requiredClosure: ['closure-e3'], 
          requiredPlotDebtIds: ['main_mystery'], // Same legal reference (multiple endings share debt)
          blockingConditions: [] 
        },
      ],
    }

    // Should accept - has all V2 authoring requirements:
    // ✓ ≥2 main endings
    // ✓ ≥1 secret ending
    // ✓ All requiredPlotDebtIds present and referencing existing debts
    const result = StoredStoryContractV2Schema.safeParse(validV2WithRequiredFields)
    
    expect(result.success).toBe(true)
    
    if (result.success) {
      const parsed = result.data
      expect(parsed.endingCandidates.length).toBe(3)
      
      const mainCount = parsed.endingCandidates.filter((e) => e.kind === 'main').length
      const secretCount = parsed.endingCandidates.filter((e) => e.kind === 'secret').length
      expect(mainCount).toBe(2)
      expect(secretCount).toBe(1)
      
      // Verify all endings have requiredPlotDebtIds
      parsed.endingCandidates.forEach((ending) => {
        expect(ending.requiredPlotDebtIds).toBeDefined()
        expect(Array.isArray(ending.requiredPlotDebtIds)).toBe(true)
        expect(ending.requiredPlotDebtIds.length).toBeGreaterThan(0)
        
        // Verify references are legal (exist in plotDebts)
        const validRefs = parsed.plotDebts.map((d) => d.id)
        ending.requiredPlotDebtIds.forEach((ref) => {
          expect(validRefs).toContain(ref)
        })
      })
    }
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
      actPlan: fullActPlan,
      chapterTargets: fullChapterTargets,
      revealRunway: minimalRevealRunway, // FULL structural requirement (not [])
      closureRunway: fullClosureRunway,   // ALL 6 literal fields
      plotDebts: [{ id: 'd', question: 'Q', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' }],
      endingCandidates: [
        { key: 'e1', name: 'E1', kind: 'main', condition: 'C', requiredClosure: ['closure-e1'], requiredPlotDebtIds: [], blockingConditions: [] },
        { key: 'e2', name: 'E2', kind: 'main', condition: 'C', requiredClosure: ['closure-e2'], requiredPlotDebtIds: [], blockingConditions: [] },
      ],
    }

    // Should accept - Zero secrets allowed in runtime schema (no NCS §1.4 enforcement)
    const result = NormalizedStoryContractSchema.parse(runtimeCompatibleWithZeroSecrets)
    expect(result.endingCandidates.length).toBe(2)
    
    const secretCount = result.endingCandidates.filter((e) => e.kind === 'secret').length
    expect(secretCount).toBe(0)
  })

  test('StoryContractSchema STILL enforces NCS §1.4 for authoring validation', async () => {
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
      actPlan: fullActPlan,
      chapterTargets: fullChapterTargets,
      revealRunway: minimalRevealRunway,
      closureRunway: fullClosureRunway,
      plotDebts: [{ id: 'd', question: 'Q', introducedAt: 1, mustProgressBy: [10], mustCloseBy: 45, status: 'open' }],
      endingCandidates: [
        // Only 1 main ending, NO secrets - INVALID for NCS §1.4
        // Also using legal requiredPlotDebtIds and non-empty requiredClosure
        // so rejection is specifically due to <2 main / no secret
        { key: 'e1', name: 'E1', kind: 'main', condition: 'C', requiredClosure: ['closure-e1'], requiredPlotDebtIds: ['d'], blockingConditions: [] },
      ],
    }

    // Should reject - NCS §1.4 enforcement applies here (≥2 main + ≥1 secret)
    await expect(
      import('@/lib/story-engine/story-contract').then((m) => m.StoryContractSchema.parse(invalidForAuthoring))
    ).rejects.toThrow(/NCS.*§.*1\.4/)
  })
})
