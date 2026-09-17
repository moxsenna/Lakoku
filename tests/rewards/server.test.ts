import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  getRewardPolicy,
  getRewardBalance,
  ensureReferralCode,
  redeemRewardCredits,
  getReferralStats,
} from '../../lib/rewards/server'

vi.mock('@lakoku/db', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@lakoku/db'

describe('lib/rewards/server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads reward policy from DB with fallback', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            commission_percent: 15,
            window_days: 45,
            attribution_cookie_days: 60,
            redeem_rate_idr_per_credit: 250,
            redeem_min_idr: 2000,
            commission_enabled: true,
            redeem_enabled: true,
            payout_enabled: false,
            payout_min_idr: 50000,
          },
          error: null,
        }),
      }),
    })
    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    })

    const policy = await getRewardPolicy()
    expect(policy.commissionPercent).toBe(15)
    expect(policy.windowDays).toBe(45)
    expect(policy.attributionCookieDays).toBe(60)
    expect(policy.commissionEnabled).toBe(true)
  })

  it('reads reward balance via RPC', async () => {
    ;(createAdminClient as any).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 12500, error: null }),
    })
    const balance = await getRewardBalance('user-123')
    expect(balance).toBe(12500)
  })

  it('ensures referral code returns existing if available', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { code: 'EXIST123' },
      error: null,
    })
    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: mockMaybeSingle,
          }),
        }),
      }),
    })

    const code = await ensureReferralCode('user-123')
    expect(code).toBe('EXIST123')
  })

  it('ensures referral code generates and saves when absent', async () => {
    let callCount = 0
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'referral_codes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(() => {
                callCount++
                if (callCount === 1) return Promise.resolve({ data: null, error: null })
                return Promise.resolve({ data: { code: 'NEWCODE8' }, error: null })
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { code: 'NEWCODE8' },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })
    ;(createAdminClient as any).mockReturnValue({ from: mockFrom })

    const code = await ensureReferralCode('user-new')
    expect(code).toBeDefined()
    expect(code.length).toBe(8)
  })

  it('executes atomic credit redemption with dual ledger writes', async () => {
    const mockRpc = vi.fn().mockImplementation((fnName: string, _args: any) => {
      if (fnName === 'reward_balance_v1') return Promise.resolve({ data: 10000, error: null })
      if (fnName === 'grant_reward_v1') return Promise.resolve({ data: true, error: null })
      if (fnName === 'grant_credits_v1') return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                commission_percent: 10,
                window_days: 30,
                attribution_cookie_days: 30,
                redeem_rate_idr_per_credit: 250,
                redeem_min_idr: 1000,
                commission_enabled: false,
                redeem_enabled: true,
                payout_enabled: false,
                payout_min_idr: 50000,
              },
              error: null,
            }),
          }),
        }),
      }),
      rpc: mockRpc,
    })

    const result = await redeemRewardCredits('user-123', 5000)
    expect(result.creditsGranted).toBe(20) // 5000 / 250
    expect(result.deductedIdr).toBe(5000)
    expect(mockRpc).toHaveBeenCalledWith('grant_reward_v1', expect.objectContaining({
      p_user_id: 'user-123',
      p_delta_idr: -5000,
      p_reason: 'redeem_credits',
    }))
    expect(mockRpc).toHaveBeenCalledWith('grant_credits_v1', expect.objectContaining({
      p_user_id: 'user-123',
      p_credits: 20,
      p_reason: 'reward_redeem',
    }))
  })

  it('rolls back reward deduction when credit grant fails', async () => {
    const mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
      if (fnName === 'reward_balance_v1') return Promise.resolve({ data: 10000, error: null })
      if (fnName === 'grant_reward_v1') return Promise.resolve({ data: true, error: null })
      if (fnName === 'grant_credits_v1') return Promise.resolve({ data: false, error: new Error('credit grant error') })
      return Promise.resolve({ data: null, error: null })
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                commission_percent: 10,
                window_days: 30,
                attribution_cookie_days: 30,
                redeem_rate_idr_per_credit: 250,
                redeem_min_idr: 1000,
                commission_enabled: false,
                redeem_enabled: true,
                payout_enabled: false,
                payout_min_idr: 50000,
              },
              error: null,
            }),
          }),
        }),
      }),
      rpc: mockRpc,
    })

    await expect(redeemRewardCredits('user-123', 5000)).rejects.toThrow('credit grant failed')

    // Compensation write check
    expect(mockRpc).toHaveBeenCalledWith('grant_reward_v1', expect.objectContaining({
      p_user_id: 'user-123',
      p_delta_idr: 5000,
      p_reason: 'redeem_rollback',
    }))
  })

  it('aggregates referral statistics accurately', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'referral_codes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { code: 'MYREF123' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'referral_attributions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 12, data: null, error: null }),
          }),
        }
      }
      if (table === 'reward_ledger') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gt: vi.fn().mockResolvedValue({
                data: [{ delta_idr: 5000 }, { delta_idr: 10000 }],
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    ;(createAdminClient as any).mockReturnValue({
      from: mockFrom,
      rpc: vi.fn().mockResolvedValue({ data: 7500, error: null }),
    })

    const stats = await getReferralStats('user-123')
    expect(stats.referralCode).toBe('MYREF123')
    expect(stats.totalAttributions).toBe(12)
    expect(stats.totalEarnedIdr).toBe(15000)
    expect(stats.currentBalanceIdr).toBe(7500)
  })
})

