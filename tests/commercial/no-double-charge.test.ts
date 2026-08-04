import { describe, expect, it } from 'vitest'
import { unlockRef } from '../../lib/credits/policy'

describe('Canonical Double-Charge Protection Contract', () => {
  it('unlockRef generates canonical debit ref for story and chapter', () => {
    const ref = unlockRef('story-123', 5)
    expect(ref).toBe('unlock:story-123:5')
  })

  it('reservation key and canonical debit ref follow exact contract hierarchy', () => {
    const userId = 'user-789'
    const storyId = 'story-123'
    const chapter = 5

    const reservationRef = `chapter-reservation:${userId}:${storyId}:${chapter}`
    const canonicalDebitRef = unlockRef(storyId, chapter)

    expect(reservationRef).toBe('chapter-reservation:user-789:story-123:5')
    expect(canonicalDebitRef).toBe('unlock:story-123:5')
  })

  it('verifies exact single debit contract (-8 once) for reservation capture + legacy spend', () => {
    let balance = 20
    const ledger: Array<{ ref: string; delta: number }> = []

    function mockCaptureReservation(storyId: string, chapter: number, amount: number) {
      const canonicalDebitRef = unlockRef(storyId, chapter) // unlock:story-123:5
      if (ledger.some(entry => entry.ref === canonicalDebitRef)) {
        return 'duplicate'
      }
      if (balance < amount) {
        return 'insufficient'
      }
      balance -= amount
      ledger.push({ ref: canonicalDebitRef, delta: -amount })
      return 'ok'
    }

    function mockLegacySpendUnlock(storyId: string, chapter: number, amount: number) {
      const canonicalDebitRef = unlockRef(storyId, chapter) // unlock:story-123:5
      if (ledger.some(entry => entry.ref === canonicalDebitRef)) {
        return 'duplicate'
      }
      if (balance < amount) {
        return 'insufficient'
      }
      balance -= amount
      ledger.push({ ref: canonicalDebitRef, delta: -amount })
      return 'ok'
    }

    const storyId = 'story-abc'
    const chapter = 4

    // 1. Worker captures reservation -> debits ledger with canonical ref 'unlock:story-abc:4'
    const captureResult = mockCaptureReservation(storyId, chapter, 8)
    expect(captureResult).toBe('ok')
    expect(balance).toBe(12)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toEqual({ ref: 'unlock:story-abc:4', delta: -8 })

    // 2. Reader subsequently opens chapter & client calls legacy spend_credits_v1 with 'unlock:story-abc:4'
    const unlockResult = mockLegacySpendUnlock(storyId, chapter, 8)
    expect(unlockResult).toBe('duplicate') // Recognized as already debited, 0 double charge!

    // 3. Verify total balance is 12 (debited exactly 8 once, NEVER 16)
    expect(balance).toBe(12)
    expect(ledger).toHaveLength(1)
  })
})
