/**
 * Direction propagation past premise — cast/mystery/world accept direction.
 */
import { describe, expect, it } from 'vitest'
import {
  authoringStageAcceptsDirection,
  buildCreativeDirectionPromptBlock,
  type CreativeDirectionInput,
} from '@/lib/authoring/creative-direction'
import { createEmptyTasteProfile } from '@/lib/taste-profile/schema'
import { resolveAutoSelections } from '@/lib/onboarding/auto-resolve'
import { buildStoryCreativeDirection } from '@/lib/onboarding/creative-direction'
import { stageDirectionHints } from '@/lib/authoring/creative-direction'

const sampleDirection: CreativeDirectionInput = {
  hardBoundaries: ['Tanpa kekerasan eksplisit'],
  softAvoidances: ['Cinta segitiga'],
  storySetup: { trope: 'Rahasia keluarga' },
}

describe('Authoring direction propagation', () => {
  it('cast stage accepts creative direction', () => {
    expect(authoringStageAcceptsDirection('cast')).toBe(true)
  })

  it('mystery stage accepts creative direction', () => {
    expect(authoringStageAcceptsDirection('mystery')).toBe(true)
  })

  it('world stage accepts creative direction', () => {
    expect(authoringStageAcceptsDirection('world')).toBe(true)
  })

  it('buildCreativeDirectionPromptBlock returns non-empty prompt text', () => {
    const block = buildCreativeDirectionPromptBlock(sampleDirection)
    expect(typeof block).toBe('string')
    expect(block.length).toBeGreaterThan(0)
    expect(block).toContain('Tanpa kekerasan eksplisit')
    expect(block).toContain('Rahasia keluarga')
  })

  it('snapshot direction includes hard boundaries and role hints', () => {
    const profile = {
      ...createEmptyTasteProfile(),
      primaryGenreId: 'mystery' as const,
      secondaryGenreId: 'fantasy_kingdom' as const,
      likedConflictIds: ['mystery_hidden_identity'],
      contentBoundaryIds: ['boundary_graphic_violence'],
      dramaIntensity: 'intense' as const,
      languageStyle: 'cinematic_visual' as const,
      endingBias: 'peaceful' as const,
      completedAt: '2026-07-22T00:00:00.000Z',
    }
    const resolved = resolveAutoSelections({
      profile,
      answers: {
        coreConflict: { mode: 'auto' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'selected', value: 'relationship_uncertain_ally' },
        agencyStyle: { mode: 'selected', value: 'agency_observe' },
      },
    })
    const direction = buildStoryCreativeDirection({
      profile,
      resolved,
      source: 'taste_quick',
    })
    const block = buildCreativeDirectionPromptBlock(direction)
    expect(block).toContain('BATAS KONTEN WAJIB')
    expect(block).toContain('Peran protagonis')
    const castHints = stageDirectionHints('cast', direction)
    expect(castHints.length).toBeGreaterThan(0)
  })
})
