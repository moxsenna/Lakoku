import { describe, expect, it, vi, beforeEach } from 'vitest'
import { recordReferralAttribution } from '../../lib/rewards/attribution.server'

vi.mock('@lakoku/db', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn().mockResolvedValue({
    windowDays: 30,
    attributionCookieDays: 30,
  }),
}))

import { createAdminClient } from '@lakoku/db'

describe('lib/rewards/attribution.server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records attribution mapping code to referrer', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    const mockSelectReferrer = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: 'user-referrer-1' },
          error: null,
        }),
      }),
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_codes') {
          return { select: mockSelectReferrer }
        }
        if (table === 'referral_attributions') {
          return { insert: mockInsert }
        }
        return {}
      }),
    })

    const success = await recordReferralAttribution('user-new-2', 'ABCD2345', 'referral_code')
    expect(success).toBe(true)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const payload = mockInsert.mock.calls[0][0]
    expect(payload.referrer_user_id).toBe('user-referrer-1')
    expect(payload.referred_user_id).toBe('user-new-2')
    expect(payload.source).toBe('referral_code')
  })

  it('rejects self-referral cleanly without error', async () => {
    const mockSelectReferrer = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: 'user-same' },
          error: null,
        }),
      }),
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: mockSelectReferrer }),
    })

    const success = await recordReferralAttribution('user-same', 'ABCD2345', 'referral_code')
    expect(success).toBe(false)
  })

  it('handles unique constraint violation (already attributed) cleanly', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    const mockSelectReferrer = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: 'user-referrer-1' },
          error: null,
        }),
      }),
    })

    ;(createAdminClient as any).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'referral_codes') {
          return { select: mockSelectReferrer }
        }
        if (table === 'referral_attributions') {
          return { insert: mockInsert }
        }
        return {}
      }),
    })

    const success = await recordReferralAttribution('user-already-attributed', 'ABCD2345', 'referral_code')
    expect(success).toBe(false)
  })
})
