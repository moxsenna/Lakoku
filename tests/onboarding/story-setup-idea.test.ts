/**
 * Regression test: buildStorySetupIdea — Bug 2 (avoidedTropes as hard constraint).
 *
 * buildStorySetupIdea saat ini menulis "JANGAN pakai trope" dan memperlakukan
 * avoidedTropes sebagai hard constraint setara contentBoundaries.
 *
 * Perilaku yang diinginkan (dari plan):
 *   - avoidedTropes: soft avoidance — "Kurangi atau hindari bila tidak diperlukan"
 *   - contentBoundaries: tetap hard constraint — "tidak boleh dilanggar"
 *   - Tidak ada kata "JANGAN" untuk avoidedTropes
 *
 * Test ini MENGUJI buildStorySetupIdea LANGSUNG dengan assertions yang AKAN FAIL
 * sampai implementasi soft avoidance diperbaiki.
 */

import { describe, expect, it } from 'vitest'
import {
  buildStorySetupIdea,
  StorySetupInputSchema,
} from '@/lib/onboarding/story-setup'
import {
  createDefaultTasteProfile,
  TasteProfileSchema,
} from '@/lib/taste-profile/schema'
import type { TasteProfile } from '@/lib/taste-profile/schema'

// ── Helpers ────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<TasteProfile> = {}): TasteProfile {
  const base = createDefaultTasteProfile()
  return { ...base, ...overrides }
}

describe('buildStorySetupIdea — soft avoidance for avoidedTropes', () => {
  it('schema accepts quick mode with answers', () => {
    const result = StorySetupInputSchema.safeParse({
      mode: 'quick',
      answers: { trope: 'Rahasia keluarga' },
    })
    expect(result.success).toBe(true)
  })

  it('schema accepts custom mode with customIdea', () => {
    const result = StorySetupInputSchema.safeParse({
      mode: 'custom',
      customIdea: 'seorang pewaris menemukan surat lama',
    })
    expect(result.success).toBe(true)
  })

  // ── Quick mode basic ─────────────────────────────────────────────

  it('quick mode with empty answers produces valid prompt', () => {
    const result = buildStorySetupIdea({
      setup: { mode: 'quick', answers: {} },
    })
    expect(result).toContain('3 premis')
    expect(result.length).toBeGreaterThan(0)
  })

  it('quick mode includes user answers', () => {
    const result = buildStorySetupIdea({
      setup: { mode: 'quick', answers: { trope: 'Rahasia keluarga' } },
    })
    expect(result).toContain('Rahasia keluarga')
  })

  // ── Custom mode ──────────────────────────────────────────────────

  it('custom mode includes user idea as primary creative direction', () => {
    const result = buildStorySetupIdea({
      setup: { mode: 'custom', customIdea: 'petualangan di kerajaan bawah laut' },
    })
    expect(result).toContain('petualangan di kerajaan bawah laut')
  })

  // ═════════════════════════════════════════════════════════════════
  // REGRESSION: avoidedTropes should be SOFT, not hard
  // ═════════════════════════════════════════════════════════════════

  describe('REGRESSION: avoidedTropes as soft avoidance (CURRENTLY FAILS)', () => {
    it('REG-1: avoidedTropes should NOT say "JANGAN" (FAILS)', () => {
      // CURRENT: "JANGAN pakai trope: ..." — hard constraint
      // DESIRED:  "Kurangi atau hindari bila tidak diperlukan: ..." — soft
      const profile = makeProfile({
        avoidedTropes: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      const containsJangan = result.includes('JANGAN')
      expect(containsJangan).toBe(false)
    })

    it('REG-2: avoidedTropes should NOT be labeled as hard "BATAS" (FAILS)', () => {
      // CURRENT: avoidedTropes grouped under "BATAS" alongside contentBoundaries
      // DESIRED:  avoidedTropes in separate soft section
      const profile = makeProfile({
        avoidedTropes: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // The word "BATAS" should not appear for avoidedTropes alone
      // (it's acceptable for contentBoundaries only)
      // But currently both are in the same "BATAS" block
      const batasIndex = result.indexOf('BATAS')
      const avoidedIndex = result.indexOf('kekerasan eksplisit')

      // If avoidedIndex comes after BATAS and there are no contentBoundaries,
      // it means avoidedTropes is inside the BATAS block — which is the bug.
      // We want avoidedTropes to NOT be inside a "BATAS" block when there
      // are no contentBoundaries.
      if (batasIndex >= 0 && avoidedIndex > batasIndex) {
        // Check if contentBoundaries are present — they shouldn't be in this test
        expect(profile.contentBoundaries).toHaveLength(0)
        // Since only avoidedTropes are set, BATAS should not be present
        expect(batasIndex).toBe(-1)
      }
    })

    it('REG-3: avoidedTropes should use soft wording "Kurangi atau hindari" (FAILS)', () => {
      const profile = makeProfile({
        avoidedTropes: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      expect(result).toContain('Kurangi atau hindari')
    })

    it('REG-4: contentBoundaries remain hard constraint (existing behavior OK)', () => {
      const profile = makeProfile({
        contentBoundaries: ['tidak ada adegan dewasa'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // contentBoundaries should still be enforced strictly
      expect(result).toContain('tidak ada adegan dewasa')
    })

    it('REG-5: only contentBoundaries without avoidedTropes — BATAS is OK', () => {
      const profile = makeProfile({
        contentBoundaries: ['tidak ada adegan dewasa'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // contentBoundaries alone → BATAS label is correct
      expect(result).toContain('BATAS')
      expect(result).toContain('tidak ada adegan dewasa')
    })
  })

  // ═════════════════════════════════════════════════════════════════
  // REGRESSION: PROMISE — soft avoidance affects prompt wording
  // ═════════════════════════════════════════════════════════════════

  describe('avoidedTropes wording contract (desired behavior)', () => {
    it('avoidedTropes described as soft preference, not prohibition', () => {
      const profile = makeProfile({
        avoidedTropes: ['kekerasan eksplisit', 'pengkhianatan pasangan'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // Desired contract: soft avoidance, not prohibition
      // FAILS until buildTasteProfileBlock is updated
      const lower = result.toLowerCase()
      const hasSoftWording =
        lower.includes('kurangi') ||
        lower.includes('hindari bila') ||
        lower.includes('sebaiknya') ||
        lower.includes('soft')

      expect(hasSoftWording).toBe(true)
    })

    it('avoidedTropes listed but with permissive framing', () => {
      const profile = makeProfile({
        avoidedTropes: ['kekerasan eksplisit'],
        likedTropes: ['cinta lama kembali'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // Liked tropes should still appear in prompt
      expect(result).toContain('cinta lama kembali')
      // Avoided tropes should appear but not with "JANGAN"
      expect(result).toContain('kekerasan eksplisit')
      expect(result).not.toContain('JANGAN pakai trope: kekerasan eksplisit')
    })
  })
})
