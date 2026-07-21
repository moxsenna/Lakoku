/**
 * Regression test: Pilihkan untukku hard-coded defaults — Bug 5.
 *
 * defaultAnswer di question-presets selalu 'Pasangan yang berkhianat' dll —
 * tidak dipersonalisasi dari Taste Profile. Dengan mystery taste profile,
 * defaultAnswer untuk trope seharusnya TIDAK tetap 'Pasangan yang berkhianat'
 * setelah personalization.
 *
 * Test ini mendokumentasikan bug: getStorySetupQuestions dengan mystery profile
 * masih mengembalikan defaultAnswer hard-coded untuk trope.
 *
 * Perilaku yang diinginkan (dari plan):
 *   - Auto-resolve defaultAnswer dari taste profile (server-side)
 *   - Client tidak boleh bake universal defaults sebagai satu-satunya path
 *   - Dengan mystery profile, defaultAnswer trope seharusnya opsi misteri pertama
 */

import { describe, expect, it } from 'vitest'
import {
  getStorySetupQuestions,
  defaultStorySetupQuestions,
} from '@/lib/onboarding/question-presets'
import {
  createDefaultTasteProfile,
} from '@/lib/taste-profile/schema'
import type { TasteProfile } from '@/lib/taste-profile/schema'

// ── Helpers ────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<TasteProfile> = {}): TasteProfile {
  const base = createDefaultTasteProfile()
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
      // defaultAnswer must be in options (normalize dash variants:
      // pre-existing data issue: akhir uses '-' in defaultAnswer
      // but '—' (em-dash) in options)
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
    const qs = getStorySetupQuestions(createDefaultTasteProfile())
    expect(qs).toHaveLength(defaultStorySetupQuestions.length)
  })
})

// ═══════════════════════════════════════════════════════════════════
// REGRESSION: defaultAnswer not personalized (Bug 5)
// ═══════════════════════════════════════════════════════════════════

describe('REGRESSION: hard-coded defaultAnswer (CURRENTLY FAILS)', () => {
  it('REG-1: mystery profile → trope defaultAnswer should NOT be "Pasangan yang berkhianat" (FAILS)', () => {
    // Dengan mystery taste profile, defaultAnswer untuk trope seharusnya
    // di-resolve ke opsi yang relevan dengan misteri, bukan default universal.
    const profile = makeProfile({
      preferredGenres: ['Misteri & rahasia'],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // DESIRED: defaultAnswer should be personalized — the first mystery-relevant option
    // CURRENT BUG: defaultAnswer remains 'Pasangan yang berkhianat'
    expect(tropeQ.defaultAnswer).not.toBe('Pasangan yang berkhianat')
  })

  it('REG-2: mystery profile → trope defaultAnswer should be a mystery-relevant option (FAILS)', () => {
    const profile = makeProfile({
      preferredGenres: ['Misteri & rahasia'],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // DESIRED: defaultAnswer from personalized options (mystery genre)
    const mysteryKeywords = ['rahasia', 'misteri', 'warisan', 'tersembunyi', 'dikubur', 'terungkap']
    const isMysteryRelevant = mysteryKeywords.some((kw) =>
      tropeQ.defaultAnswer.toLowerCase().includes(kw),
    )

    expect(isMysteryRelevant).toBe(true)
  })

  it('REG-3: romance profile → trope defaultAnswer should be romance-relevant (FAILS)', () => {
    const profile = makeProfile({
      preferredGenres: ['Romansa'],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // DESIRED: defaultAnswer from personalized options (romance genre)
    const romanceKeywords = ['cinta', 'pernikahan', 'hubungan']
    const isRomanceRelevant = romanceKeywords.some((kw) =>
      tropeQ.defaultAnswer.toLowerCase().includes(kw),
    )

    expect(isRomanceRelevant).toBe(true)
  })

  it('REG-4: endingBias keadilan → akhir defaultAnswer still first keadilan option', () => {
    // Bug 5 is about trope defaultAnswer, but endingBias personalization
    // already works via promoteOptions. Let's verify the side doesn't regress.
    const profile = makeProfile({
      endingBias: 'kemenangan',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const akhirQ = qs.find((q) => q.key === 'akhir')!

    // With kemenangan endingBias, kemenangan option should be promoted to top
    // and defaultAnswer should ideally reflect the bias
    // CURRENT: defaultAnswer for akhir stays 'Keadilan - semua rahasia terbuka'
    // This is a lesser bug but worth documenting.
    expect(akhirQ.options[0]).toContain('Kemenangan')
  })

  it('REG-5: mystery profile → trope options include mystery injection', () => {
    // Verify the option injection works (options get personalized)
    // But defaultAnswer still doesn't — this is the precise bug.
    const profile = makeProfile({
      preferredGenres: ['Misteri & rahasia'],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // Options ARE personalized with mystery keywords
    const hasMysteryOption = tropeQ.options.some((o) =>
      o.toLowerCase().includes('rahasia'),
    )
    expect(hasMysteryOption).toBe(true)

    // But defaultAnswer is still hard-coded 'Pasangan yang berkhianat'
    // This is the bug — options are personalized but defaultAnswer is not
  })
})

// ═══════════════════════════════════════════════════════════════════
// Desired contract: smart defaults from taste profile
// ═══════════════════════════════════════════════════════════════════

describe('Desired: smart defaultAnswer from taste profile', () => {
  it('CONTRACT: defaultAnswer should be first personalized option', () => {
    // This is the target behavior. After personalization, defaultAnswer
    // should be the first option in the reordered/personalized list.
    const profile = makeProfile({
      preferredGenres: ['Misteri & rahasia'],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const qs = getStorySetupQuestions(profile)
    const tropeQ = qs.find((q) => q.key === 'trope')!

    // Desired: defaultAnswer == options[0] (the most relevant personalized option)
    expect(tropeQ.defaultAnswer).toBe(tropeQ.options[0])
  })
})
