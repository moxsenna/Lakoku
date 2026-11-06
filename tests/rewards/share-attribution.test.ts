import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Mock ensureReferralCode (pemilik belum tentu punya kode) dan pencatat atribusi.
// vi.hoisted agar tersedia saat factory vi.mock dieksekusi di atas import.
const { ensureReferralCodeMock, recordReferralAttributionMock } = vi.hoisted(() => ({
  ensureReferralCodeMock: vi.fn(),
  recordReferralAttributionMock: vi.fn(),
}))

vi.mock('../../lib/rewards/server', () => ({
  ensureReferralCode: (...args: unknown[]) => ensureReferralCodeMock(...(args as [string])),
}))

vi.mock('../../lib/rewards/attribution.server', () => ({
  recordReferralAttribution: (...args: unknown[]) => recordReferralAttributionMock(...(args as unknown[])),
}))

interface LinkRow {
  [key: string]: unknown
  id: string
  share_slug: string
  owner_user_id: string | null
  revoked_at: Date | null
}

const mockState = {
  links: [] as LinkRow[],
}

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getDb: vi.fn(() => ({
      selectFrom: (table: string) => {
        const wheres: Array<{ col: string; op: string; val: unknown }> = []
        const builder = {
          select: () => builder,
          where: (col: string, op: string, val: unknown) => {
            wheres.push({ col, op, val })
            return builder
          },
          limit: () => builder,
          execute: async () => {
            if (table !== 'shared_story_links') return []
            return mockState.links.filter((row) =>
              wheres.every(({ col, op, val }) => {
                const rowVal = row[col]
                if (op === '=') return rowVal === val
                return false
              }),
            )
          },
        }
        return builder
      },
    })),
  }
})

import { recordShareLinkAttribution } from '../../lib/rewards/share-attribution.server'

describe('recordShareLinkAttribution (audit M-A7)', () => {
  beforeEach(() => {
    mockState.links = []
    ensureReferralCodeMock.mockReset()
    recordReferralAttributionMock.mockReset()
  })

  it('atribusi tetap jalan meski pemilik belum punya kode referral (dibuat on-demand)', async () => {
    mockState.links = [{ id: 'link-1', share_slug: 'slug-1', owner_user_id: 'owner-1', revoked_at: null }]
    ensureReferralCodeMock.mockResolvedValue('ABC123')
    recordReferralAttributionMock.mockResolvedValue(true)

    const ok = await recordShareLinkAttribution({ newUserId: 'new-1', shareSlug: 'slug-1' })

    expect(ok).toBe(true)
    expect(ensureReferralCodeMock).toHaveBeenCalledWith('owner-1')
    expect(recordReferralAttributionMock).toHaveBeenCalledWith('new-1', 'ABC123', 'share_link', 'link-1')
  })

  it('ensureReferralCode gagal → return false tanpa mengganggu alur baca', async () => {
    mockState.links = [{ id: 'link-2', share_slug: 'slug-2', owner_user_id: 'owner-2', revoked_at: null }]
    ensureReferralCodeMock.mockRejectedValue(new Error('db down'))

    const ok = await recordShareLinkAttribution({ newUserId: 'new-2', shareSlug: 'slug-2' })
    expect(ok).toBe(false)
    expect(recordReferralAttributionMock).not.toHaveBeenCalled()
  })

  it('link dicabut/tidak ada → false tanpa memanggil ensureReferralCode', async () => {
    mockState.links = [{ id: 'link-3', share_slug: 'slug-3', owner_user_id: 'owner-3', revoked_at: new Date() }]

    const ok = await recordShareLinkAttribution({ newUserId: 'new-3', shareSlug: 'slug-3' })
    expect(ok).toBe(false)
    expect(ensureReferralCodeMock).not.toHaveBeenCalled()
  })
})
