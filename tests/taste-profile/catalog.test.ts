/**
 * Test: catalog.ts — plan §6 stable IDs and labels.
 */
import { describe, expect, it } from 'vitest'
import {
  GENRE_IDS,
  GENRE_CATALOG,
  GENRE_LABEL,
  GENRE_BY_LABEL,
  V1_GENRE_LABEL_TO_ID,
  resolveGenreId,
  isGenreId,
  CONFLICT_CATALOG_BY_GENRE,
  CONFLICT_CATALOG,
  SOFT_AVOIDANCE_IDS,
  SOFT_AVOIDANCE_CATALOG,
  SOFT_AVOIDANCE_LABEL,
  SOFT_AVOIDANCE_BY_LABEL,
  isSoftAvoidanceId,
  CONTENT_BOUNDARY_IDS,
  CONTENT_BOUNDARY_CATALOG,
  CONTENT_BOUNDARY_LABEL,
  CONTENT_BOUNDARY_BY_LABEL,
  BOUNDARY_NONE,
  isContentBoundaryId,
  DRAMA_INTENSITY_IDS,
  DRAMA_INTENSITY_LABEL,
  PACING_IDS,
  PACING_LABEL,
  LANGUAGE_STYLE_IDS,
  LANGUAGE_STYLE_LABEL,
  ENDING_BIAS_IDS,
  ENDING_BIAS_LABEL,
  V1_DRAMA_INTENSITY_MAP,
  V1_PACING_MAP,
  V1_LANGUAGE_STYLE_MAP,
  V1_ENDING_BIAS_MAP,
  V1_AVOIDED_TO_SOFT,
  V1_AVOIDED_TO_HARD,
  labelForId,
} from '@/lib/taste-profile/catalog'

describe('catalog — genre', () => {
  it('has exactly 6 genres', () => {
    expect(GENRE_IDS).toHaveLength(6)
    expect(GENRE_CATALOG).toHaveLength(6)
  })

  it('every GENRE_ID has a label', () => {
    for (const id of GENRE_IDS) {
      expect(GENRE_LABEL[id]).toBeTruthy()
      expect(isGenreId(id)).toBe(true)
    }
  })

  it('GENRE_BY_LABEL resolves labels back to IDs', () => {
    for (const id of GENRE_IDS) {
      const label = GENRE_LABEL[id]
      expect(GENRE_BY_LABEL[label.toLowerCase()]).toBe(id)
    }
  })

  it('resolveGenreId resolves known V1 labels', () => {
    expect(resolveGenreId('Drama keluarga')).toBe('family_drama')
    expect(resolveGenreId('Romansa')).toBe('romance')
    expect(resolveGenreId('Misteri & rahasia')).toBe('mystery')
    expect(resolveGenreId('Fantasi & kerajaan')).toBe('fantasy_kingdom')
    expect(resolveGenreId('Slice of life')).toBe('slice_of_life')
    expect(resolveGenreId('Thriller & bertahan hidup')).toBe('survival_thriller')
  })

  it('resolveGenreId resolves V1 aliases', () => {
    expect(resolveGenreId('misteri')).toBe('mystery')
    expect(resolveGenreId('fantasi')).toBe('fantasy_kingdom')
    expect(resolveGenreId('petualangan')).toBe('fantasy_kingdom')
    expect(V1_GENRE_LABEL_TO_ID['drama keluarga']).toBe('family_drama')
  })

  it('resolveGenreId is case-insensitive and whitespace-tolerant', () => {
    expect(resolveGenreId('  DRAMA keluarga ')).toBe('family_drama')
    expect(resolveGenreId('ROMANSA')).toBe('romance')
  })

  it('resolveGenreId returns null for unknown genre', () => {
    expect(resolveGenreId('Genre tidak dikenal')).toBeNull()
    expect(resolveGenreId('')).toBeNull()
  })
})

describe('catalog — conflict catalogs (plan §6.3)', () => {
  it('each genre has exactly 6 conflicts with stable IDs', () => {
    for (const id of GENRE_IDS) {
      const conflicts = CONFLICT_CATALOG_BY_GENRE[id]
      expect(conflicts).toBeDefined()
      expect(conflicts).toHaveLength(6)
      for (const c of conflicts) {
        expect(c.id).toBeTruthy()
        expect(c.label).toBeTruthy()
        expect(labelForId(c.id)).toBe(c.label)
      }
    }
  })

  it('includes exact plan conflict IDs', () => {
    const familyIds = CONFLICT_CATALOG_BY_GENRE.family_drama.map((c) => c.id)
    expect(familyIds).toContain('family_inheritance_split')
    expect(familyIds).toContain('family_return_with_secret')
    expect(familyIds).toContain('family_chosen_vs_blood')

    const romanceIds = CONFLICT_CATALOG_BY_GENRE.romance.map((c) => c.id)
    expect(romanceIds).toContain('romance_old_love_returns')
    expect(romanceIds).toContain('romance_contract_relationship')

    const mysteryIds = CONFLICT_CATALOG_BY_GENRE.mystery.map((c) => c.id)
    expect(mysteryIds).toContain('mystery_hidden_identity')
    expect(mysteryIds).toContain('mystery_family_coverup')
  })

  it('CONFLICT_CATALOG exposes labels for each genre', () => {
    for (const id of GENRE_IDS) {
      expect(CONFLICT_CATALOG[id]).toHaveLength(6)
    }
  })
})

describe('catalog — soft avoidance (plan §6.4 A)', () => {
  it('has exactly 8 items with avoid_ prefix IDs', () => {
    expect(SOFT_AVOIDANCE_IDS).toHaveLength(8)
    expect(SOFT_AVOIDANCE_CATALOG).toHaveLength(8)
    for (const id of SOFT_AVOIDANCE_IDS) {
      expect(id.startsWith('avoid_')).toBe(true)
      expect(SOFT_AVOIDANCE_LABEL[id]).toBeTruthy()
      expect(isSoftAvoidanceId(id)).toBe(true)
    }
  })

  it('includes plan soft IDs', () => {
    expect(SOFT_AVOIDANCE_IDS).toContain('avoid_unearned_twist')
    expect(SOFT_AVOIDANCE_IDS).toContain('avoid_plot_induced_stupidity')
    expect(SOFT_AVOIDANCE_IDS).toContain('avoid_romance_takeover')
    expect(SOFT_AVOIDANCE_IDS).toContain('avoid_ambiguous_ending')
  })

  it('SOFT_AVOIDANCE_BY_LABEL resolves labels back to IDs', () => {
    for (const id of SOFT_AVOIDANCE_IDS) {
      const label = SOFT_AVOIDANCE_LABEL[id]
      expect(SOFT_AVOIDANCE_BY_LABEL[label.toLowerCase()]).toBe(id)
    }
  })
})

describe('catalog — content boundaries (plan §6.4 B)', () => {
  it('has exactly 9 items with boundary_ prefix + BOUNDARY_NONE', () => {
    expect(CONTENT_BOUNDARY_IDS).toHaveLength(9)
    expect(CONTENT_BOUNDARY_CATALOG).toHaveLength(9)
    expect(BOUNDARY_NONE).toBe('boundary_none')
    for (const id of CONTENT_BOUNDARY_IDS) {
      expect(id.startsWith('boundary_')).toBe(true)
      expect(CONTENT_BOUNDARY_LABEL[id]).toBeTruthy()
      expect(isContentBoundaryId(id)).toBe(true)
    }
    expect(isContentBoundaryId(BOUNDARY_NONE)).toBe(true)
  })

  it('includes plan hard boundary IDs', () => {
    expect(CONTENT_BOUNDARY_IDS).toContain('boundary_graphic_violence')
    expect(CONTENT_BOUNDARY_IDS).toContain('boundary_partner_infidelity')
    expect(CONTENT_BOUNDARY_IDS).toContain('boundary_protagonist_death')
    expect(CONTENT_BOUNDARY_IDS).toContain('boundary_intense_horror')
    expect(CONTENT_BOUNDARY_IDS).toContain('boundary_explicit_sexual_content')
  })

  it('CONTENT_BOUNDARY_BY_LABEL resolves labels back to IDs', () => {
    for (const id of CONTENT_BOUNDARY_IDS) {
      const label = CONTENT_BOUNDARY_LABEL[id]
      expect(CONTENT_BOUNDARY_BY_LABEL[label.toLowerCase()]).toBe(id)
    }
  })
})

describe('catalog — intensity, pacing, language, ending', () => {
  it('dramaIntensity Hangat/Seimbang/Intens', () => {
    expect(DRAMA_INTENSITY_IDS).toEqual(['warm', 'balanced', 'intense'])
    expect(DRAMA_INTENSITY_LABEL.warm).toBe('Hangat')
    expect(DRAMA_INTENSITY_LABEL.balanced).toBe('Seimbang')
    expect(DRAMA_INTENSITY_LABEL.intense).toBe('Intens')
  })

  it('pacing has 3 values with labels', () => {
    expect(PACING_IDS).toHaveLength(3)
    for (const id of PACING_IDS) {
      expect(PACING_LABEL[id]).toBeTruthy()
    }
  })

  it('languageStyle has 3 values with labels', () => {
    expect(LANGUAGE_STYLE_IDS).toHaveLength(3)
    for (const id of LANGUAGE_STYLE_IDS) {
      expect(LANGUAGE_STYLE_LABEL[id]).toBeTruthy()
    }
  })

  it('endingBias has 4 values with labels', () => {
    expect(ENDING_BIAS_IDS).toHaveLength(4)
    for (const id of ENDING_BIAS_IDS) {
      expect(ENDING_BIAS_LABEL[id]).toBeTruthy()
    }
  })
})

describe('catalog — V1 mapping maps', () => {
  it('V1 enum maps cover all V1 values', () => {
    expect(V1_DRAMA_INTENSITY_MAP).toMatchObject({
      ringan: 'warm',
      sedang: 'balanced',
      tinggi: 'intense',
    })
    expect(V1_PACING_MAP).toHaveProperty('slow-burn')
    expect(V1_LANGUAGE_STYLE_MAP).toHaveProperty('sinematik')
    expect(V1_ENDING_BIAS_MAP).toHaveProperty('tragis-manis')
  })

  it('V1_AVOIDED_TO_HARD maps UI strings to boundary_*', () => {
    expect(V1_AVOIDED_TO_HARD['kekerasan eksplisit']).toBe('boundary_graphic_violence')
    expect(V1_AVOIDED_TO_HARD['pengkhianatan pasangan']).toBe('boundary_partner_infidelity')
    expect(V1_AVOIDED_TO_HARD['kematian tokoh utama']).toBe('boundary_protagonist_death')
    expect(V1_AVOIDED_TO_HARD['horor & jumpscare']).toBe('boundary_intense_horror')
    expect(V1_AVOIDED_TO_HARD['konflik perang']).toBe('boundary_graphic_violence')
  })

  it('V1_AVOIDED_TO_SOFT maps quality strings to avoid_*', () => {
    expect(V1_AVOIDED_TO_SOFT['cinta segitiga']).toBe('avoid_romance_takeover')
    expect(V1_AVOIDED_TO_SOFT['twist tanpa petunjuk']).toBe('avoid_unearned_twist')
    expect(V1_AVOIDED_TO_SOFT['tokoh terlalu bodoh demi plot']).toBe(
      'avoid_plot_induced_stupidity',
    )
  })
})

describe('catalog — labelForId', () => {
  it('resolves across catalogs; null for unknown', () => {
    expect(labelForId('family_drama')).toBe('Drama keluarga')
    expect(labelForId('family_inheritance_split')).toBe('Warisan yang memecah keluarga')
    expect(labelForId('avoid_unearned_twist')).toBe('Twist yang muncul tanpa petunjuk')
    expect(labelForId('boundary_graphic_violence')).toBe(
      'Kekerasan yang digambarkan secara grafis',
    )
    expect(labelForId(BOUNDARY_NONE)).toBe('Tidak ada batas khusus')
    expect(labelForId('not_a_real_id')).toBeNull()
  })
})
