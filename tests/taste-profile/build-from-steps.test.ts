/**
 * skip path preserves partial stepAnswers.
 *
 * skip_with_partial: mid/final "Lewati dulu" with answers keeps partial choices.
 * skip_intro / intro "Nanti saja": empty + skippedAt.
 */
import { describe, expect, it } from 'vitest'
import {
  buildSkipOrSaveProfile,
  buildTasteProfileFromSteps,
} from '@/lib/taste-profile/build-from-steps'

const NOW = '2026-07-22T12:00:00.000Z'

describe('buildTasteProfileFromSteps — skip vs complete', () => {
  it('complete mode keeps preferredGenres and sets completedAt', () => {
    const profile = buildTasteProfileFromSteps({
      answers: { preferredGenres: ['Misteri'] },
      mode: 'complete',
      now: NOW,
    })

    expect(profile.preferredGenres).toEqual(['Misteri'])
    expect(profile.completedAt).toBe(NOW)
    expect(profile.skippedAt).toBeNull()
    expect(profile.updatedAt).toBe(NOW)
  })

  it('skip_intro yields empty profile + skippedAt (OK for intro Nanti saja)', () => {
    const profile = buildTasteProfileFromSteps({
      answers: {},
      mode: 'skip_intro',
      now: NOW,
    })

    expect(profile.skippedAt).toBe(NOW)
    expect(profile.completedAt).toBeNull()
    expect(profile.preferredGenres).toBeUndefined()
  })

  it('skip_with_partial keeps preferredGenres (must not wipe)', () => {
    const profile = buildTasteProfileFromSteps({
      answers: { preferredGenres: ['Misteri'] },
      mode: 'skip_with_partial',
      now: NOW,
    })

    expect(profile.preferredGenres).toEqual(['Misteri'])
    expect(profile.skippedAt).toBe(NOW)
    expect(profile.updatedAt).toBe(NOW)
  })

  it('skip_with_partial keeps likedTropes too', () => {
    const profile = buildTasteProfileFromSteps({
      answers: {
        preferredGenres: ['Misteri'],
        likedTropes: ['Rahasia keluarga'],
      },
      mode: 'skip_with_partial',
      now: NOW,
    })

    expect(profile.preferredGenres).toEqual(['Misteri'])
    expect(profile.likedTropes).toEqual(['Rahasia keluarga'])
    expect(profile.skippedAt).toBe(NOW)
  })
})

describe('buildSkipOrSaveProfile — component shim', () => {
  it('isSkip=false spreads answers', () => {
    const profile = buildSkipOrSaveProfile(
      { preferredGenres: ['Romansa'] },
      false,
      NOW,
    )
    expect(profile.preferredGenres).toEqual(['Romansa'])
    expect(profile.completedAt).toBe(NOW)
  })

  it('isSkip=true keeps partial answers + skippedAt', () => {
    const profile = buildSkipOrSaveProfile(
      { preferredGenres: ['Misteri'] },
      true,
      NOW,
    )
    expect(profile.preferredGenres).toEqual(['Misteri'])
    expect(profile.skippedAt).toBe(NOW)
  })
})
