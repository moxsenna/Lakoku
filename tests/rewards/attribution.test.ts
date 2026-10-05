import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  selectReferrer: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lakoku/db')>()
  return {
    ...actual,
    getDb: mocks.getDb,
  }
})

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn().mockResolvedValue({
    windowDays: 30,
    attributionCookieDays: 30,
  }),
}))

import { recordReferralAttribution } from '../../lib/rewards/attribution.server'

describe('lib/rewards/attribution.server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const db = {
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: vi.fn(async () => mocks.selectReferrer()),
            })),
          })),
        })),
      })),
      insertInto: vi.fn(() => ({
        values: vi.fn((val: unknown) => ({
          execute: vi.fn(async () => mocks.insert(val)),
        })),
      })),
    }
    mocks.getDb.mockReturnValue(db)
  })

  it('records attribution mapping code to referrer', async () => {
    mocks.selectReferrer.mockReturnValue([{ user_id: 'user-referrer-1' }])
    mocks.insert.mockResolvedValue([])

    const success = await recordReferralAttribution('user-new-2', 'ABCD2345', 'referral_code')
    expect(success).toBe(true)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
    const payload = mocks.insert.mock.calls[0][0]
    expect(payload.referrer_user_id).toBe('user-referrer-1')
    expect(payload.referred_user_id).toBe('user-new-2')
    expect(payload.source).toBe('referral_code')
  })

  it('rejects self-referral cleanly without error', async () => {
    mocks.selectReferrer.mockReturnValue([{ user_id: 'user-same' }])

    const success = await recordReferralAttribution('user-same', 'ABCD2345', 'referral_code')
    expect(success).toBe(false)
  })

  it('handles unique constraint violation (already attributed) cleanly', async () => {
    mocks.selectReferrer.mockReturnValue([{ user_id: 'user-referrer-1' }])
    const dupErr = new Error('duplicate key') as Error & { code: string }
    dupErr.code = '23505'
    mocks.insert.mockRejectedValue(dupErr)

    const success = await recordReferralAttribution('user-already-attributed', 'ABCD2345', 'referral_code')
    expect(success).toBe(false)
  })
})
