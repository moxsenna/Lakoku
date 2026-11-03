import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  policyData: vi.fn(),
  rpcData: vi.fn(),
  rpc: vi.fn(),
  existingCode: vi.fn(),
  insertCode: vi.fn(),
  attributionsCount: vi.fn(),
  ledgerRows: vi.fn(),
}))

const mockRpc = mocks.rpc

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lakoku/db')>()
  return {
    ...actual,
    getDb: mocks.getDb,
    rpcOne: vi.fn((_db: unknown, name: string, args: Record<string, unknown>) => {
      mocks.rpc(name, args)
      return {
        execute: vi.fn(async () => {
          const res = await mocks.rpcData(name, args)
          return [{ fn: res }]
        }),
      }
    }),
  }
})

import {
  getRewardPolicy,
  getRewardBalance,
  ensureReferralCode,
  redeemRewardCredits,
  getReferralStats,
} from '../../lib/rewards/server'

describe('lib/rewards/server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const db = {
      selectFrom: vi.fn((table: string) => ({
        selectAll: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: vi.fn(async () => {
                if (table === 'reward_policy') return mocks.policyData()
                return []
              }),
            })),
          })),
          limit: vi.fn(() => ({
            execute: vi.fn(async () => {
              const res = await mocks.rpcData()
              return [{ fn: res }]
            }),
          })),
        })),
        select: vi.fn((_cols: unknown) => ({
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              execute: vi.fn(async () => mocks.ledgerRows()),
            })),
            limit: vi.fn(() => ({
              execute: vi.fn(async () => mocks.existingCode()),
            })),
            execute: vi.fn(async () => [{ n: mocks.attributionsCount() }]),
          })),
        })),
      })),
      insertInto: vi.fn(() => ({
        values: vi.fn((_val: unknown) => ({
          returning: vi.fn(() => ({
            execute: vi.fn(async () => mocks.insertCode()),
          })),
        })),
      })),
    }
    mocks.getDb.mockReturnValue(db)
  })

  it('reads reward policy from DB with fallback', async () => {
    mocks.policyData.mockReturnValue([
      {
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
    ])

    const policy = await getRewardPolicy()
    expect(policy.commissionPercent).toBe(15)
    expect(policy.windowDays).toBe(45)
    expect(policy.attributionCookieDays).toBe(60)
    expect(policy.commissionEnabled).toBe(true)
  })

  it('reads reward balance via RPC', async () => {
    mocks.rpcData.mockResolvedValue(12500)
    const balance = await getRewardBalance('user-123')
    expect(balance).toBe(12500)
  })

  it('ensures referral code returns existing if available', async () => {
    mocks.existingCode.mockReturnValue([{ code: 'EXIST123' }])

    const code = await ensureReferralCode('user-123')
    expect(code).toBe('EXIST123')
  })

  it('ensures referral code generates and saves when absent', async () => {
    mocks.existingCode.mockReturnValue([])
    mocks.insertCode.mockReturnValue([{ code: 'NEWCODE8' }])

    const code = await ensureReferralCode('user-new')
    expect(code).toBeDefined()
    expect(code.length).toBe(8)
  })

  it('executes atomic redemption via single RPC redeem_reward_credits_v1', async () => {
    let callIdx = 0
    mocks.policyData.mockReturnValue([
      {
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
    ])
    mocks.rpcData.mockImplementation(async () => {
      callIdx++
      if (callIdx === 1) return 10000 // balance
      return 'ok' // redeem_reward_credits_v1
    })

    const result = await redeemRewardCredits('user-123', 5000)
    expect(result.creditsGranted).toBe(20) // 5000 / 250
    expect(result.deductedIdr).toBe(5000)
    // SATU panggilan RPC atomik — cek saldo + kedua ledger ada di dalam RPC
    expect(mocks.rpc).toHaveBeenCalledWith('redeem_reward_credits_v1', expect.objectContaining({
      p_user_id: 'user-123',
      p_redeem_id: expect.stringMatching(/^[0-9a-f-]+$/),
      p_amount_idr: 5000,
      p_credits: 20,
    }))
    expect(mocks.rpc).not.toHaveBeenCalledWith('grant_reward_v1', expect.anything())
    expect(mocks.rpc).not.toHaveBeenCalledWith('grant_credits_v1', expect.anything())
  })

  it('surfaces insufficient status as reader-safe error', async () => {
    let callIdx = 0
    mocks.policyData.mockReturnValue([
      {
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
    ])
    mocks.rpcData.mockImplementation(async () => {
      callIdx++
      if (callIdx === 1) return 10000 // balance (pre-check node lolos)
      return 'insufficient' // keputusan otoritatif di dalam RPC (lock)
    })

    await expect(redeemRewardCredits('user-123', 5000)).rejects.toThrow('Saldo imbalan tidak mencukupi')
  })

  it('surfaces duplicate status as processing error', async () => {
    let callIdx = 0
    mocks.policyData.mockReturnValue([
      {
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
    ])
    mocks.rpcData.mockImplementation(async () => {
      callIdx++
      if (callIdx === 1) return 10000 // balance
      return 'duplicate'
    })

    await expect(redeemRewardCredits('user-123', 5000)).rejects.toThrow('Transaksi penukaran sedang diproses')
  })

  it('aggregates referral statistics accurately', async () => {
    mocks.existingCode.mockReturnValue([{ code: 'MYREF123' }])
    mocks.rpcData.mockResolvedValue(7500)
    mocks.attributionsCount.mockReturnValue(12)
    mocks.ledgerRows.mockReturnValue([{ delta_idr: 5000 }, { delta_idr: 10000 }])

    const stats = await getReferralStats('user-123')
    expect(stats.referralCode).toBe('MYREF123')
    expect(stats.totalAttributions).toBe(12)
    expect(stats.totalEarnedIdr).toBe(15000)
    expect(stats.currentBalanceIdr).toBe(7500)
  })
})

