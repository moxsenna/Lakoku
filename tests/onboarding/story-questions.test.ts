import { describe, expect, it } from 'vitest'
import { createEmptyTasteProfile, type TasteProfileV2 } from '@/lib/taste-profile/schema'
import {
  buildStorySpecificQuestions,
  countAdaptiveQuestions,
} from '@/lib/onboarding/story-questions'

function completeProfile(over: Partial<TasteProfileV2> = {}): TasteProfileV2 {
  return {
    ...createEmptyTasteProfile(),
    primaryGenreId: 'mystery',
    secondaryGenreId: 'fantasy_kingdom',
    likedConflictIds: ['mystery_hidden_identity', 'fantasy_forbidden_magic'],
    dramaIntensity: 'intense',
    pacing: 'balanced',
    languageStyle: 'cinematic_visual',
    endingBias: 'peaceful',
    contentBoundaryIds: ['boundary_graphic_violence', 'boundary_protagonist_death'],
    completedAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...over,
  }
}

describe('buildStorySpecificQuestions', () => {
  it('complete profile → 4 core questions only', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: completeProfile() })
    expect(qs.map((q) => q.key)).toEqual([
      'coreConflict',
      'protagonistRole',
      'relationshipFocus',
      'agencyStyle',
    ])
    expect(countAdaptiveQuestions(completeProfile())).toBe(4)
  })

  it('missing genre → adds genre question first', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: completeProfile({ primaryGenreId: null, secondaryGenreId: null }),
    })
    expect(qs[0].key).toBe('genre')
    expect(qs.some((q) => q.key === 'coreConflict')).toBe(true)
  })

  it('missing endingBias → adds endingDirection', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: completeProfile({ endingBias: null }),
    })
    expect(qs.map((q) => q.key)).toContain('endingDirection')
    expect(qs).toHaveLength(5)
  })

  it('null profile still returns core questions', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: null })
    expect(qs.some((q) => q.key === 'coreConflict')).toBe(true)
    expect(qs.some((q) => q.key === 'genre')).toBe(true)
  })

  it('coreConflict options prefer liked ids', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: completeProfile() })
    const conflict = qs.find((q) => q.key === 'coreConflict')!
    expect(conflict.options.some((o) => o.id === 'mystery_hidden_identity')).toBe(true)
    expect(conflict.options.length).toBeLessThanOrEqual(5)
    expect(conflict.allowAuto).toBe(true)
  })

  it('relationship helper does not promise mandatory love interest', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: completeProfile() })
    const rel = qs.find((q) => q.key === 'relationshipFocus')!
    expect(rel.helper ?? '').not.toMatch(/love interest utama/i)
    expect(rel.options.some((o) => o.id === 'relationship_self_growth')).toBe(true)
  })
})
