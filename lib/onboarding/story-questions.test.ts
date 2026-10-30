// lib/onboarding/story-questions.test.ts
import { describe, expect, it } from 'vitest'
import { applySessionOverrides, buildStorySpecificQuestions } from './story-questions'
import { createEmptyTasteProfile } from '@/lib/taste-profile/schema'

describe('buildStorySpecificQuestions — guest tanpa profil selera', () => {
  it('genre yang dipilih di kuis menyesuaikan opsi konflik (bukan fallback misteri+fantasi)', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: null,
      sessionOverrides: { primaryGenreId: 'romance' },
    })
    const conflict = qs.find((q) => q.key === 'coreConflict')
    expect(conflict).toBeDefined()
    expect(conflict?.options.map((o) => o.id).slice(0, 3)).toEqual([
      'romance_enemies_allies',
      'romance_old_love_returns',
      'romance_contract_relationship',
    ])
  })

  it('peran protagonis mengikuti genre yang dipilih', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: null,
      sessionOverrides: { primaryGenreId: 'survival_thriller' },
    })
    const role = qs.find((q) => q.key === 'protagonistRole')
    expect(role?.options.map((o) => o.id).slice(0, 3)).toEqual([
      'role_thriller_survivor',
      'role_thriller_witness',
      'role_thriller_rescuer',
    ])
  })

  it('genre yang dipilih pre-fill di paling atas pertanyaan genre', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: null,
      sessionOverrides: { primaryGenreId: 'slice_of_life' },
    })
    expect(qs[0].key).toBe('genre')
    expect(qs[0].options[0].id).toBe('slice_of_life')
  })

  it('guest tanpa genre apa pun tetap mendapat fallback misteri+fantasi', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: null })
    const conflict = qs.find((q) => q.key === 'coreConflict')
    expect(conflict?.options.map((o) => o.id).slice(0, 5)).toEqual([
      'mystery_hidden_identity',
      'fantasy_throne_struggle',
      'mystery_old_death',
      'fantasy_forbidden_magic',
      'mystery_old_object_clue',
    ])
  })
})

describe('applySessionOverrides', () => {
  it('override diterapkan meski profil null (guest)', () => {
    const p = applySessionOverrides(null, { primaryGenreId: 'survival_thriller' })
    expect(p?.primaryGenreId).toBe('survival_thriller')
  })

  it('profil null tanpa override tetap null', () => {
    expect(applySessionOverrides(null, null)).toBeNull()
    expect(applySessionOverrides(null)).toBeNull()
  })

  it('merge ke profil yang ada tanpa menimpa field lain', () => {
    const base = { ...createEmptyTasteProfile(), endingBias: 'justice' as const }
    const merged = applySessionOverrides(base, { primaryGenreId: 'romance' })
    expect(merged?.primaryGenreId).toBe('romance')
    expect(merged?.endingBias).toBe('justice')
  })
})
