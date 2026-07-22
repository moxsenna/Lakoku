import { describe, expect, it } from 'vitest'
import { createEmptyTasteProfile } from '@/lib/taste-profile/schema'
import { resolveAutoSelections } from '@/lib/onboarding/auto-resolve'
import {
  buildIdeaFromCreativeDirection,
  buildStoryCreativeDirection,
  creativeDirectionFingerprint,
  publicDirectionSummary,
} from '@/lib/onboarding/creative-direction'

describe('StoryCreativeDirection', () => {
  const profile = {
    ...createEmptyTasteProfile(),
    primaryGenreId: 'mystery' as const,
    secondaryGenreId: 'fantasy_kingdom' as const,
    likedConflictIds: ['mystery_hidden_identity'],
    softAvoidanceIds: ['avoid_unanswered_secret'],
    contentBoundaryIds: ['boundary_graphic_violence'],
    dramaIntensity: 'intense' as const,
    pacing: 'balanced' as const,
    languageStyle: 'cinematic_visual' as const,
    endingBias: 'peaceful' as const,
    completedAt: '2026-07-22T00:00:00.000Z',
  }

  it('builds valid direction from resolved answers', () => {
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
      now: '2026-07-22T00:00:00.000Z',
    })
    expect(direction.version).toBe(1)
    expect(direction.genre.primary).toBe('mystery')
    expect(direction.storySetup.relationshipFocus).toBe('relationship_uncertain_ally')
    expect(direction.hardBoundaries).toContain('boundary_graphic_violence')
  })

  it('fingerprint stable ignoring createdAt', () => {
    const resolved = resolveAutoSelections({
      profile,
      answers: {
        coreConflict: { mode: 'auto' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'auto' },
        agencyStyle: { mode: 'auto' },
      },
    })
    const a = buildStoryCreativeDirection({
      profile,
      resolved,
      source: 'taste_quick',
      now: '2026-07-22T00:00:00.000Z',
    })
    const b = buildStoryCreativeDirection({
      profile,
      resolved,
      source: 'taste_quick',
      now: '2026-07-23T00:00:00.000Z',
    })
    expect(creativeDirectionFingerprint(a)).toBe(creativeDirectionFingerprint(b))
  })

  it('idea prompt soft vs hard split', () => {
    const resolved = resolveAutoSelections({
      profile,
      answers: {
        coreConflict: { mode: 'auto' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'auto' },
        agencyStyle: { mode: 'auto' },
      },
    })
    const direction = buildStoryCreativeDirection({
      profile,
      resolved,
      source: 'taste_quick',
    })
    const idea = buildIdeaFromCreativeDirection(direction)
    expect(idea).toContain('BATAS KONTEN WAJIB')
    expect(idea).toContain('Kurangi atau hindari bila tidak diperlukan')
    expect(idea).toContain('Konflik utama cerita ini')
    expect(idea).not.toMatch(/JANGAN pakai trope/i)
  })

  it('public summary is reader-safe', () => {
    const resolved = resolveAutoSelections({
      profile,
      answers: {
        coreConflict: { mode: 'auto' },
        protagonistRole: { mode: 'auto' },
        relationshipFocus: { mode: 'auto' },
        agencyStyle: { mode: 'auto' },
      },
    })
    const direction = buildStoryCreativeDirection({
      profile,
      resolved,
      source: 'taste_quick',
    })
    const summary = publicDirectionSummary(direction)
    expect(summary.toLowerCase()).not.toContain('prompt')
    expect(summary.toLowerCase()).not.toContain('profile')
    expect(summary.toLowerCase()).not.toContain('ai')
    expect(summary.length).toBeGreaterThan(0)
  })
})
