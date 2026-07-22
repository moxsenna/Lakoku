/**
 * Test: buildBalancedOptionsFromGenres — 4+2 interleave.
 *
 * buildBalancedOptionsFromGenres is now the default export (production path).
 * buildOptionsFromGenres is kept as legacy sequential variant.
 *
 * Perilaku:
 *   - 1 genre → 6 dari genre tersebut
 *   - 2+ genre → 4 primer + 2 sekunder, diinterleave, urutan stabil, dedupe by ID
 */
import { describe, expect, it } from 'vitest'
import {
  buildOptionsFromGenres,
  buildBalancedOptionsFromGenres,
} from '@/lib/taste-profile/options'

// ── Test fixture: genre maps ──────────────────────────────────────

const GENRE_TROPE: Record<string, string[]> = {
  'Misteri & rahasia': [
    'Rahasia keluarga yang dikubur lama',   // [0]
    'Surat lama yang mengubah warisan',      // [1]
    'Identitas asli yang disembunyikan',     // [2]
    'Kematian lama yang belum terjawab',     // [3]
    'Saksi yang tiba-tiba muncul',           // [4]
    'Kebenaran yang sengaja ditutup keluarga', // [5]
  ],
  'Romansa': [
    'Cinta lama yang kembali',               // [0]
    'Pernikahan kontrak',                    // [1]
    'Sekutu jadi cinta',                     // [2]
    'Cinta yang harus diperjuangkan lagi',   // [3]
    'Hubungan pura-pura yang jadi nyata',    // [4]
    'Orang yang salah di waktu yang tepat',  // [5]
  ],
}

const SMALL_GENRE_MAP: Record<string, string[]> = {
  'Drama keluarga': [
    'Konflik warisan',
    'Bangkit setelah jatuh',
    'Pengorbanan demi keluarga',
  ],
  'Slice of life': [
    'Hidup baru di tempat tak terduga',
    'Persahabatan yang mengubah hidup',
    'Kesempatan kedua di usia dewasa',
  ],
}

const FALLBACK = [
  'Fallback 1', 'Fallback 2', 'Fallback 3',
  'Fallback 4', 'Fallback 5', 'Fallback 6',
]

// ═══════════════════════════════════════════════════════════════════
// SECTION A: buildBalancedOptionsFromGenres (PRODUCTION — 4+2 interleave)
// ═══════════════════════════════════════════════════════════════════

describe('buildBalancedOptionsFromGenres (PRODUCTION 4+2 interleave)', () => {
  it('single genre: returns up to 6 options from that genre', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Misteri & rahasia'], GENRE_TROPE, FALLBACK,
    )
    expect(result.length).toBe(6)
    expect(result).toEqual(GENRE_TROPE['Misteri & rahasia'])
  })

  it('no genre: returns fallback (first 6)', () => {
    const result = buildBalancedOptionsFromGenres([], GENRE_TROPE, FALLBACK)
    expect(result.length).toBe(6)
    expect(result).toEqual(FALLBACK)
  })

  it('two genres: 4 primary + 2 secondary interleaved', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    expect(result.length).toBe(6)

    // Primary: Misteri & rahasia, Secondary: Romansa
    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    // Count how many from each genre
    const primaryCount = result.filter((o) => primaryOpts.includes(o)).length
    const secondaryCount = result.filter((o) => secondaryOpts.includes(o)).length

    expect(primaryCount).toBe(4)
    expect(secondaryCount).toBe(2)
  })

  it('two genres: interleaved order (P, S, P, S, P, P)', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    const isPrimary = (o: string) => primaryOpts.includes(o)
    const isSecondary = (o: string) => secondaryOpts.includes(o)

    // P(0), S(0), P(1), S(1), P(2), P(3)
    expect(isPrimary(result[0])).toBe(true)
    expect(isSecondary(result[1])).toBe(true)
    expect(isPrimary(result[2])).toBe(true)
    expect(isSecondary(result[3])).toBe(true)
    expect(isPrimary(result[4])).toBe(true)
    expect(isPrimary(result[5])).toBe(true)
  })

  it('two genres: stable order within each genre', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    // Extract primary items in order they appear
    const primaryInResult = result.filter((o) => primaryOpts.includes(o))
    // Extract secondary items in order they appear
    const secondaryInResult = result.filter((o) => secondaryOpts.includes(o))

    // Primary items should maintain original order
    const primaryIndices = primaryInResult.map((o) => primaryOpts.indexOf(o))
    for (let i = 1; i < primaryIndices.length; i++) {
      expect(primaryIndices[i]).toBeGreaterThan(primaryIndices[i - 1])
    }

    // Secondary items should maintain original order
    const secondaryIndices = secondaryInResult.map((o) => secondaryOpts.indexOf(o))
    for (let i = 1; i < secondaryIndices.length; i++) {
      expect(secondaryIndices[i]).toBeGreaterThan(secondaryIndices[i - 1])
    }
  })

  it('deduplicates across genres', () => {
    const sharedOpts: Record<string, string[]> = {
      A: ['x', 'y', 'a1', 'a2', 'a3', 'a4'],
      B: ['x', 'z', 'b1', 'b2', 'b3', 'b4'],
    }
    const result = buildBalancedOptionsFromGenres(['A', 'B'], sharedOpts, ['fb'])
    expect(new Set(result).size).toBe(result.length)
    // 'x' appears only once
    const xCount = result.filter((o) => o === 'x').length
    expect(xCount).toBe(1)
  })

  it('fills missing slots from primary then fallback', () => {
    // Drama keluarga has 3 opts, Slice of life has 3 opts
    const result = buildBalancedOptionsFromGenres(
      ['Drama keluarga', 'Slice of life'],
      SMALL_GENRE_MAP,
      FALLBACK,
    )

    expect(result.length).toBe(6)

    // Interleave: P(0), S(0), P(1), S(1), P(2), S(2) → 6 filled, no fallback
    const dramaOpts = SMALL_GENRE_MAP['Drama keluarga']
    const sliceOpts = SMALL_GENRE_MAP['Slice of life']

    expect(result[0]).toBe(dramaOpts[0])
    expect(result[1]).toBe(sliceOpts[0])
    expect(result[2]).toBe(dramaOpts[1])
    expect(result[3]).toBe(sliceOpts[1])
    expect(result[4]).toBe(dramaOpts[2])
    expect(result[5]).toBe(sliceOpts[2])
  })

  it('unknown genre returns fallback', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Genre tidak dikenal'],
      GENRE_TROPE,
      FALLBACK,
    )
    expect(result).toEqual(FALLBACK)
  })

  it('reversed order: second genre as primary gets 4, first as secondary gets 2', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Romansa', 'Misteri & rahasia'],
      GENRE_TROPE,
      FALLBACK,
    )

    const romansaOpts = GENRE_TROPE['Romansa']
    const misteriOpts = GENRE_TROPE['Misteri & rahasia']

    const romansaCount = result.filter((o) => romansaOpts.includes(o)).length
    const misteriCount = result.filter((o) => misteriOpts.includes(o)).length

    // Romansa (first = primary) gets 4, Misteri (second = secondary) gets 2
    expect(romansaCount).toBe(4)
    expect(misteriCount).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════
// SECTION B: buildOptionsFromGenres (LEGACY sequential — kept for compat)
// ═══════════════════════════════════════════════════════════════════

describe('buildOptionsFromGenres (LEGACY sequential)', () => {
  it('single genre: returns up to 6 options from that genre', () => {
    const result = buildOptionsFromGenres(['Misteri & rahasia'], GENRE_TROPE, FALLBACK)
    expect(result.length).toBe(6)
    expect(result).toEqual(GENRE_TROPE['Misteri & rahasia'])
  })

  it('no genre: returns fallback (first 6)', () => {
    const result = buildOptionsFromGenres([], GENRE_TROPE, FALLBACK)
    expect(result.length).toBe(6)
    expect(result).toEqual(FALLBACK)
  })

  it('deduplicates across genres', () => {
    const sharedOpts: Record<string, string[]> = {
      A: ['x', 'y'],
      B: ['x', 'z'],
    }
    const result = buildOptionsFromGenres(['A', 'B'], sharedOpts, ['fb'])
    expect(result).toEqual(['x', 'y', 'z', 'fb'])
    expect(new Set(result).size).toBe(result.length)
  })

  it('fills missing slots from fallback', () => {
    const result = buildOptionsFromGenres(['Drama keluarga'], SMALL_GENRE_MAP, FALLBACK)
    expect(result.length).toBe(6)
    expect(result.slice(0, 3)).toEqual(SMALL_GENRE_MAP['Drama keluarga'])
    expect(result.slice(3)).toEqual(FALLBACK.slice(0, 3))
  })

  it('unknown genre returns fallback', () => {
    const result = buildOptionsFromGenres(['Genre tidak dikenal'], GENRE_TROPE, FALLBACK)
    expect(result).toEqual(FALLBACK)
  })
})
