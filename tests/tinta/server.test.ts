import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import { DEFAULT_TINTA_POLICY } from '../../lib/tinta/policy'
import * as serverSeam from '../../lib/tinta/server'

describe('lib/tinta/server (AC3.1 - AC3.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC3.1 Architecture & Boundaries', () => {
    it("has import 'server-only' on the very first line", () => {
      const filePath = join(process.cwd(), 'lib/tinta/server.ts')
      const source = readFileSync(filePath, 'utf-8')
      const firstLine = source.split(/\r?\n/)[0].trim()
      expect(firstLine).toBe("import 'server-only'")
    })

    it('only imports from @lakoku/db and ./policy and node builtins', () => {
      const filePath = join(process.cwd(), 'lib/tinta/server.ts')
      const source = readFileSync(filePath, 'utf-8')
      const importMatches = [...source.matchAll(/import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g)]
      const importedModules = importMatches.map((m) => m[1])

      for (const mod of importedModules) {
        const isAllowed =
          mod === 'server-only' ||
          mod === '@lakoku/db' ||
          mod === './policy' ||
          mod.startsWith('node:')
        expect(isAllowed).toBe(true)
      }
    })
  })

  describe('AC3.2 getTintaPolicy', () => {
    it('reads policy from DB and maps to camelCase TintaPolicy', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              tinta_per_read: 15,
              author_daily_cap: 500,
              tinta_checkin: 8,
              tinta_choice: 12,
              tinta_ad_batch: 20,
              tinta_per_lakoin: 120,
              exchange_min_lakoin: 2,
              pending_hours: 48,
              author_rewards_enabled: true,
              exchange_enabled: true,
              missions_pay_tinta: true,
            },
            error: null,
          }),
        }),
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      const policy = await serverSeam.getTintaPolicy()
      expect(policy).toEqual({
        tintaPerRead: 15,
        authorDailyCap: 500,
        tintaCheckin: 8,
        tintaChoice: 12,
        tintaAdBatch: 20,
        tintaPerLakoin: 120,
        exchangeMinLakoin: 2,
        pendingHours: 48,
        authorRewardsEnabled: true,
        exchangeEnabled: true,
        missionsPayTinta: true,
      })
    })

    it('falls back to DEFAULT_TINTA_POLICY when DB returns error', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'DB connection error' },
          }),
        }),
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      const policy = await serverSeam.getTintaPolicy()
      expect(policy).toEqual(DEFAULT_TINTA_POLICY)
    })

    it('falls back to DEFAULT_TINTA_POLICY when DB returns empty data', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      const policy = await serverSeam.getTintaPolicy()
      expect(policy).toEqual(DEFAULT_TINTA_POLICY)
    })

    it('falls back to DEFAULT_TINTA_POLICY when query throws exception', async () => {
      mocks.createAdminClient.mockImplementation(() => {
        throw new Error('Database client creation failed')
      })

      const policy = await serverSeam.getTintaPolicy()
      expect(policy).toEqual(DEFAULT_TINTA_POLICY)
    })
  })

  describe('AC3.3 getTintaBalance', () => {
    it('returns total, available, and pending numbers via RPC tinta_balance_v1', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          total: 250,
          available: 200,
          pending: 50,
        },
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({ rpc: mockRpc })

      const balance = await serverSeam.getTintaBalance('user-456')
      expect(mockRpc).toHaveBeenCalledWith('tinta_balance_v1', { p_user_id: 'user-456' })
      expect(balance).toEqual({
        total: 250,
        available: 200,
        pending: 50,
      })
    })

    it('handles numeric string conversion correctly', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          total: '300',
          available: '250',
          pending: '50',
        },
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({ rpc: mockRpc })

      const balance = await serverSeam.getTintaBalance('user-456')
      expect(balance).toEqual({
        total: 300,
        available: 250,
        pending: 50,
      })
    })

    it('fail-open read: returns zeroes when RPC returns error', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'function not found' },
      })

      mocks.createAdminClient.mockReturnValue({ rpc: mockRpc })

      const balance = await serverSeam.getTintaBalance('user-456')
      expect(balance).toEqual({
        total: 0,
        available: 0,
        pending: 0,
      })
    })

    it('fail-open read: returns zeroes when RPC throws exception', async () => {
      const mockRpc = vi.fn().mockRejectedValue(new Error('Network failure'))
      mocks.createAdminClient.mockReturnValue({ rpc: mockRpc })

      const balance = await serverSeam.getTintaBalance('user-456')
      expect(balance).toEqual({
        total: 0,
        available: 0,
        pending: 0,
      })
    })
  })

  describe('AC3.4 exchangeTintaForLakoin', () => {
    function setupPolicyMock(policyOverrides: Partial<typeof DEFAULT_TINTA_POLICY> = {}) {
      const activePolicy = {
        ...DEFAULT_TINTA_POLICY,
        exchangeEnabled: true,
        tintaPerLakoin: 100,
        exchangeMinLakoin: 1,
        ...policyOverrides,
      }

      return vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              tinta_per_read: activePolicy.tintaPerRead,
              author_daily_cap: activePolicy.authorDailyCap,
              tinta_checkin: activePolicy.tintaCheckin,
              tinta_choice: activePolicy.tintaChoice,
              tinta_ad_batch: activePolicy.tintaAdBatch,
              tinta_per_lakoin: activePolicy.tintaPerLakoin,
              exchange_min_lakoin: activePolicy.exchangeMinLakoin,
              pending_hours: activePolicy.pendingHours,
              author_rewards_enabled: activePolicy.authorRewardsEnabled,
              exchange_enabled: activePolicy.exchangeEnabled,
              missions_pay_tinta: activePolicy.missionsPayTinta,
            },
            error: null,
          }),
        }),
      })
    }

    it('throws reader-safe error when exchange is disabled by policy', async () => {
      const mockSelect = setupPolicyMock({ exchangeEnabled: false })
      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      await expect(
        serverSeam.exchangeTintaForLakoin('user-1', 200),
      ).rejects.toThrow('Penukaran sedang dinonaktifkan.')
    })

    it('throws reader-safe error when amount produces less than minimum Lakoin', async () => {
      const mockSelect = setupPolicyMock({ exchangeMinLakoin: 2, tintaPerLakoin: 100 })
      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      await expect(
        serverSeam.exchangeTintaForLakoin('user-1', 150),
      ).rejects.toThrow('Penukaran minimal 2 Lakoin.')
    })

    it('throws reader-safe error when spend_tinta_v1 returns insufficient', async () => {
      const mockSelect = setupPolicyMock()
      const mockRpc = vi.fn().mockImplementation((fnName: string) => {
        if (fnName === 'spend_tinta_v1') {
          return Promise.resolve({ data: 'insufficient', error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
        rpc: mockRpc,
      })

      await expect(
        serverSeam.exchangeTintaForLakoin('user-1', 250),
      ).rejects.toThrow('Saldo Tinta tidak mencukupi')

      expect(mockRpc).toHaveBeenCalledWith(
        'spend_tinta_v1',
        expect.objectContaining({
          p_user_id: 'user-1',
          p_amount: 200,
          p_reason: 'tinta_exchange',
          p_ref: expect.stringMatching(/^exchange:[0-9a-f-]+$/),
        }),
      )
      // Grant credits must not be called
      expect(mockRpc).not.toHaveBeenCalledWith('grant_credits_v1', expect.anything())
    })

    it('throws error when spend_tinta_v1 returns duplicate or error', async () => {
      const mockSelect = setupPolicyMock()
      const mockRpc = vi.fn().mockImplementation((fnName: string) => {
        if (fnName === 'spend_tinta_v1') {
          return Promise.resolve({ data: 'duplicate', error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
        rpc: mockRpc,
      })

      await expect(
        serverSeam.exchangeTintaForLakoin('user-1', 200),
      ).rejects.toThrow('Transaksi penukaran sedang diproses')
    })

    it('happy-path: spends Tinta, grants Lakoin, returns lakoinOut and tintaSpent', async () => {
      const mockSelect = setupPolicyMock({ tintaPerLakoin: 100 })
      const mockRpc = vi.fn().mockImplementation((fnName: string, _args: Record<string, unknown>) => {
        if (fnName === 'spend_tinta_v1') {
          return Promise.resolve({ data: 'ok', error: null })
        }
        if (fnName === 'grant_credits_v1') {
          return Promise.resolve({ data: true, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
        rpc: mockRpc,
      })

      const result = await serverSeam.exchangeTintaForLakoin('user-1', 250)

      expect(result).toEqual({
        lakoinOut: 2,
        tintaSpent: 200,
      })

      // Check spend_tinta_v1 call
      expect(mockRpc).toHaveBeenCalledWith('spend_tinta_v1', {
        p_user_id: 'user-1',
        p_amount: 200,
        p_reason: 'tinta_exchange',
        p_ref: expect.stringMatching(/^exchange:[0-9a-f-]+$/),
      })

      // Check grant_credits_v1 call
      expect(mockRpc).toHaveBeenCalledWith('grant_credits_v1', {
        p_user_id: 'user-1',
        p_credits: 2,
        p_reason: 'tinta_exchange',
        p_ref: expect.stringMatching(/^tinta_exchange:[0-9a-f-]+$/),
      })

      // Rollback must NOT be called on success
      expect(mockRpc).not.toHaveBeenCalledWith('grant_tinta_v1', expect.anything())
    })

    it('rollback-path: when grant_credits_v1 fails with error, executes compensating grant_tinta_v1 and throws', async () => {
      const mockSelect = setupPolicyMock({ tintaPerLakoin: 100 })
      let capturedExchangeId = ''

      const mockRpc = vi.fn().mockImplementation((fnName: string, args: Record<string, unknown>) => {
        if (fnName === 'spend_tinta_v1') {
          capturedExchangeId = String(args.p_ref).replace('exchange:', '')
          return Promise.resolve({ data: 'ok', error: null })
        }
        if (fnName === 'grant_credits_v1') {
          return Promise.resolve({ data: null, error: new Error('grant error') })
        }
        if (fnName === 'grant_tinta_v1') {
          return Promise.resolve({ data: true, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
        rpc: mockRpc,
      })

      await expect(
        serverSeam.exchangeTintaForLakoin('user-1', 250),
      ).rejects.toThrow('grant_credits_v1 failed: grant error')

      // Rollback MUST be called with compensating grant_tinta_v1
      expect(mockRpc).toHaveBeenCalledWith('grant_tinta_v1', {
        p_user_id: 'user-1',
        p_ref: `exchange-rollback:${capturedExchangeId}`,
        p_delta: 200,
        p_reason: 'tinta_exchange_rollback',
        p_pending_hours: 0,
      })
    })

    it('rollback-path: when grant_credits_v1 returns false, executes compensating grant_tinta_v1 and throws', async () => {
      const mockSelect = setupPolicyMock({ tintaPerLakoin: 100 })
      let capturedExchangeId = ''

      const mockRpc = vi.fn().mockImplementation((fnName: string, args: Record<string, unknown>) => {
        if (fnName === 'spend_tinta_v1') {
          capturedExchangeId = String(args.p_ref).replace('exchange:', '')
          return Promise.resolve({ data: 'ok', error: null })
        }
        if (fnName === 'grant_credits_v1') {
          return Promise.resolve({ data: false, error: null })
        }
        if (fnName === 'grant_tinta_v1') {
          return Promise.resolve({ data: true, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
        rpc: mockRpc,
      })

      await expect(
        serverSeam.exchangeTintaForLakoin('user-1', 300),
      ).rejects.toThrow('grant_credits_v1 failed: unknown')

      expect(mockRpc).toHaveBeenCalledWith('grant_tinta_v1', {
        p_user_id: 'user-1',
        p_ref: `exchange-rollback:${capturedExchangeId}`,
        p_delta: 300,
        p_reason: 'tinta_exchange_rollback',
        p_pending_hours: 0,
      })
    })
  })

  describe('AC3.5 listTintaHistory', () => {
    it('queries tinta_ledger ordered by created_at desc with default limit 30', async () => {
      const mockData = [
        {
          id: 'row-1',
          delta: 10,
          reason: 'mission_choice',
          ref: 'mission:choice:1',
          pending_until: null,
          created_at: '2026-09-19T10:00:00Z',
        },
        {
          id: 'row-2',
          delta: 10,
          reason: 'author_read_reward',
          ref: 'author_read:story-1:2:reader-9',
          pending_until: '2026-09-20T10:00:00Z',
          created_at: '2026-09-19T09:00:00Z',
        },
      ]

      const mockLimit = vi.fn().mockResolvedValue({ data: mockData, error: null })
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      const history = await serverSeam.listTintaHistory('user-abc')

      expect(mockSelect).toHaveBeenCalledWith('id, delta, reason, ref, pending_until, created_at')
      expect(mockEq).toHaveBeenCalledWith('user_id', 'user-abc')
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false })
      expect(mockLimit).toHaveBeenCalledWith(30)

      expect(history).toHaveLength(2)
      expect(history[0]).toEqual({
        id: 'row-1',
        delta: 10,
        reason: 'mission_choice',
        ref: 'mission:choice:1',
        pending_until: null,
        created_at: '2026-09-19T10:00:00Z',
        pendingUntil: null,
        createdAt: '2026-09-19T10:00:00Z',
      })
      expect(history[1].pendingUntil).toBe('2026-09-20T10:00:00Z')
    })

    it('respects custom limit argument', async () => {
      const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      await serverSeam.listTintaHistory('user-abc', 10)
      expect(mockLimit).toHaveBeenCalledWith(10)
    })

    it('fail-open: returns empty array when DB returns error or throws', async () => {
      const mockLimit = vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } })
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

      mocks.createAdminClient.mockReturnValue({
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      })

      const history = await serverSeam.listTintaHistory('user-abc')
      expect(history).toEqual([])
    })
  })

  describe('AC3.6 Author reward separation', () => {
    it('does not export any author reward functions (reserved for Task P4)', () => {
      const exportedKeys = Object.keys(serverSeam)
      expect(exportedKeys).not.toContain('grantAuthorTinta')
      expect(exportedKeys).not.toContain('maybeGrantAuthorTinta')
      expect(exportedKeys).not.toContain('authorReward')
    })
  })
})
