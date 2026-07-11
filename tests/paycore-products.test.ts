import { describe, expect, it } from 'vitest'
import { calculateTopupCredits, type CreditProductMinimal } from '../lib/paycore/bonus'

function makeProduct(overrides: Partial<CreditProductMinimal> = {}): CreditProductMinimal {
  return {
    credits: 70,
    normalBonusCredits: 8,
    firstTopupBonusCredits: 20,
    bonusActive: true,
    ...overrides,
  }
}

describe('calculateTopupCredits', () => {
  it('first topup: base 70 + first bonus 20 = total 90, bonusKind first_topup', () => {
    const p = makeProduct()
    const calc = calculateTopupCredits(p, true)
    expect(calc.baseCredits).toBe(70)
    expect(calc.bonusCredits).toBe(20)
    expect(calc.totalCredits).toBe(90)
    expect(calc.bonusKind).toBe('first_topup')
  })

  it('normal topup: base 70 + normal bonus 8 = total 78, bonusKind normal', () => {
    const p = makeProduct()
    const calc = calculateTopupCredits(p, false)
    expect(calc.baseCredits).toBe(70)
    expect(calc.bonusCredits).toBe(8)
    expect(calc.totalCredits).toBe(78)
    expect(calc.bonusKind).toBe('normal')
  })

  it('bonus inactive: total = base, bonusKind none', () => {
    const p = makeProduct({ bonusActive: false })
    const calc = calculateTopupCredits(p, true)
    expect(calc.baseCredits).toBe(70)
    expect(calc.bonusCredits).toBe(0)
    expect(calc.totalCredits).toBe(70)
    expect(calc.bonusKind).toBe('none')
  })

  it('zero bonus: bonusKind = none, even on first topup', () => {
    const p = makeProduct({
      normalBonusCredits: 0,
      firstTopupBonusCredits: 0,
    })
    const calc = calculateTopupCredits(p, true)
    expect(calc.bonusCredits).toBe(0)
    expect(calc.totalCredits).toBe(70)
    expect(calc.bonusKind).toBe('none')
  })

  it('first topup bonus > normal bonus for same product', () => {
    const p = makeProduct({ normalBonusCredits: 5, firstTopupBonusCredits: 50 })
    const firstCalc = calculateTopupCredits(p, true)
    const normalCalc = calculateTopupCredits(p, false)
    expect(firstCalc.totalCredits).toBeGreaterThan(normalCalc.totalCredits)
    expect(firstCalc.bonusCredits).toBe(50)
    expect(normalCalc.bonusCredits).toBe(5)
  })
})
