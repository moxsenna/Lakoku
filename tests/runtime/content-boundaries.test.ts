import { describe, expect, it } from 'vitest'
import {
  boundaryMustNotInclude,
  softPreferenceHints,
  validateContentBoundaries,
} from '@/lib/runtime/content-boundaries'
import { createEmptyTasteProfile } from '@/lib/taste-profile/schema'
import { resolveAutoSelections } from '@/lib/onboarding/auto-resolve'
import { buildStoryCreativeDirection } from '@/lib/onboarding/creative-direction'

function directionWithBoundaries(ids: string[]) {
  const profile = {
    ...createEmptyTasteProfile(),
    primaryGenreId: 'mystery' as const,
    contentBoundaryIds: ids,
    completedAt: '2026-07-22T00:00:00.000Z',
  }
  const resolved = resolveAutoSelections({
    profile,
    answers: {
      coreConflict: { mode: 'auto' },
      protagonistRole: { mode: 'auto' },
      relationshipFocus: { mode: 'auto' },
      agencyStyle: { mode: 'auto' },
    },
  })
  return buildStoryCreativeDirection({
    profile,
    resolved,
    source: 'taste_quick',
  })
}

describe('validateContentBoundaries', () => {
  it('flags protagonist death when boundary active', () => {
    const direction = directionWithBoundaries(['boundary_protagonist_death'])
    const findings = validateContentBoundaries({
      prose: 'Di akhir adegan, aku mati di pelukan sekutuku.',
      direction,
    })
    expect(findings.some((f) => f.code === 'BOUNDARY_PROTAGONIST_DEATH')).toBe(true)
  })

  it('passes clean prose', () => {
    const direction = directionWithBoundaries(['boundary_protagonist_death'])
    const findings = validateContentBoundaries({
      prose: 'Aku berdiri di ambang pintu arsip, menahan napas.',
      direction,
    })
    expect(findings).toHaveLength(0)
  })

  it('no findings when no direction', () => {
    expect(
      validateContentBoundaries({
        prose: 'aku mati sekarang',
        direction: null,
      }),
    ).toHaveLength(0)
  })

  it('mustNotInclude lists boundary labels', () => {
    const direction = directionWithBoundaries(['boundary_graphic_violence'])
    const lines = boundaryMustNotInclude(direction)
    expect(lines.some((l) => l.toLowerCase().includes('kekerasan'))).toBe(true)
  })

  it('soft hints include language style', () => {
    const profile = {
      ...createEmptyTasteProfile(),
      primaryGenreId: 'mystery' as const,
      languageStyle: 'cinematic_visual' as const,
      dramaIntensity: 'intense' as const,
      completedAt: '2026-07-22T00:00:00.000Z',
    }
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
    const hints = softPreferenceHints(direction)
    expect(hints.some((h) => h.toLowerCase().includes('sinematik'))).toBe(true)
  })
})
