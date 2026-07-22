import { describe, expect, it } from 'vitest'
import {
  BOUNDARY_NONE,
  buildConflictOptionEntries,
  buildProfileFromAnswers,
  buildTasteSummaryLines,
  canAdvanceFromPhase,
  emptyAnswers,
  invalidConflictsAfterGenreChange,
  toggleGenre,
  toggleHardBoundary,
  toggleMulti,
  type TasteOnboardingAnswers,
} from '@/lib/taste-profile/onboarding-state'

function withGenre(primary: 'mystery' | 'romance' | 'fantasy_kingdom', secondary?: 'mystery' | 'romance' | 'fantasy_kingdom'): TasteOnboardingAnswers {
  return {
    ...emptyAnswers(),
    primaryGenreId: primary,
    secondaryGenreId: secondary ?? null,
  }
}

describe('toggleGenre', () => {
  it('sets primary then secondary', () => {
    const a = emptyAnswers()
    let r = toggleGenre(a, 'mystery')
    expect(r.answers.primaryGenreId).toBe('mystery')
    expect(r.maxReached).toBe(false)

    r = toggleGenre(r.answers, 'fantasy_kingdom')
    expect(r.answers.primaryGenreId).toBe('mystery')
    expect(r.answers.secondaryGenreId).toBe('fantasy_kingdom')
  })

  it('rejects third genre', () => {
    const a = withGenre('mystery', 'fantasy_kingdom')
    const r = toggleGenre(a, 'romance')
    expect(r.maxReached).toBe(true)
    expect(r.answers.primaryGenreId).toBe('mystery')
    expect(r.answers.secondaryGenreId).toBe('fantasy_kingdom')
  })

  it('promotes secondary when primary removed', () => {
    const a = withGenre('mystery', 'fantasy_kingdom')
    const r = toggleGenre(a, 'mystery')
    expect(r.answers.primaryGenreId).toBe('fantasy_kingdom')
    expect(r.answers.secondaryGenreId).toBeNull()
  })
})

describe('buildConflictOptionEntries', () => {
  it('returns 6 from single genre', () => {
    const opts = buildConflictOptionEntries('mystery', null)
    expect(opts).toHaveLength(6)
    expect(opts.every((o) => o.id.startsWith('mystery_'))).toBe(true)
  })

  it('returns 4 primary + 2 secondary interleaved for two genres', () => {
    const opts = buildConflictOptionEntries('mystery', 'fantasy_kingdom')
    expect(opts).toHaveLength(6)
    const primary = opts.filter((o) => o.id.startsWith('mystery_'))
    const secondary = opts.filter((o) => o.id.startsWith('fantasy_'))
    expect(primary.length).toBe(4)
    expect(secondary.length).toBe(2)
    // Secondary appears before all primary exhausted (not all primary first)
    const firstSecondaryIdx = opts.findIndex((o) => o.id.startsWith('fantasy_'))
    expect(firstSecondaryIdx).toBeGreaterThanOrEqual(0)
    expect(firstSecondaryIdx).toBeLessThan(5)
  })
})

describe('toggleHardBoundary', () => {
  it('none clears others', () => {
    const next = toggleHardBoundary(
      ['boundary_graphic_violence', 'boundary_torture'],
      BOUNDARY_NONE,
    )
    expect(next).toEqual([BOUNDARY_NONE])
  })

  it('real boundary clears none', () => {
    const next = toggleHardBoundary([BOUNDARY_NONE], 'boundary_graphic_violence')
    expect(next).toEqual(['boundary_graphic_violence'])
    expect(next).not.toContain(BOUNDARY_NONE)
  })
})

describe('toggleMulti max', () => {
  it('rejects beyond max', () => {
    const r = toggleMulti(['a', 'b', 'c'], 'd', 3)
    expect(r.maxReached).toBe(true)
    expect(r.next).toEqual(['a', 'b', 'c'])
  })
})

describe('canAdvanceFromPhase', () => {
  it('genre requires primary', () => {
    expect(canAdvanceFromPhase('genre', emptyAnswers())).toBe(false)
    expect(canAdvanceFromPhase('genre', withGenre('mystery'))).toBe(true)
  })

  it('conflicts requires at least one', () => {
    const a = withGenre('mystery')
    expect(canAdvanceFromPhase('conflicts', a)).toBe(false)
    expect(
      canAdvanceFromPhase('conflicts', { ...a, likedConflictIds: ['mystery_hidden_identity'] }),
    ).toBe(true)
  })

  it('tone requires intensity and pacing', () => {
    const a = { ...withGenre('mystery'), dramaIntensity: 'intense' as const }
    expect(canAdvanceFromPhase('tone', a)).toBe(false)
    expect(canAdvanceFromPhase('tone', { ...a, pacing: 'balanced' })).toBe(true)
  })

  it('ending requires both ending and language', () => {
    const a = { ...withGenre('mystery'), endingBias: 'peaceful' as const }
    expect(canAdvanceFromPhase('ending_style', a)).toBe(false)
    expect(
      canAdvanceFromPhase('ending_style', { ...a, languageStyle: 'cinematic_visual' }),
    ).toBe(true)
  })
})

describe('buildProfileFromAnswers', () => {
  it('skip_intro is empty with skippedAt only', () => {
    const p = buildProfileFromAnswers(emptyAnswers(), {
      mode: 'skip_intro',
      now: '2026-07-22T00:00:00.000Z',
    })
    expect(p.version).toBe(2)
    expect(p.primaryGenreId).toBeNull()
    expect(p.dramaIntensity).toBeNull()
    expect(p.languageStyle).toBeNull()
    expect(p.endingBias).toBeNull()
    expect(p.skippedAt).toBe('2026-07-22T00:00:00.000Z')
    expect(p.completedAt).toBeNull()
  })

  it('complete strips boundary_none and sets completedAt', () => {
    const a: TasteOnboardingAnswers = {
      ...withGenre('mystery', 'fantasy_kingdom'),
      likedConflictIds: ['mystery_hidden_identity'],
      contentBoundaryIds: [BOUNDARY_NONE],
      dramaIntensity: 'intense',
      pacing: 'balanced',
      languageStyle: 'cinematic_visual',
      endingBias: 'peaceful',
    }
    const p = buildProfileFromAnswers(a, {
      mode: 'complete',
      now: '2026-07-22T00:00:00.000Z',
    })
    expect(p.contentBoundaryIds).toEqual([])
    expect(p.completedAt).toBe('2026-07-22T00:00:00.000Z')
    expect(p.primaryGenreId).toBe('mystery')
    expect(p.secondaryGenreId).toBe('fantasy_kingdom')
  })
})

describe('invalidConflictsAfterGenreChange', () => {
  it('flags conflicts outside new genre options', () => {
    const invalid = invalidConflictsAfterGenreChange(
      ['mystery_hidden_identity', 'romance_old_love_returns'],
      'mystery',
      null,
    )
    expect(invalid).toContain('romance_old_love_returns')
    expect(invalid).not.toContain('mystery_hidden_identity')
  })
})

describe('buildTasteSummaryLines', () => {
  it('builds reader-safe summary lines', () => {
    const lines = buildTasteSummaryLines({
      ...withGenre('mystery', 'fantasy_kingdom'),
      dramaIntensity: 'intense',
      pacing: 'balanced',
      languageStyle: 'cinematic_visual',
      endingBias: 'peaceful',
      contentBoundaryIds: ['boundary_graphic_violence', 'boundary_protagonist_death'],
    })
    expect(lines.some((l) => l.includes('Misteri'))).toBe(true)
    expect(lines.some((l) => l.includes('Fantasi'))).toBe(true)
    expect(lines.some((l) => l.includes('Intens'))).toBe(true)
    expect(lines.some((l) => l.includes('sinematik') || l.includes('Sinematik'))).toBe(true)
    expect(lines.some((l) => l.includes('2 batas'))).toBe(true)
  })
})
