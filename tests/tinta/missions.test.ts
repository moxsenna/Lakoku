import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import {
  MISSION_LABELS,
  evaluateClaimability,
  type MissionView,
  type MissionPolicy,
  DEFAULT_MISSION_POLICY,
} from '@/lib/missions/policy'
import { getDailyMissions, claimMission } from '@/lib/missions/server'

describe('Task P5: Missions Pay Tinta Behind missions_pay_tinta Flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC5.3: Neutral copy in MISSION_LABELS.watch_ad', () => {
    it('does not mention "kredit bacamu" and mentions "menambah hadiahmu"', () => {
      const description = MISSION_LABELS.watch_ad.description
      expect(description).not.toContain('kredit bacamu')
      expect(description).toContain('menambah hadiahmu')
    })

    it('does not leak forbidden brand guard words', () => {
      const banned = /\b(AI|Narraza|RAG|token)\b/i
      expect(MISSION_LABELS.watch_ad.title).not.toMatch(banned)
      expect(MISSION_LABELS.watch_ad.description).not.toMatch(banned)
    })
  })

  describe('AC5.1: MissionView & Snapshot Currency Mapping in lib/missions/server', () => {
    it('maps currency="tinta" from RPC payload to snapshot and mission items', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          enabled: true,
          adRewardEnabled: false,
          day: '2026-09-19',
          adsWatched: 0,
          adDailyCap: 10,
          adsPerCredit: 5,
          currency: 'tinta',
          missions: [
            {
              key: 'daily_checkin',
              progress: 1,
              required: 1,
              credits: 5,
              claimed: false,
              currency: 'tinta',
            },
            {
              key: 'make_choice',
              progress: 2,
              required: 3,
              credits: 10,
              claimed: false,
              currency: 'tinta',
            },
          ],
        },
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const snapshot = await getDailyMissions('user-uuid-1')

      expect(mockRpc).toHaveBeenCalledWith('get_daily_missions_v1', {
        p_user_id: 'user-uuid-1',
      })
      expect(snapshot.currency).toBe('tinta')
      expect(snapshot.missions).toHaveLength(2)
      expect(snapshot.missions[0].currency).toBe('tinta')
      expect(snapshot.missions[0].credits).toBe(5)
      expect(snapshot.missions[1].currency).toBe('tinta')
      expect(snapshot.missions[1].credits).toBe(10)
    })

    it('maps currency="lakoin" from RPC payload when missions_pay_tinta is false', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          enabled: true,
          adRewardEnabled: false,
          day: '2026-09-19',
          adsWatched: 0,
          adDailyCap: 10,
          adsPerCredit: 5,
          currency: 'lakoin',
          missions: [
            {
              key: 'daily_checkin',
              progress: 1,
              required: 1,
              credits: 1,
              claimed: false,
              currency: 'lakoin',
            },
          ],
        },
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const snapshot = await getDailyMissions('user-uuid-2')

      expect(snapshot.currency).toBe('lakoin')
      expect(snapshot.missions[0].currency).toBe('lakoin')
      expect(snapshot.missions[0].credits).toBe(1)
    })

    it('falls back to "lakoin" when currency field is absent in RPC payload', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          enabled: true,
          adRewardEnabled: false,
          day: '2026-09-19',
          adsWatched: 0,
          adDailyCap: 10,
          adsPerCredit: 5,
          // currency absent (legacy RPC payload)
          missions: [
            {
              key: 'daily_checkin',
              progress: 1,
              required: 1,
              credits: 1,
              claimed: true,
            },
          ],
        },
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const snapshot = await getDailyMissions('user-uuid-3')

      expect(snapshot.currency).toBe('lakoin')
      expect(snapshot.missions[0].currency).toBe('lakoin')
    })

    it('falls back to "lakoin" when RPC returns error or null', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'DB connection error' },
      })
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              missions_enabled: true,
              ad_reward_enabled: false,
              ad_daily_cap: 10,
              ads_per_credit: 5,
            },
            error: null,
          }),
        }),
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
        from: vi.fn().mockReturnValue({
          select: mockSelect,
        }),
      })

      const snapshot = await getDailyMissions('user-uuid-4')

      expect(snapshot.currency).toBe('lakoin')
      expect(snapshot.missions).toEqual([])
    })
  })

  describe('AC5.5: Claim Mission Verification & Idempotency in lib/missions/server', () => {
    it('returns ok on successful claim', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: 'ok',
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const res = await claimMission('user-uuid-1', 'daily_checkin')
      expect(mockRpc).toHaveBeenCalledWith('claim_mission_v1', {
        p_user_id: 'user-uuid-1',
        p_mission_key: 'daily_checkin',
      })
      expect(res).toEqual({ ok: true, status: 'ok' })
    })

    it('returns duplicate on already claimed mission for today', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: 'duplicate',
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const res = await claimMission('user-uuid-1', 'daily_checkin')
      expect(res).toEqual({
        ok: false,
        reason: 'duplicate',
        message: 'Misi ini sudah kamu klaim hari ini.',
      })
    })

    it('returns incomplete when progress < required', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: 'incomplete',
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const res = await claimMission('user-uuid-1', 'make_choice')
      expect(res).toEqual({
        ok: false,
        reason: 'incomplete',
        message: 'Syarat misi belum terpenuhi.',
      })
    })

    it('returns disabled when missions are disabled', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: 'disabled',
        error: null,
      })

      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      const res = await claimMission('user-uuid-1', 'watch_ad')
      expect(res).toEqual({
        ok: false,
        reason: 'disabled',
        message: 'Misi sedang tidak aktif.',
      })
    })

    it('rejects unrecognized mission key without RPC call', async () => {
      const mockRpc = vi.fn()
      mocks.createAdminClient.mockReturnValue({
        rpc: mockRpc,
      })

      // @ts-expect-error testing invalid key
      const res = await claimMission('user-uuid-1', 'invalid_key')
      expect(mockRpc).not.toHaveBeenCalled()
      expect(res).toEqual({
        ok: false,
        reason: 'unknown_mission',
        message: 'Misi tidak dikenali.',
      })
    })
  })

  describe('Policy evaluateClaimability with currency', () => {
    it('evaluates claimability regardless of currency', () => {
      const policy: MissionPolicy = { ...DEFAULT_MISSION_POLICY }
      const missionTinta: MissionView = {
        key: 'daily_checkin',
        progress: 1,
        required: 1,
        credits: 5,
        claimed: false,
        currency: 'tinta',
      }
      expect(evaluateClaimability(missionTinta, policy)).toEqual({
        claimable: true,
        reason: null,
      })

      const missionLakoin: MissionView = {
        key: 'daily_checkin',
        progress: 1,
        required: 1,
        credits: 1,
        claimed: false,
        currency: 'lakoin',
      }
      expect(evaluateClaimability(missionLakoin, policy)).toEqual({
        claimable: true,
        reason: null,
      })
    })
  })

  describe('SQL Migration Content Verification (20260919000000_lakoin_tinta_economy.sql)', () => {
    const sqlPath = join(
      process.cwd(),
      'supabase/migrations/20260919000000_lakoin_tinta_economy.sql',
    )
    const sql = readFileSync(sqlPath, 'utf-8')

    it('defines get_daily_missions_v1 with tinta_policy branch and currency output', () => {
      expect(sql).toContain('create or replace function public.get_daily_missions_v1(p_user_id uuid)')
      expect(sql).toContain('select * into v_tinta from public.tinta_policy where id = true;')
      expect(sql).toContain('coalesce(v_tinta.missions_pay_tinta, false)')
      expect(sql).toContain("v_currency := 'tinta'")
      expect(sql).toContain("v_currency := 'lakoin'")
      expect(sql).toContain("'currency', v_currency")
      expect(sql).toContain('coalesce(v_tinta.tinta_checkin, 0)')
      expect(sql).toContain('coalesce(v_tinta.tinta_choice, 0)')
      expect(sql).toContain('coalesce(v_tinta.tinta_ad_batch, 0)')
      expect(sql).toContain('grant execute on function public.get_daily_missions_v1(uuid) to service_role;')
    })

    it('defines claim_mission_v1 with proof verification preserved verbatim', () => {
      expect(sql).toContain('create or replace function public.claim_mission_v1(')
      expect(sql).toContain('from public.personalized_choice_applications')
      expect(sql).toContain('from public.admob_ssv_events')
      expect(sql).toContain('from public.user_mission_daily')
      expect(sql).toContain("return 'duplicate'")
      expect(sql).toContain("return 'incomplete'")
      expect(sql).toContain("return 'disabled'")
      expect(sql).toContain("return 'unknown_mission'")
    })

    it('grants Tinta via grant_tinta_v1 when missions_pay_tinta is true', () => {
      expect(sql).toContain("v_ref := 'mission:' || p_mission_key || ':' || p_user_id::text || ':' || v_today::text;")
      expect(sql).toContain('perform public.grant_tinta_v1(p_user_id, v_ref, v_amount, v_reason, 0);')
      expect(sql).toContain("'mission_checkin'")
      expect(sql).toContain("'mission_choice'")
      expect(sql).toContain("'mission_ad_batch'")
    })

    it('grants Lakoin via grant_credits_v1 when missions_pay_tinta is false (reversible)', () => {
      expect(sql).toContain("perform public.grant_credits_v1(")
      expect(sql).toContain("'Misi harian: ' || p_mission_key")
    })

    it('grants execute on claim_mission_v1 to service_role', () => {
      expect(sql).toContain('grant execute on function public.claim_mission_v1(uuid, text) to service_role;')
    })
  })
})
