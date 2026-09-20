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
  it('complete profile → genre first, then 4 core questions', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: completeProfile() })
    expect(qs.map((q) => q.key)).toEqual([
      'genre',
      'coreConflict',
      'protagonistRole',
      'relationshipFocus',
      'agencyStyle',
    ])
    expect(countAdaptiveQuestions(completeProfile())).toBe(5)
  })

  it('missing endingBias → adds endingDirection', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: completeProfile({ endingBias: null }),
    })
    expect(qs.map((q) => q.key)).toContain('endingDirection')
    expect(qs).toHaveLength(6)
  })

  it('genre question always first, profile genre ordered on top', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: completeProfile() })
    expect(qs[0].key).toBe('genre')
    expect(qs[0].options[0].id).toBe('mystery')
    expect(qs[0].options).toHaveLength(6)
  })

  it('null profile still returns genre + core questions', () => {
    const qs = buildStorySpecificQuestions({ tasteProfile: null })
    expect(qs[0].key).toBe('genre')
    expect(qs.some((q) => q.key === 'coreConflict')).toBe(true)
  })

  it('session override genre adapts conflict options to the chosen genre', () => {
    const qs = buildStorySpecificQuestions({
      tasteProfile: completeProfile({ likedConflictIds: [] }),
      sessionOverrides: { primaryGenreId: 'romance' },
    })
    expect(qs[0].options[0].id).toBe('romance')
    const conflict = qs.find((q) => q.key === 'coreConflict')!
    expect(conflict.options.some((o) => o.id.startsWith('romance_'))).toBe(true)
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
