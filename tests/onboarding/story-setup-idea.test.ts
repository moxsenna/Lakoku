/**
 * Regression test: buildStorySetupIdea — soft avoidance for avoidedTropes (V2).
 *
 * V2: softAvoidanceIds are soft preferences ("Kurangi atau hindari bila tidak diperlukan").
 * contentBoundaryIds are hard constraints ("BATAS KONTEN WAJIB").
 *
 * buildStorySetupIdea now uses V2 TasteProfileV2. V1 profile data is
 * migrated on read via normalizeTasteProfile.
 */
import { describe, expect, it } from 'vitest'
import {
  buildStorySetupIdea,
  StorySetupInputSchema,
} from '@/lib/onboarding/story-setup'
import {
  createEmptyTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'

// ── Helpers ────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<TasteProfileV2> = {}): TasteProfileV2 {
  const base = createEmptyTasteProfile()
  return { ...base, ...overrides }
}

describe('buildStorySetupIdea — soft avoidance for softAvoidanceIds (V2)', () => {
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
  // FIXED: softAvoidanceIds are SOFT, not hard
  // ═════════════════════════════════════════════════════════════════

  describe('soft avoidance — softAvoidanceIds (V2)', () => {
    it('REG-1: softAvoidanceIds should NOT say "JANGAN"', () => {
      const profile = makeProfile({
        softAvoidanceIds: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      expect(result).not.toContain('JANGAN')
    })

    it('REG-2: softAvoidanceIds should NOT be labeled "BATAS"', () => {
      const profile = makeProfile({
        softAvoidanceIds: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // Only soft avoidance — no content boundaries — BATAS should NOT appear
      expect(result).not.toContain('BATAS KONTEN WAJIB')
    })

    it('REG-3: softAvoidanceIds use soft wording "Kurangi atau hindari"', () => {
      const profile = makeProfile({
        softAvoidanceIds: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      expect(result).toContain('Kurangi atau hindari')
    })

    it('REG-4: contentBoundaryIds remain hard constraint', () => {
      const profile = makeProfile({
        contentBoundaryIds: ['tidak ada adegan dewasa'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // contentBoundaries should still enforce "BATAS KONTEN WAJIB"
      expect(result).toContain('BATAS KONTEN WAJIB')
      expect(result).toContain('tidak ada adegan dewasa')
    })

    it('REG-5: both soft + hard: BATAS only for contentBoundaryIds', () => {
      const profile = makeProfile({
        softAvoidanceIds: ['Pengkhianatan pasangan'],
        contentBoundaryIds: ['tidak ada adegan dewasa'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // Soft section present
      expect(result).toContain('Kurangi atau hindari')
      expect(result).toContain('Pengkhianatan pasangan')

      // Hard section separate
      expect(result).toContain('BATAS KONTEN WAJIB')
      expect(result).toContain('tidak ada adegan dewasa')

      // Hard block first (priority), soft separate after
      const batasIndex = result.indexOf('BATAS KONTEN WAJIB')
      const softIndex = result.indexOf('Kurangi atau hindari')
      expect(batasIndex).toBeGreaterThanOrEqual(0)
      expect(softIndex).toBeGreaterThan(batasIndex)

      // Soft item must not appear inside the hard block lines
      const hardSection = result.slice(batasIndex, softIndex)
      expect(hardSection).not.toContain('Pengkhianatan pasangan')
    })
  })

  // ═════════════════════════════════════════════════════════════════
  // REGRESSION: soft avoidance wording contract
  // ═════════════════════════════════════════════════════════════════

  describe('soft avoidance wording contract (V2)', () => {
    it('softAvoidanceIds described as soft preference, not prohibition', () => {
      const profile = makeProfile({
        softAvoidanceIds: ['kekerasan eksplisit', 'Pengkhianatan pasangan'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      const lower = result.toLowerCase()
      const hasSoftWording =
        lower.includes('kurangi') ||
        lower.includes('hindari bila') ||
        lower.includes('sebaiknya') ||
        lower.includes('soft')

      expect(hasSoftWording).toBe(true)
    })

    it('likedConflictIds listed in preferences', () => {
      const profile = makeProfile({
        likedConflictIds: ['Rahasia keluarga yang dikubur lama'],
        softAvoidanceIds: ['kekerasan eksplisit'],
      })

      const result = buildStorySetupIdea({
        setup: { mode: 'quick', answers: {} },
        tasteProfile: profile,
      })

      // Liked conflicts should still appear in prompt
      expect(result).toContain('Rahasia keluarga yang dikubur lama')
      // Soft avoidance should appear but not with "JANGAN"
      expect(result).toContain('kekerasan eksplisit')
      expect(result).not.toContain('JANGAN pakai trope: kekerasan eksplisit')
    })
  })

  // ── Empty/null taste profile ─────────────────────────────────────

  it('null tasteProfile produces valid prompt', () => {
    const result = buildStorySetupIdea({
      setup: { mode: 'quick', answers: {} },
      tasteProfile: null,
    })
    expect(result).toContain('3 premis')
  })

  it('empty taste profile produces valid prompt without fake defaults', () => {
    const result = buildStorySetupIdea({
      setup: { mode: 'quick', answers: { trope: 'drama' } },
      tasteProfile: createEmptyTasteProfile(),
    })
    expect(result).toContain('3 premis')
    // No fake preference strings from empty profile
    expect(result).not.toContain('sedang')
  })
})
