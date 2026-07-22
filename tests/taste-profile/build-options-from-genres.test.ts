/**
 * Test: buildOptionsFromGenres — balanced 4+2 interleave (production default).
 *
 * buildOptionsFromGenres aliases buildBalancedOptionsFromGenres.
 * Both exports share the same balanced algorithm.
 *
 * Perilaku:
 *   - 1 genre → 6 dari genre tersebut
 *   - 2+ genre → 4 primer + 2 sekunder, diinterleave, urutan stabil, dedupe by ID
 *   - secondary appears before all primary exhausted (not sequential dump)
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
// SECTION A: buildOptionsFromGenres (PRODUCTION — balanced default)
// ═══════════════════════════════════════════════════════════════════

describe('buildOptionsFromGenres (PRODUCTION balanced 4+2)', () => {
  it('single genre: returns up to 6 options from that genre', () => {
    const result = buildOptionsFromGenres(
      ['Misteri & rahasia'], GENRE_TROPE, FALLBACK,
    )
    expect(result.length).toBe(6)
    expect(result).toEqual(GENRE_TROPE['Misteri & rahasia'])
  })

  it('no genre: returns fallback (first 6)', () => {
    const result = buildOptionsFromGenres([], GENRE_TROPE, FALLBACK)
    expect(result.length).toBe(6)
    expect(result).toEqual(FALLBACK)
  })

  it('two genres: 4 primary + 2 secondary (not sequential dump of primary)', () => {
    const result = buildOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    expect(result.length).toBe(6)

    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    const primaryCount = result.filter((o) => primaryOpts.includes(o)).length
    const secondaryCount = result.filter((o) => secondaryOpts.includes(o)).length

    // Sequential bug would give primaryCount=6, secondaryCount=0
    expect(primaryCount).toBe(4)
    expect(secondaryCount).toBe(2)
  })

  it('two genres: secondary appears before all primary exhausted', () => {
    const result = buildOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    const firstSecondaryIdx = result.findIndex((o) => secondaryOpts.includes(o))
    // Secondary must appear before position 4 (i.e. before primary alone fills 4 slots)
    expect(firstSecondaryIdx).toBeGreaterThanOrEqual(0)
    expect(firstSecondaryIdx).toBeLessThan(4)

    // Interleaved order: P, S, P, S, P, P
    const isPrimary = (o: string) => primaryOpts.includes(o)
    const isSecondary = (o: string) => secondaryOpts.includes(o)

    expect(isPrimary(result[0])).toBe(true)
    expect(isSecondary(result[1])).toBe(true)
    expect(isPrimary(result[2])).toBe(true)
    expect(isSecondary(result[3])).toBe(true)
    expect(isPrimary(result[4])).toBe(true)
    expect(isPrimary(result[5])).toBe(true)
  })

  it('two genres: stable order within each genre', () => {
    const result = buildOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    const primaryInResult = result.filter((o) => primaryOpts.includes(o))
    const secondaryInResult = result.filter((o) => secondaryOpts.includes(o))

    const primaryIndices = primaryInResult.map((o) => primaryOpts.indexOf(o))
    for (let i = 1; i < primaryIndices.length; i++) {
      expect(primaryIndices[i]).toBeGreaterThan(primaryIndices[i - 1])
    }

    const secondaryIndices = secondaryInResult.map((o) => secondaryOpts.indexOf(o))
    for (let i = 1; i < secondaryIndices.length; i++) {
      expect(secondaryIndices[i]).toBeGreaterThan(secondaryIndices[i - 1])
    }
  })

  it('no duplicate IDs', () => {
    const sharedOpts: Record<string, string[]> = {
      A: ['x', 'y', 'a1', 'a2', 'a3', 'a4'],
      B: ['x', 'z', 'b1', 'b2', 'b3', 'b4'],
    }
    const result = buildOptionsFromGenres(['A', 'B'], sharedOpts, ['fb'])
    expect(new Set(result).size).toBe(result.length)
    const xCount = result.filter((o) => o === 'x').length
    expect(xCount).toBe(1)
  })

  it('fills missing slots from primary then fallback', () => {
    const result = buildOptionsFromGenres(
      ['Drama keluarga', 'Slice of life'],
      SMALL_GENRE_MAP,
      FALLBACK,
    )

    expect(result.length).toBe(6)

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
    const result = buildOptionsFromGenres(
      ['Genre tidak dikenal'],
      GENRE_TROPE,
      FALLBACK,
    )
    expect(result).toEqual(FALLBACK)
  })

  it('reversed order: second genre as primary gets 4, first as secondary gets 2', () => {
    const result = buildOptionsFromGenres(
      ['Romansa', 'Misteri & rahasia'],
      GENRE_TROPE,
      FALLBACK,
    )

    const romansaOpts = GENRE_TROPE['Romansa']
    const misteriOpts = GENRE_TROPE['Misteri & rahasia']

    const romansaCount = result.filter((o) => romansaOpts.includes(o)).length
    const misteriCount = result.filter((o) => misteriOpts.includes(o)).length

    expect(romansaCount).toBe(4)
    expect(misteriCount).toBe(2)
  })

  it('stable across repeated calls', () => {
    const a = buildOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )
    const b = buildOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )
    expect(a).toEqual(b)
  })
})

// ═══════════════════════════════════════════════════════════════════
// SECTION B: buildBalancedOptionsFromGenres (explicit export parity)
// ═══════════════════════════════════════════════════════════════════

describe('buildBalancedOptionsFromGenres (export parity)', () => {
  it('matches buildOptionsFromGenres for two genres', () => {
    const args: [string[], Record<string, string[]>, string[]] = [
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    ]
    expect(buildBalancedOptionsFromGenres(...args)).toEqual(
      buildOptionsFromGenres(...args),
    )
  })

  it('single genre: returns up to 6 options from that genre', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Misteri & rahasia'], GENRE_TROPE, FALLBACK,
    )
    expect(result.length).toBe(6)
    expect(result).toEqual(GENRE_TROPE['Misteri & rahasia'])
  })

  it('two genres: 4 primary + 2 secondary interleaved', () => {
    const result = buildBalancedOptionsFromGenres(
      ['Misteri & rahasia', 'Romansa'],
      GENRE_TROPE,
      FALLBACK,
    )

    const primaryOpts = GENRE_TROPE['Misteri & rahasia']
    const secondaryOpts = GENRE_TROPE['Romansa']

    expect(result.filter((o) => primaryOpts.includes(o)).length).toBe(4)
    expect(result.filter((o) => secondaryOpts.includes(o)).length).toBe(2)
  })
})
