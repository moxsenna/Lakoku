/**
 * Bug 3 — skip path discards partial stepAnswers.
 *
 * CURRENT: buildTasteProfileFromSteps({ mode: 'skip_with_partial' }) wipes genres.
 * DESIRED: mid/final "Lewati dulu" with answers keeps partial choices.
 * Intro "Nanti saja" / skip_intro may stay empty + skippedAt.
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

  // ── FAILING until Bug 3 fixed ──────────────────────────────────────
  it('DESIRED: skip_with_partial keeps preferredGenres (must not wipe)', () => {
    const profile = buildTasteProfileFromSteps({
      answers: { preferredGenres: ['Misteri'] },
      mode: 'skip_with_partial',
      now: NOW,
    })

    // Current wipe returns empty base without preferredGenres → fails.
    expect(profile.preferredGenres).toEqual(['Misteri'])
    expect(profile.skippedAt).toBe(NOW)
    expect(profile.updatedAt).toBe(NOW)
  })

  it('DESIRED: skip_with_partial keeps likedTropes too', () => {
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

  it('DOCUMENTS BUG: isSkip=true currently wipes answers', () => {
    // Documents CURRENT wipe so we notice when behavior changes.
    const profile = buildSkipOrSaveProfile(
      { preferredGenres: ['Misteri'] },
      true,
      NOW,
    )
    // Today: wiped. After fix, preferredGenres should survive.
    // Keep this assertion on CURRENT wipe so suite still proves baseline.
    // Pair with DESIRED tests above that fail until fix.
    expect(profile.preferredGenres).toBeUndefined()
    expect(profile.skippedAt).toBe(NOW)
  })
})
