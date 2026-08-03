import { describe, expect, it } from 'vitest'
import { runContinuityChecks } from '../../lib/narrative/continuity-checks'
import {
  NADIA_RAKA_BAD_CHAPTER_2,
  NADIA_RAKA_CONTINUATION,
  NADIA_RAKA_GOOD_CHAPTER_2,
  nadiaRakaSnapshot,
} from '../../fixtures/narrative/nadia-raka-continuity'

describe('Nadia/Raka Continuity Discontinuity Regression', () => {
  const mockSnapshot = nadiaRakaSnapshot()

  it('mendeteksi Bab 2 buram (reset ke Sari di kedai kopi) sebagai MAJOR jangkar hilang', () => {
    const findings = runContinuityChecks(mockSnapshot, NADIA_RAKA_BAD_CHAPTER_2, NADIA_RAKA_CONTINUATION)
    const majorFinding = findings.find((f) => f.code === 'CONT_MISSING_CONTINUITY_ANCHOR')

    expect(majorFinding).toBeDefined()
    expect(majorFinding?.severity).toBe('MAJOR')
  })

  it('menerima Bab 2 koheren yang melanjutkan konfrontasi Nadia/Raka di galeri', () => {
    const findings = runContinuityChecks(mockSnapshot, NADIA_RAKA_GOOD_CHAPTER_2, NADIA_RAKA_CONTINUATION)
    const majorFinding = findings.find((f) => f.code === 'CONT_MISSING_CONTINUITY_ANCHOR')

    expect(majorFinding).toBeUndefined()
  })
})
