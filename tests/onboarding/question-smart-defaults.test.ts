/**
 * Test: question-smart-defaults — V2 smart defaults from taste profile.
 *
 * In V2, getStorySetupQuestions sets defaultAnswer to the first promoted
 * option when a usable taste profile is present. This fixes Bug 5 from Fase 0.
 */
import { describe, expect, it } from 'vitest'
import {
  getStorySetupQuestions,
  defaultStorySetupQuestions,
} from '@/lib/onboarding/question-presets'
import {
  createEmptyTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'

// ── Helpers ────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<TasteProfileV2> = {}): TasteProfileV2 {
  const base = createEmptyTasteProfile()
  return { ...base, ...overrides }
}

describe('defaultStorySetupQuestions', () => {
  it('has exactly 4 questions', () => {
    expect(defaultStorySetupQuestions).toHaveLength(4)
  })

  it('each question has key, prompt, defaultAnswer, and options', () => {
    for (const q of defaultStorySetupQuestions) {
      expect(q.key).toBeTruthy()
      expect(q.prompt).toBeTruthy()
      expect(q.defaultAnswer).toBeTruthy()
      expect(q.options.length).toBeGreaterThan(0)
      // defaultAnswer must be in options (normalize em-dash variants)
      const normalizedDefault = q.defaultAnswer.replace(/—/g, '-').replace(/–/g, '-')
      const normalizedOpts = q.options.map((o) => o.replace(/—/g, '-').replace(/–/g, '-'))
      expect(normalizedOpts).toContain(normalizedDefault)
    }
  })

  it('trope defaultAnswer is "Pasangan yang berkhianat"', () => {
    const tropeQ = defaultStorySetupQuestions.find((q) => q.key === 'trope')!
    expect(tropeQ.defaultAnswer).toBe('Pasangan yang berkhianat')
  })
})

describe('getStorySetupQuestions with null/empty profile', () => {
  it('returns defaults for null profile', () => {
    const qs = getStorySetupQuestions(null)
    expect(qs).toHaveLength(defaultStorySetupQuestions.length)
  })

  it('returns defaults for empty profile (no completedAt, no genres)', () => {
    const qs = getStorySetupQuestions(createEmptyTasteProfile())
    expect(qs).toHaveLength(defaultStorySetupQuestions.length)
  })
})

// ═══════════════════════════════════════════════════════════════════
// FIXED: smart defaultAnswer from taste profile (Bug 5)
// ═══════════════════════════════════════════════════════════════════

describe('Smart defaults: defaultAnswer from taste profile (V2)', () => {
  it('REG-1: mystery profile → trope defaultAnswer should NOT be "Pasangan yang berkhianat"', () => {
    const profile = makeProfile({
      primaryGenreId: 'mystery',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // Fixed: defaultAnswer should be personalized — the first promoted option
    expect(tropeQ.defaultAnswer).not.toBe('Pasangan yang berkhianat')
  })

  it('REG-2: mystery profile → trope defaultAnswer should be a mystery-relevant option', () => {
    const profile = makeProfile({
      primaryGenreId: 'mystery',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // defaultAnswer should be first option, which is promoted mystery-relevant option
    const mysteryKeywords = ['rahasia', 'misteri', 'warisan', 'tersembunyi', 'dikubur', 'terungkap']
    const isMysteryRelevant = mysteryKeywords.some((kw) =>
      tropeQ.defaultAnswer.toLowerCase().includes(kw),
    )

    expect(isMysteryRelevant).toBe(true)
  })

  it('REG-3: romance profile → trope defaultAnswer should be romance-relevant', () => {
    const profile = makeProfile({
      primaryGenreId: 'romance',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // defaultAnswer should be first option, which is promoted romance-relevant option
    const romanceKeywords = ['cinta', 'pernikahan', 'hubungan', 'pasangan']
    const isRomanceRelevant = romanceKeywords.some((kw) =>
      tropeQ.defaultAnswer.toLowerCase().includes(kw),
    )

    expect(isRomanceRelevant).toBe(true)
  })

  it('REG-4: endingBias victory → akhir options promoted', () => {
    const profile = makeProfile({
      endingBias: 'victory',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const akhirQ = qs.find((q) => q.key === 'akhir')!

    // With victory endingBias, victory option should be promoted to top
    expect(akhirQ.options[0]).toContain('Kemenangan')
    // And defaultAnswer should be the first (victory) option
    expect(akhirQ.defaultAnswer).toBe(akhirQ.options[0])
  })

  it('smart defaults: defaultAnswer equals first option when taste present', () => {
    const profile = makeProfile({
      primaryGenreId: 'mystery',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)

    for (const q of qs) {
      expect(q.defaultAnswer).toBe(q.options[0])
    }
  })
})
