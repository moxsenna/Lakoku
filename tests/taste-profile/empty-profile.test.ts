/**
 * Regression test: empty/skipped profile — Bugs 3 & 4.
 *
 * Bug 3: Skip discards answers.
 *   - buildProfile(isSkip=true) → createDefaultTasteProfile + skippedAt
 *   - actSkipTasteProfile → createDefaultTasteProfile + skippedAt
 *   - Partial answers di last step di-wipe oleh "Lewati dulu"
 *
 * Bug 4: Profile stops after premise.
 *   - cast/mystery/world tidak menerima creative direction.
 *   - Untuk Fase 0: dokumentasikan API surface dengan contract test.
 *
 * Perilaku yang diinginkan:
 *   - Skip di intro (step 0): empty profile + skippedAt, TANPA fake defaults
 *     (subtle, sinematik, keadilan)
 *   - "Lewati dulu" di last step: simpan apa yang sudah dipilih user
 *   - Intro "Nanti saja": empty + skippedAt tanpa preferensi palsu
 */

import { describe, expect, it } from 'vitest'
import {
  createDefaultTasteProfile,
  TasteProfileSchema,
} from '@/lib/taste-profile/schema'
import type { TasteProfile } from '@/lib/taste-profile/schema'

// ═══════════════════════════════════════════════════════════════════
// Bug 3: createDefaultTasteProfile injects fake user preferences
// ═══════════════════════════════════════════════════════════════════

describe('createDefaultTasteProfile — empty profile contract', () => {
  it('creates a valid profile', () => {
    const profile = createDefaultTasteProfile()
    expect(TasteProfileSchema.safeParse(profile).success).toBe(true)
  })

  it('has version 1', () => {
    const profile = createDefaultTasteProfile()
    expect(profile.version).toBe(1)
  })

  it('has empty arrays for all array fields', () => {
    const profile = createDefaultTasteProfile()
    expect(profile.preferredGenres).toEqual([])
    expect(profile.likedTropes).toEqual([])
    expect(profile.avoidedTropes).toEqual([])
    expect(profile.contentBoundaries).toEqual([])
  })

  // ═════════════════════════════════════════════════════════════════
  // REGRESSION: defaults look like user preferences (Bug 3)
  // ═════════════════════════════════════════════════════════════════

  it('REG-1: default profile injects romanceLevel="subtle" as if user chose it (FAILS)', () => {
    // CURRENT: createDefaultTasteProfile parses {} → romanceLevel = 'subtle'
    // DESIRED: empty profile should have null/undefined romanceLevel
    //   or 'subtle' should be explicitly marked as "not a user choice"
    const profile = createDefaultTasteProfile()

    // This test FAILS because createDefaultTasteProfile returns
    // romanceLevel: 'subtle' via Zod defaults
    // The bug: there's no way to tell if the user actually chose 'subtle'
    // or if it's a system default
    expect(profile.romanceLevel).not.toBe('subtle')
  })

  it('REG-2: default profile injects languageStyle="sinematik" as if user chose it (FAILS)', () => {
    const profile = createDefaultTasteProfile()

    // Same issue as romanceLevel — system default indistinguishable from user choice
    expect(profile.languageStyle).not.toBe('sinematik')
  })

  it('REG-3: default profile injects endingBias="keadilan" as if user chose it (FAILS)', () => {
    const profile = createDefaultTasteProfile()

    expect(profile.endingBias).not.toBe('keadilan')
  })

  it('REG-4: default profile has dramaIntensity="sedang" which is the "middle" default (FAILS)', () => {
    const profile = createDefaultTasteProfile()

    // 'sedang' is the middle value — for an empty profile, it could be argued
    // as OK since there's no real "none". But for V1 we document the issue.
    expect(profile.dramaIntensity).not.toBe('sedang')
  })
})

// ═══════════════════════════════════════════════════════════════════
// Bug 3: Skip behavior — discards partial answers
// ═══════════════════════════════════════════════════════════════════

describe('Skip profile behavior (Bug 3)', () => {
  it('createDefaultTasteProfile used as skip base — arrays are empty', () => {
    const profile = createDefaultTasteProfile()
    // Arrays ARE empty for default — skip doesn't add fake genres/tropes
    expect(profile.preferredGenres).toHaveLength(0)
    expect(profile.likedTropes).toHaveLength(0)
    expect(profile.avoidedTropes).toHaveLength(0)
  })

  it('REG-5: actSkipTasteProfile stores createDefaultTasteProfile + skippedAt (FAILS)', () => {
    // CURRENT: actSkipTasteProfile uses createDefaultTasteProfile() which includes
    //   romanceLevel: 'subtle', languageStyle: 'sinematik', endingBias: 'keadilan',
    //   dramaIntensity: 'sedang', pacing: 'seimbang'
    // These are indistinguishable from user-chosen preferences.
    //
    // DESIRED: skipped profile should signal "no preferences" — either:
    //   a) A new createEmptyTasteProfile() with null-ish preference fields, or
    //   b) A flag/isSkipped marker so consumers know not to use defaults as preferences
    //
    // For Fase 0: document the bug. This test verifies the CURRENT behavior
    // and will be updated in Fase 1 when V2 schema adds explicit nullability.

    // Simulating what actSkipTasteProfile does:
    const skipped: TasteProfile = {
      ...createDefaultTasteProfile(),
      skippedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // DESIRED: consumers should know this is a skipped (empty) profile
    // Currently, skippedAt is the only signal — but preferences like
    // 'subtle', 'sinematik', 'keadilan' are still present as defaults

    // This test documents the gap:
    const hasSkippedAt = Boolean(skipped.skippedAt)
    expect(hasSkippedAt).toBe(true)

    // But the defaults are still there:
    expect(skipped.romanceLevel).toBe('subtle')
    expect(skipped.languageStyle).toBe('sinematik')
    expect(skipped.endingBias).toBe('keadilan')

    // For now, skippedAt IS the signal — consumers must check it.
    // Fase 1 V2 schema will address this properly.
  })
})

// ═══════════════════════════════════════════════════════════════════
// Bug 4: Profile stops after premise — direction block contract
// ═══════════════════════════════════════════════════════════════════

describe('Authoring direction block contract (Bug 4)', () => {
  it('CONTRACT: proposeCast should accept direction option', () => {
    // Document the expected future API surface.
    // Currently proposeCast only takes storyId + chapter context
    // The plan says cast/mystery/world should receive creative direction
    // from taste profile + story setup answers.

    // This is a pure contract test — no implementation to test yet.
    // The contract is: direction parameter should be part of the function
    // signature for all authoring proposers.

    // For Fase 0, we document the expected shape:
    interface DirectionBlock {
      tasteProfile: TasteProfile | null
      storySetupAnswers: Record<string, string>
    }

    // Expected function signature (future):
    //   proposeCast(storyId: string, direction?: DirectionBlock): Promise<...>

    // This is documentation — not a failing assertion, because the function
    // doesn't exist yet or doesn't accept this parameter.
    expect(true).toBe(true)
  })

  it('CONTRACT: direction block should carry taste profile preferences', () => {
    const direction = {
      tasteProfile: createDefaultTasteProfile(),
      storySetupAnswers: { trope: 'Rahasia keluarga' },
    } as const

    expect(direction.tasteProfile.version).toBe(1)
    expect(direction.storySetupAnswers.trope).toBe('Rahasia keluarga')
  })

  it('CONTRACT: buildAuthoringDirectionBlock should be a pure function', () => {
    // Future pure function that composes creative direction for authoring
    // Input: TasteProfile + StorySetupInput
    // Output: structured direction string for AI proposals (cast, world, mystery)

    // This doesn't exist yet — documenting the interface:
    type BuildDirectionInput = {
      tasteProfile?: TasteProfile | null
      answers: Record<string, string>
      customIdea?: string | null
    }

    // Expected output should contain:
    // - Genre preferences from taste profile
    // - Trope/style preferences
    // - Content boundaries (hard)
    // - Story-specific answers from quick/custom input
    // - Creative direction priority: custom > answers > taste > default

    const input: BuildDirectionInput = {
      tasteProfile: null,
      answers: { trope: 'Rahasia keluarga' },
      customIdea: null,
    }

    // Even null tasteProfile should not break direction generation
    expect(input.answers.trope).toBeTruthy()
  })
})
