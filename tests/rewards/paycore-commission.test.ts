import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  grantReward: vi.fn(),
  attribution: vi.fn(),
  order: vi.fn(),
}))

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lakoku/db')>()
  return {
    ...actual,
    getDb: mocks.getDb,
  }
})

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn(),
}))

import { applyReferralCommission } from '../../lib/rewards/commission.server'
import { getRewardPolicy } from '../../lib/rewards/server'

describe('applyReferralCommission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const db = {
      selectFrom: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: vi.fn(async () => {
                if (table === 'referral_attributions') return mocks.attribution()
                if (table === 'credit_orders') return mocks.order()
                return []
              }),
            })),
          })),
        })),
        selectAll: vi.fn(() => ({
          limit: vi.fn(() => ({
            execute: vi.fn(async () => {
              const res = await mocks.grantReward()
              return [{ fn: res }]
            }),
          })),
        })),
      })),
    }
    mocks.getDb.mockReturnValue(db)
  })

  it('applies 10% commission if attribution exists, within window, and commission_enabled', async () => {
    ;(getRewardPolicy as any).mockResolvedValue({
      commissionPercent: 10,
      commissionEnabled: true,
      windowDays: 30,
    })

    mocks.attribution.mockReturnValue([
      {
        referrer_user_id: 'user-referrer',
        window_ends_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ])
    mocks.order.mockReturnValue([{ price_idr: 50000 }])
    mocks.grantReward.mockResolvedValue(true)

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(true)
    expect(result.commissionIdr).toBe(5000)
    expect(mocks.grantReward).toHaveBeenCalledTimes(1)
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

    mocks.attribution.mockReturnValue([
      {
        referrer_user_id: 'user-referrer',
        window_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired
      },
    ])

    const result = await applyReferralCommission('order-123', 'buyer-456')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('window_expired')
  })
})
