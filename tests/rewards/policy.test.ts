import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REWARD_POLICY,
  calculateCommission,
  isWithinWindow,
  calculateRedeemCredits,
  isValidReferralCode,
  generateReferralCode,
  type RewardPolicy,
} from '../../lib/rewards/policy'

describe('lib/rewards/policy', () => {
  it('calculates 10% commission floor by default', () => {
    // commissionEnabled default false in DEFAULT_REWARD_POLICY per spec
    const enabledPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, commissionEnabled: true }
    expect(calculateCommission(50000, enabledPolicy)).toBe(5000)
    expect(calculateCommission(15000, enabledPolicy)).toBe(1500)
    expect(calculateCommission(0, enabledPolicy)).toBe(0)
    expect(calculateCommission(99, enabledPolicy)).toBe(9) // floor(9.9) = 9
  })

  it('returns 0 commission if commission_enabled is false', () => {
    const disabledPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, commissionEnabled: false }
    expect(calculateCommission(50000, disabledPolicy)).toBe(0)
    expect(calculateCommission(50000)).toBe(0) // DEFAULT_REWARD_POLICY has commissionEnabled: false
  })

  it('calculates commission with custom percent', () => {
    const customPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, commissionPercent: 15, commissionEnabled: true }
    expect(calculateCommission(100000, customPolicy)).toBe(15000)
  })

  it('checks if within referral window', () => {
    const now = new Date('2026-09-17T12:00:00Z')
    const within = new Date('2026-09-01T12:00:00Z') // 16 days ago
    const exactlyBoundary = new Date('2026-08-18T12:00:00Z') // 30 days ago
    const outside = new Date('2026-08-17T12:00:00Z') // 31 days ago

    expect(isWithinWindow(within, 30, now)).toBe(true)
    expect(isWithinWindow(exactlyBoundary, 30, now)).toBe(true)
    expect(isWithinWindow(outside, 30, now)).toBe(false)
  })

  it('calculates credit redemption at Rp250 per credit default', () => {
    const res = calculateRedeemCredits(5000)
    expect(res.creditsToGrant).toBe(20) // 5000 / 250
    expect(res.costIdr).toBe(5000)
    expect(res.remainderIdr).toBe(0)

    const withRemainder = calculateRedeemCredits(5100)
    expect(withRemainder.creditsToGrant).toBe(20)
    expect(withRemainder.costIdr).toBe(5000)
    expect(withRemainder.remainderIdr).toBe(100)
  })

  it('enforces redeemMinIdr and redeemEnabled', () => {
    expect(() => calculateRedeemCredits(500)).toThrow(/minimal/)
    const disabledPolicy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, redeemEnabled: false }
    expect(() => calculateRedeemCredits(5000, disabledPolicy)).toThrow(/dinonaktifkan/)
  })

  it('validates and generates referral codes avoiding ambiguous characters', () => {
    const code = generateReferralCode()
    expect(code).toHaveLength(8)
    expect(isValidReferralCode(code)).toBe(true)
    expect(/^[A-HJ-NP-Z2-9]{8}$/.test(code)).toBe(true) // No 0, O, 1, I, l
    expect(isValidReferralCode('ABCD2345')).toBe(true)
    expect(isValidReferralCode('abc')).toBe(false)
    expect(isValidReferralCode('ABCD234O')).toBe(false) // Contains 'O'
    expect(isValidReferralCode('ABCD2340')).toBe(false) // Contains '0'
    expect(isValidReferralCode('ABCD234I')).toBe(false) // Contains 'I'
    expect(isValidReferralCode('ABCD2341')).toBe(false) // Contains '1'
  })
})
