import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireAdminUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/admin/auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
}))

import {
  updateTintaPolicySchema,
  type UpdateTintaPolicyInput,
} from '../../lib/admin/settings-schemas'
import {
  getAdminTintaPolicy,
  updateTintaPolicy,
  loadAdminSettings,
  loadSettingsData,
} from '../../lib/admin/settings'
import { PATCH } from '../../app/api/admin/settings/tinta-policy/route'

describe('AC10.1: updateTintaPolicySchema', () => {
  const validPayload: UpdateTintaPolicyInput = {
    tintaPerRead: 10,
    authorDailyCap: 300,
    tintaCheckin: 5,
    tintaChoice: 10,
    tintaAdBatch: 10,
    tintaPerLakoin: 100,
    exchangeMinLakoin: 1,
    pendingHours: 24,
    authorRewardsEnabled: true,
    exchangeEnabled: true,
    missionsPayTinta: true,
    reason: 'Penyesuaian knob ekonomi Tinta dan Lakoin',
  }

  it('accepts valid payload with all 11 knobs and valid reason', () => {
    const result = updateTintaPolicySchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects tintaPerLakoin < 10 (e.g. tintaPerLakoin: 5)', () => {
    const result = updateTintaPolicySchema.safeParse({
      ...validPayload,
      tintaPerLakoin: 5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects tintaPerLakoin > 100000', () => {
    const result = updateTintaPolicySchema.safeParse({
      ...validPayload,
      tintaPerLakoin: 100001,
    })
    expect(result.success).toBe(false)
  })

  it('rejects reason shorter than 5 characters', () => {
    const result = updateTintaPolicySchema.safeParse({
      ...validPayload,
      reason: 'ubah',
    })
    expect(result.success).toBe(false)
  })

  it('rejects reason longer than 500 characters', () => {
    const result = updateTintaPolicySchema.safeParse({
      ...validPayload,
      reason: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('rejects unrecognized extra fields (strict)', () => {
    const result = updateTintaPolicySchema.safeParse({
      ...validPayload,
      extraField: 'unauthorized_field',
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative values and out of range knobs', () => {
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, tintaPerRead: -1 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, tintaPerRead: 1001 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, authorDailyCap: -1 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, authorDailyCap: 100001 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, exchangeMinLakoin: 0 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, exchangeMinLakoin: 10001 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, pendingHours: -1 }).success,
    ).toBe(false)
    expect(
      updateTintaPolicySchema.safeParse({ ...validPayload, pendingHours: 169 }).success,
    ).toBe(false)
  })

  it('rejects non-integer values for integer fields', () => {
    const result = updateTintaPolicySchema.safeParse({
      ...validPayload,
      tintaPerRead: 10.5,
    })
    expect(result.success).toBe(false)
  })
})

describe('AC10.2: lib/admin/settings tinta_policy operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAdminTintaPolicy reads row from database and maps to camelCase', async () => {
    const mockDbRow = {
      tinta_per_read: 15,
      author_daily_cap: 500,
      tinta_checkin: 8,
      tinta_choice: 12,
      tinta_ad_batch: 15,
      tinta_per_lakoin: 150,
      exchange_min_lakoin: 2,
      pending_hours: 48,
      author_rewards_enabled: true,
      exchange_enabled: true,
      missions_pay_tinta: true,
      updated_at: '2026-09-19T10:00:00.000Z',
    }

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockDbRow }),
          }),
        }),
      }),
    })

    const policy = await getAdminTintaPolicy()
    expect(policy).not.toBeNull()
    expect(policy?.tintaPerRead).toBe(15)
    expect(policy?.authorDailyCap).toBe(500)
    expect(policy?.tintaCheckin).toBe(8)
    expect(policy?.tintaChoice).toBe(12)
    expect(policy?.tintaAdBatch).toBe(15)
    expect(policy?.tintaPerLakoin).toBe(150)
    expect(policy?.exchangeMinLakoin).toBe(2)
    expect(policy?.pendingHours).toBe(48)
    expect(policy?.authorRewardsEnabled).toBe(true)
    expect(policy?.exchangeEnabled).toBe(true)
    expect(policy?.missionsPayTinta).toBe(true)
    expect(policy?.updatedAt).toBe('2026-09-19T10:00:00.000Z')
  })

  it('getAdminTintaPolicy returns null if row not found', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
    })

    const policy = await getAdminTintaPolicy()
    expect(policy).toBeNull()
  })

  it('updateTintaPolicy snapshots old row, updates table, and records audit log', async () => {
    mocks.requireAdminUser.mockResolvedValue({
      id: 'admin-owner-id',
      email: 'owner@lakoku.id',
      role: 'owner',
    })

    const oldDbRow = {
      tinta_per_read: 10,
      author_daily_cap: 300,
      tinta_checkin: 5,
      tinta_choice: 10,
      tinta_ad_batch: 10,
      tinta_per_lakoin: 100,
      exchange_min_lakoin: 1,
      pending_hours: 24,
      author_rewards_enabled: false,
      exchange_enabled: false,
      missions_pay_tinta: false,
    }

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const mockInsertAudit = vi.fn().mockResolvedValue({ error: null })

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tinta_policy') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: oldDbRow }),
              }),
            }),
            update: mockUpdate,
          }
        }
        if (table === 'admin_settings_audit_logs') {
          return {
            insert: mockInsertAudit,
          }
        }
        return {}
      }),
    })

    const input: UpdateTintaPolicyInput = {
      tintaPerRead: 20,
      authorDailyCap: 600,
      tintaCheckin: 10,
      tintaChoice: 20,
      tintaAdBatch: 20,
      tintaPerLakoin: 200,
      exchangeMinLakoin: 5,
      pendingHours: 48,
      authorRewardsEnabled: true,
      exchangeEnabled: true,
      missionsPayTinta: true,
      reason: 'Aktivasi ekonomi Tinta fase 1',
    }

    const result = await updateTintaPolicy(input)

    expect(result.tintaPerRead).toBe(20)
    expect(result.authorDailyCap).toBe(600)
    expect(result.authorRewardsEnabled).toBe(true)
    expect(result.updatedAt).toBeTruthy()

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = mockUpdate.mock.calls[0][0]
    expect(updatePayload.tinta_per_read).toBe(20)
    expect(updatePayload.author_rewards_enabled).toBe(true)

    expect(mockInsertAudit).toHaveBeenCalledTimes(1)
    const auditPayload = mockInsertAudit.mock.calls[0][0]
    expect(auditPayload.admin_user_id).toBe('admin-owner-id')
    expect(auditPayload.admin_email).toBe('owner@lakoku.id')
    expect(auditPayload.setting_area).toBe('tinta_policy')
    expect(auditPayload.setting_key).toBe('default')
    expect(auditPayload.old_value).toEqual(oldDbRow)
    expect(auditPayload.new_value.tinta_per_read).toBe(20)
    expect(auditPayload.reason).toBe('Aktivasi ekonomi Tinta fase 1')
  })

  it('updateTintaPolicy rejects non-owner users', async () => {
    mocks.requireAdminUser.mockResolvedValue({
      id: 'admin-regular-id',
      email: 'admin@lakoku.id',
      role: 'admin',
    })

    const input: UpdateTintaPolicyInput = {
      tintaPerRead: 10,
      authorDailyCap: 300,
      tintaCheckin: 5,
      tintaChoice: 10,
      tintaAdBatch: 10,
      tintaPerLakoin: 100,
      exchangeMinLakoin: 1,
      pendingHours: 24,
      authorRewardsEnabled: false,
      exchangeEnabled: false,
      missionsPayTinta: false,
      reason: 'Percobaan ubah bukan owner',
    }

    await expect(updateTintaPolicy(input)).rejects.toThrow('Forbidden: owner role required')
  })

  it('loadAdminSettings / loadSettingsData includes tintaPolicy', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tinta_policy') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    tinta_per_read: 10,
                    author_daily_cap: 300,
                    tinta_checkin: 5,
                    tinta_choice: 10,
                    tinta_ad_batch: 10,
                    tinta_per_lakoin: 100,
                    exchange_min_lakoin: 1,
                    pending_hours: 24,
                    author_rewards_enabled: false,
                    exchange_enabled: false,
                    missions_pay_tinta: false,
                    updated_at: '2026-09-19T00:00:00.000Z',
                  },
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            }),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }
      }),
    })

    const settings = await loadAdminSettings()
    expect(settings.tintaPolicy).toBeDefined()
    expect(settings.tintaPolicy?.tintaPerRead).toBe(10)

    const aliasSettings = await loadSettingsData()
    expect(aliasSettings.tintaPolicy).toBeDefined()
  })
})

describe('AC10.3: PATCH /api/admin/settings/tinta-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with updated data when input is valid and user is owner', async () => {
    mocks.requireAdminUser.mockResolvedValue({
      id: 'owner-id',
      email: 'owner@lakoku.id',
      role: 'owner',
    })

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tinta_policy') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    tinta_per_read: 10,
                    author_daily_cap: 300,
                    tinta_checkin: 5,
                    tinta_choice: 10,
                    tinta_ad_batch: 10,
                    tinta_per_lakoin: 100,
                    exchange_min_lakoin: 1,
                    pending_hours: 24,
                    author_rewards_enabled: false,
                    exchange_enabled: false,
                    missions_pay_tinta: false,
                  },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'admin_settings_audit_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {}
      }),
    })

    const valid = {
      tintaPerRead: 15,
      authorDailyCap: 400,
      tintaCheckin: 5,
      tintaChoice: 10,
      tintaAdBatch: 10,
      tintaPerLakoin: 100,
      exchangeMinLakoin: 1,
      pendingHours: 24,
      authorRewardsEnabled: true,
      exchangeEnabled: true,
      missionsPayTinta: false,
      reason: 'Penyesuaian reward penulis',
    }

    const request = new Request('https://lakoku.test/api/admin/settings/tinta-policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.data.tintaPerRead).toBe(15)
  })

  it('returns 400 on invalid input payload', async () => {
    const invalid = {
      tintaPerLakoin: 5, // invalid (< 10)
      reason: 'pendek', // valid min 5, but other fields missing
    }

    const request = new Request('https://lakoku.test/api/admin/settings/tinta-policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe('Validation failed')
    expect(json.details).toBeDefined()
  })

  it('returns 403 when user is not an owner', async () => {
    mocks.requireAdminUser.mockResolvedValue({
      id: 'admin-id',
      email: 'admin@lakoku.id',
      role: 'admin',
    })

    const valid = {
      tintaPerRead: 15,
      authorDailyCap: 400,
      tintaCheckin: 5,
      tintaChoice: 10,
      tintaAdBatch: 10,
      tintaPerLakoin: 100,
      exchangeMinLakoin: 1,
      pendingHours: 24,
      authorRewardsEnabled: true,
      exchangeEnabled: true,
      missionsPayTinta: false,
      reason: 'Penyesuaian reward penulis',
    }

    const request = new Request('https://lakoku.test/api/admin/settings/tinta-policy', {
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
