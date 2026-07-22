import { describe, expect, it } from 'vitest'
import { createEmptyTasteProfile, type TasteProfileV2 } from '@/lib/taste-profile/schema'
import {
  isForbiddenUniversalDefault,
  resolveAutoSelections,
} from '@/lib/onboarding/auto-resolve'

function mysteryProfile(): TasteProfileV2 {
  return {
    ...createEmptyTasteProfile(),
    primaryGenreId: 'mystery',
    secondaryGenreId: 'fantasy_kingdom',
    likedConflictIds: ['mystery_hidden_identity', 'fantasy_forbidden_magic'],
    dramaIntensity: 'intense',
    pacing: 'balanced',
    languageStyle: 'cinematic_visual',
    endingBias: 'peaceful',
    completedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('resolveAutoSelections', () => {
  it('auto conflict is not universal romance default', () => {
    const resolved = resolveAutoSelections({
      profile: mysteryProfile(),
      answers: {
        coreConflict: { mode: 'auto' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'auto' },
        agencyStyle: { mode: 'auto' },
      },
    })

    expect(isForbiddenUniversalDefault(resolved.coreConflict.label)).toBe(false)
    expect(resolved.coreConflict.label?.toLowerCase()).not.toContain('pasangan yang berkhianat')
    expect(resolved.coreConflict.resolvedFromAuto).toBe(true)
    expect(resolved.coreConflict.id).toBe('mystery_hidden_identity')
  })

  it('is deterministic for same input', () => {
    const profile = mysteryProfile()
    const answers = {
      coreConflict: { mode: 'auto' as const },
      protagonistRole: { mode: 'auto' as const },
      relationshipFocus: { mode: 'auto' as const },
      agencyStyle: { mode: 'auto' as const },
    }
    const a = resolveAutoSelections({ profile, answers })
    const b = resolveAutoSelections({ profile, answers })
    expect(a).toEqual(b)
  })

  it('selected id is preserved', () => {
    const resolved = resolveAutoSelections({
      profile: mysteryProfile(),
      answers: {
        coreConflict: { mode: 'selected', value: 'fantasy_forbidden_magic' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'selected', value: 'relationship_uncertain_ally' },
        agencyStyle: { mode: 'auto' },
      },
    })
    expect(resolved.coreConflict.id).toBe('fantasy_forbidden_magic')
    expect(resolved.coreConflict.resolvedFromAuto).toBe(false)
    expect(resolved.relationshipFocus.id).toBe('relationship_uncertain_ally')
  })

  it('custom text is preserved', () => {
    const resolved = resolveAutoSelections({
      profile: mysteryProfile(),
      answers: {
        coreConflict: { mode: 'custom', text: '  Pewaris tersembunyi di istana  ' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'auto' },
        agencyStyle: { mode: 'auto' },
      },
    })
    expect(resolved.coreConflict.customText).toBe('Pewaris tersembunyi di istana')
    expect(resolved.coreConflict.id).toBeNull()
  })
})
