/**
 * Test: migrateTasteProfileToV2 — V1 → V2 migration (plan §5.5).
 */
import { describe, expect, it } from 'vitest'
import {
  migrateTasteProfileToV2,
  createEmptyTasteProfile,
  asV1Compat,
  TasteProfileV1Schema,
  type TasteProfileV1,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'

function makeV1(overrides: Partial<TasteProfileV1> = {}): TasteProfileV1 {
  const base = TasteProfileV1Schema.parse({})
  return { ...base, version: 1, ...overrides }
}

describe('migrateTasteProfileToV2', () => {
  // ── Idempotency ───────────────────────────────────────────────────

  it('idempotent: V2 input returns itself unchanged', () => {
    const v2: TasteProfileV2 = {
      version: 2,
      primaryGenreId: 'mystery',
      secondaryGenreId: 'romance',
      likedConflictIds: ['mystery_hidden_identity'],
      customLikedConflict: null,
      softAvoidanceIds: ['avoid_unearned_twist'],
      contentBoundaryIds: ['boundary_explicit_sexual_content'],
      dramaIntensity: 'intense',
      pacing: 'fast_eventful',
      languageStyle: 'cinematic_visual',
      endingBias: 'justice',
      completedAt: '2025-01-01T00:00:00.000Z',
      skippedAt: null,
      updatedAt: '2025-01-01T00:00:00.000Z',
    }

    const result = migrateTasteProfileToV2(v2)
    expect(result.version).toBe(2)
    expect(result.primaryGenreId).toBe('mystery')
    expect(result.secondaryGenreId).toBe('romance')
    expect(result.likedConflictIds).toEqual(['mystery_hidden_identity'])
    expect(result.softAvoidanceIds).toEqual(['avoid_unearned_twist'])
    expect(result.contentBoundaryIds).toEqual(['boundary_explicit_sexual_content'])
    expect(result.dramaIntensity).toBe('intense')
    expect(result.pacing).toBe('fast_eventful')
    expect(result.languageStyle).toBe('cinematic_visual')
    expect(result.endingBias).toBe('justice')
    expect(result.completedAt).toBe('2025-01-01T00:00:00.000Z')
  })

  // ── Empty / unknown ───────────────────────────────────────────────

  it('null returns empty V2', () => {
    const result = migrateTasteProfileToV2(null)
    expect(result).toEqual(createEmptyTasteProfile())
  })

  it('empty object returns empty V2 (no fake defaults)', () => {
    const result = migrateTasteProfileToV2({})
    expect(result.version).toBe(2)
    expect(result.primaryGenreId).toBeNull()
    expect(result.dramaIntensity).toBeNull()
    expect(result.languageStyle).toBeNull()
    expect(result.endingBias).toBeNull()
    expect(result.pacing).toBeNull()
  })

  it('undefined returns empty V2', () => {
    const result = migrateTasteProfileToV2(undefined)
    expect(result.version).toBe(2)
  })

  it('never throws on garbage input', () => {
    expect(() => migrateTasteProfileToV2('not-an-object')).not.toThrow()
    expect(() => migrateTasteProfileToV2(42)).not.toThrow()
    expect(() => migrateTasteProfileToV2([])).not.toThrow()
    expect(migrateTasteProfileToV2('x').version).toBe(2)
  })

  // ── Genre mapping ─────────────────────────────────────────────────

  it('first genre → primaryGenreId', () => {
    const v1 = makeV1({ preferredGenres: ['Romansa'] })
    const result = migrateTasteProfileToV2(v1)
    expect(result.primaryGenreId).toBe('romance')
    expect(result.secondaryGenreId).toBeNull()
  })

  it('first two genres → primary + secondary', () => {
    const v1 = makeV1({ preferredGenres: ['Misteri & rahasia', 'Romansa'] })
    const result = migrateTasteProfileToV2(v1)
    expect(result.primaryGenreId).toBe('mystery')
    expect(result.secondaryGenreId).toBe('romance')
  })

  it('third+ genres ignored', () => {
    const v1 = makeV1({
      preferredGenres: ['Drama keluarga', 'Fantasi & kerajaan', 'Slice of life'],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.primaryGenreId).toBe('family_drama')
    expect(result.secondaryGenreId).toBe('fantasy_kingdom')
  })

  it('unknown genre label → null (does not break parse)', () => {
    const v1 = makeV1({ preferredGenres: ['Genre tidak dikenal'] })
    const result = migrateTasteProfileToV2(v1)
    expect(result.primaryGenreId).toBeNull()
    expect(result.secondaryGenreId).toBeNull()
  })

  it('all supported genre labels resolve correctly', () => {
    const testCases: [string, string | null][] = [
      ['Drama keluarga', 'family_drama'],
      ['Romansa', 'romance'],
      ['Misteri & rahasia', 'mystery'],
      ['Fantasi & kerajaan', 'fantasy_kingdom'],
      ['Slice of life', 'slice_of_life'],
      ['Thriller & bertahan hidup', 'survival_thriller'],
    ]
    for (const [label, expected] of testCases) {
      const v1 = makeV1({ preferredGenres: [label] })
      const result = migrateTasteProfileToV2(v1)
      expect(result.primaryGenreId).toBe(expected)
    }
  })

  // ── Conflict / trope mapping ──────────────────────────────────────

  it('liked tropes → likedConflictIds (stable conflict IDs)', () => {
    const v1 = makeV1({
      likedTropes: [
        'Cinta lama yang kembali',
        'Pernikahan kontrak',
        'Identitas asli yang disembunyikan',
      ],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.likedConflictIds).toEqual([
      'romance_old_love_returns',
      'romance_contract_relationship',
      'mystery_hidden_identity',
    ])
  })

  it('liked tropes max 3', () => {
    const v1 = makeV1({
      likedTropes: [
        'Cinta lama yang kembali',
        'Pernikahan kontrak',
        'Identitas asli yang disembunyikan',
        'Tahta yang diperebutkan',
      ],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.likedConflictIds.length).toBeLessThanOrEqual(3)
  })

  it('unknown trope label preserved as raw', () => {
    const v1 = makeV1({
      likedTropes: ['Trope buatan sendiri'],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.likedConflictIds).toEqual(['Trope buatan sendiri'])
  })

  // ── Avoided tropes → soft / hard split ────────────────────────────

  it('quality avoidedTropes → softAvoidanceIds', () => {
    const v1 = makeV1({
      avoidedTropes: ['Cinta segitiga', 'Twist tanpa petunjuk'],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.softAvoidanceIds).toEqual([
      'avoid_romance_takeover',
      'avoid_unearned_twist',
    ])
    expect(result.contentBoundaryIds).toEqual([])
  })

  it('sensitive avoidedTropes → contentBoundaryIds (hard)', () => {
    const v1 = makeV1({
      avoidedTropes: [
        'Kekerasan eksplisit',
        'Pengkhianatan pasangan',
        'Kematian tokoh utama',
        'Horor & jumpscare',
      ],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.contentBoundaryIds).toEqual([
      'boundary_graphic_violence',
      'boundary_partner_infidelity',
      'boundary_protagonist_death',
      'boundary_intense_horror',
    ])
    expect(result.softAvoidanceIds).toEqual([])
  })

  it('avoidedTropes soft max 4', () => {
    const v1 = makeV1({
      avoidedTropes: [
        'Cinta segitiga',
        'Twist tanpa petunjuk',
        'Drama berlebihan',
        'Tokoh terlalu bodoh demi plot',
        'Rahasia yang tidak terjawab',
      ],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.softAvoidanceIds.length).toBeLessThanOrEqual(4)
  })

  // ── Content boundaries ────────────────────────────────────────────

  it('contentBoundaries → contentBoundaryIds', () => {
    const v1 = makeV1({
      contentBoundaries: ['Tanpa adegan dewasa', 'Tanpa kekerasan eksplisit'],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.contentBoundaryIds).toContain('boundary_explicit_sexual_content')
    expect(result.contentBoundaryIds).toContain('boundary_graphic_violence')
  })

  it('contentBoundaries max 12', () => {
    const v1 = makeV1({
      contentBoundaries: Array.from({ length: 15 }, (_, i) => `Boundary ${i}`),
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.contentBoundaryIds.length).toBeLessThanOrEqual(12)
  })

  // ── Enum fields ───────────────────────────────────────────────────

  it('dramaIntensity V1 → V2', () => {
    expect(migrateTasteProfileToV2(makeV1({ dramaIntensity: 'ringan' })).dramaIntensity).toBe(
      'warm',
    )
    expect(migrateTasteProfileToV2(makeV1({ dramaIntensity: 'sedang' })).dramaIntensity).toBe(
      'balanced',
    )
    expect(migrateTasteProfileToV2(makeV1({ dramaIntensity: 'tinggi' })).dramaIntensity).toBe(
      'intense',
    )
  })

  it('pacing V1 → V2', () => {
    expect(migrateTasteProfileToV2(makeV1({ pacing: 'slow-burn' })).pacing).toBe('slow_deep')
    expect(migrateTasteProfileToV2(makeV1({ pacing: 'seimbang' })).pacing).toBe('balanced')
    expect(migrateTasteProfileToV2(makeV1({ pacing: 'cepat' })).pacing).toBe('fast_eventful')
  })

  it('languageStyle V1 → V2', () => {
    expect(migrateTasteProfileToV2(makeV1({ languageStyle: 'ringkas' })).languageStyle).toBe(
      'clear_concise',
    )
    expect(migrateTasteProfileToV2(makeV1({ languageStyle: 'puitis' })).languageStyle).toBe(
      'poetic_emotional',
    )
    expect(migrateTasteProfileToV2(makeV1({ languageStyle: 'sinematik' })).languageStyle).toBe(
      'cinematic_visual',
    )
  })

  it('endingBias V1 → V2', () => {
    expect(migrateTasteProfileToV2(makeV1({ endingBias: 'keadilan' })).endingBias).toBe('justice')
    expect(migrateTasteProfileToV2(makeV1({ endingBias: 'kedamaian' })).endingBias).toBe(
      'peaceful',
    )
    expect(migrateTasteProfileToV2(makeV1({ endingBias: 'kemenangan' })).endingBias).toBe(
      'victory',
    )
    expect(migrateTasteProfileToV2(makeV1({ endingBias: 'tragis-manis' })).endingBias).toBe(
      'bittersweet',
    )
  })

  // ── Timestamps ────────────────────────────────────────────────────

  it('timestamps preserved', () => {
    const v1 = makeV1({
      completedAt: '2025-03-15T10:00:00.000Z',
      skippedAt: '2025-03-14T10:00:00.000Z',
      updatedAt: '2025-03-16T10:00:00.000Z',
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.completedAt).toBe('2025-03-15T10:00:00.000Z')
    expect(result.skippedAt).toBe('2025-03-14T10:00:00.000Z')
    expect(result.updatedAt).toBe('2025-03-16T10:00:00.000Z')
  })

  it('missing timestamps → null', () => {
    const v1 = makeV1({})
    const result = migrateTasteProfileToV2(v1)
    expect(result.completedAt).toBeNull()
    expect(result.skippedAt).toBeNull()
    expect(result.updatedAt).toBeNull()
  })

  // ── Romance level not in V2 ───────────────────────────────────────

  it('romanceLevel from V1 is not in V2 output', () => {
    const v1 = makeV1({ romanceLevel: 'utama' })
    const result = migrateTasteProfileToV2(v1)
    expect((result as Record<string, unknown>).romanceLevel).toBeUndefined()
  })

  // ── Soft vs hard split ────────────────────────────────────────────

  it('avoided soft + contentBoundaries hard stay separate', () => {
    const v1 = makeV1({
      avoidedTropes: ['Cinta segitiga', 'Kekerasan eksplisit'],
      contentBoundaries: ['Tanpa adegan dewasa'],
    })
    const result = migrateTasteProfileToV2(v1)
    expect(result.softAvoidanceIds).toContain('avoid_romance_takeover')
    expect(result.contentBoundaryIds).toContain('boundary_graphic_violence')
    expect(result.contentBoundaryIds).toContain('boundary_explicit_sexual_content')
    expect(result.softAvoidanceIds).not.toContain('boundary_graphic_violence')
  })

  // ── asV1Compat ────────────────────────────────────────────────────

  it('asV1Compat maps V2 IDs back to V1 labels/enums', () => {
    const v2: TasteProfileV2 = {
      ...createEmptyTasteProfile(),
      primaryGenreId: 'mystery',
      secondaryGenreId: 'romance',
      likedConflictIds: ['mystery_hidden_identity'],
      softAvoidanceIds: ['avoid_unearned_twist'],
      contentBoundaryIds: ['boundary_graphic_violence'],
      dramaIntensity: 'intense',
      pacing: 'slow_deep',
      languageStyle: 'poetic_emotional',
      endingBias: 'bittersweet',
    }
    const v1 = asV1Compat(v2)
    expect(v1.version).toBe(1)
    expect(v1.preferredGenres).toEqual(['Misteri & rahasia', 'Romansa'])
    expect(v1.likedTropes[0]).toContain('Identitas')
    expect(v1.avoidedTropes[0]).toContain('Twist')
    expect(v1.contentBoundaries[0]).toContain('Kekerasan')
    expect(v1.dramaIntensity).toBe('tinggi')
    expect(v1.pacing).toBe('slow-burn')
    expect(v1.languageStyle).toBe('puitis')
    expect(v1.endingBias).toBe('tragis-manis')
  })
})
