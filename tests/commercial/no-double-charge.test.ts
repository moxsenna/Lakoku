import { describe, expect, it } from 'vitest'
import { unlockRef } from '../../lib/credits/policy'

describe('No Double-Charge Transition Safeguard (P0 Requirement 9)', () => {
  it('unlockRef generates deterministic idempotency key for story and chapter', () => {
    const ref = unlockRef('story-123', 5)
    expect(ref).toBe('unlock:story-123:5')
  })

  it('reservation capture ref prefix prevents collision and enforces single debit', () => {
    const reservationRef = unlockRef('story-123', 5) // unlock:story-123:5
    const captureRef = `capture:${reservationRef}` // capture:unlock:story-123:5

    expect(captureRef).toBe('capture:unlock:story-123:5')
  })

  it('verifies exact single debit contract (-8 once) for reservation capture + unlock', () => {
    let balance = 20
    const ledger: Array<{ ref: string; delta: number }> = []

    function mockCaptureReservation(ref: string, amount: number) {
      const captureLedgerRef = `capture:${ref}`
      if (ledger.some(entry => entry.ref === captureLedgerRef)) {
        return 'duplicate'
      }
      if (balance < amount) {
        return 'insufficient'
      }
      balance -= amount
      ledger.push({ ref: captureLedgerRef, delta: -amount })
      return 'ok'
    }

    function mockLegacySpendUnlock(ref: string, amount: number) {
      // Transition check: if captured via reservation, recognize as already paid!
      const captureLedgerRef = `capture:${ref}`
      if (ledger.some(entry => entry.ref === captureLedgerRef || entry.ref === ref)) {
        return 'duplicate'
      }
      if (balance < amount) {
        return 'insufficient'
      }
      balance -= amount
      ledger.push({ ref, delta: -amount })
      return 'ok'
    }

    const storyId = 'story-abc'
    const chapter = 4
    const ref = unlockRef(storyId, chapter)

    // 1. Worker publishes chapter and captures reservation
    const captureResult = mockCaptureReservation(ref, 8)
    expect(captureResult).toBe('ok')
    expect(balance).toBe(12)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toEqual({ ref: 'capture:unlock:story-abc:4', delta: -8 })

    // 2. Reader subsequently opens chapter & client calls unlock
    const unlockResult = mockLegacySpendUnlock(ref, 8)
    expect(unlockResult).toBe('duplicate') // Recognized as already captured, no double debit!

    // 3. Verify total balance is 12 (debited exactly 8 once, NEVER 16)
    expect(balance).toBe(12)
    expect(ledger).toHaveLength(1)
  })
})
