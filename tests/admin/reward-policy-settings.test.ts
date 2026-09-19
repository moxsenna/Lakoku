import { describe, expect, it, vi, beforeEach } from 'vitest'
import { updateRewardPolicySchema } from '../../lib/admin/settings-schemas'
import { PATCH } from '../../app/api/admin/settings/reward-policy/route'

vi.mock('../../lib/admin/settings', () => ({
  updateRewardPolicy: vi.fn(),
}))

import { updateRewardPolicy } from '../../lib/admin/settings'

describe('updateRewardPolicySchema', () => {
  const valid = {
    commissionPercent: 10,
    windowDays: 30,
    attributionCookieDays: 30,
    redeemRateIdrPerCredit: 250,
    redeemMinIdr: 1000,
    commissionEnabled: false,
    redeemEnabled: true,
    payoutEnabled: false,
    payoutMinIdr: 50000,
    reason: 'Pengaturan awal dompet imbalan',
  }

  it('accepts valid reward policy update payload', () => {
    const res = updateRewardPolicySchema.safeParse(valid)
    expect(res.success).toBe(true)
  })

  it('rejects commissionPercent > 50', () => {
    const res = updateRewardPolicySchema.safeParse({ ...valid, commissionPercent: 55 })
    expect(res.success).toBe(false)
  })

  it('rejects windowDays < 1', () => {
    const res = updateRewardPolicySchema.safeParse({ ...valid, windowDays: 0 })
    expect(res.success).toBe(false)
  })

  it('rejects reason shorter than 5 characters', () => {
    const res = updateRewardPolicySchema.safeParse({ ...valid, reason: 'ubah' })
    expect(res.success).toBe(false)
  })
})

describe('PATCH /api/admin/settings/reward-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates reward policy and returns 200 on success', async () => {
    const valid = {
      commissionPercent: 15,
      windowDays: 45,
      attributionCookieDays: 30,
      redeemRateIdrPerCredit: 250,
      redeemMinIdr: 1000,
      commissionEnabled: true,
      redeemEnabled: true,
      payoutEnabled: false,
      payoutMinIdr: 50000,
      reason: 'Penyesuaian promosi imbalan',
    }

    ;(updateRewardPolicy as any).mockResolvedValue({
      ...valid,
      updatedAt: '2026-09-17T00:00:00Z',
    })

    const request = new Request('https://lakoku.test/api/admin/settings/reward-policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.data.commissionPercent).toBe(15)
  })

  it('returns 400 on invalid input', async () => {
    const invalid = {
      commissionPercent: 99,
      reason: 'no',
    }

    const request = new Request('https://lakoku.test/api/admin/settings/reward-policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns 403 when user is not an owner', async () => {
    const valid = {
      commissionPercent: 15,
      windowDays: 45,
      attributionCookieDays: 30,
      redeemRateIdrPerCredit: 250,
      redeemMinIdr: 1000,
      commissionEnabled: true,
      redeemEnabled: true,
      payoutEnabled: false,
      payoutMinIdr: 50000,
      reason: 'Penyesuaian promosi imbalan',
    }

    ;(updateRewardPolicy as any).mockRejectedValue(new Error('Forbidden: owner role required'))

    const request = new Request('https://lakoku.test/api/admin/settings/reward-policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toBe('Owner role required')
  })
})

