import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applyReferralCommission } from '../../lib/rewards/commission.server'

vi.mock('@lakoku/db', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn(),
}))

import { createAdminClient } from '@lakoku/db'
import { getRewardPolicy } from '../../lib/rewards/server'

describe('applyReferralCommission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies 10% commission if attribution exists, within window, and commission_enabled', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: true,
      windowDays: 30,
    })

    const mockGrantReward = vi.fn().mockResolvedValue({ data: true, error: null })
    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_attributions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    referrer_user_id: 'user-referrer',
                    window_ends_at: new Date(Date.now() + 86400000).toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'credit_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { price_idr: 50000 },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
      rpc: mockGrantReward,
    }
    ;(createAdminClient as any).mockReturnValue(mockDb)

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(true)
    expect(result.commissionIdr).toBe(5000)
    expect(mockGrantReward).toHaveBeenCalledWith('grant_reward_v1', {
      p_user_id: 'user-referrer',
      p_ref: 'commission:order-123',
      p_delta_idr: 5000,
      p_reason: 'referral_commission',
    })
  })

  it('skips commission if commission_enabled is false', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: false,
    })

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('commission_disabled')
  })

  it('skips commission if window has expired', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: true,
    })

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_attributions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    referrer_user_id: 'user-referrer',
                    window_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }
    ;(createAdminClient as any).mockReturnValue(mockDb)

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('window_expired')
  })
})
