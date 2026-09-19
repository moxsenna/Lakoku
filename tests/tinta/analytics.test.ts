import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  getSessionUser: vi.fn(),
  isStoryOwnedBy: vi.fn(),
  revalidatePath: vi.fn(),
  getTintaPolicy: vi.fn(),
  exchangeTintaForLakoin: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/api/story-ownership.server', () => ({
  isStoryOwnedBy: mocks.isStoryOwnedBy,
}))

vi.mock('@/lib/tinta/server', () => ({
  getTintaPolicy: mocks.getTintaPolicy,
  exchangeTintaForLakoin: mocks.exchangeTintaForLakoin,
}))

import {
  ANALYTICS_EVENT_NAMES,
  AnalyticsEventSchema,
} from '@/lib/analytics/events'
import { trackServerEvent } from '@/lib/analytics/server'
import { maybeGrantAuthorTinta } from '@/lib/tinta/author-reward.server'
import { actExchangeTinta } from '@/app/(shell)/profil/tinta/actions'
import { PATCH } from '@/app/api/stories/[id]/visibility/route'
import { DEFAULT_TINTA_POLICY } from '@/lib/tinta/policy'

describe('Task P11: Analytics Events (AC11.1 - AC11.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insert.mockResolvedValue({ data: null, error: null })
    mocks.from.mockReturnValue({
      insert: mocks.insert,
      update: mocks.update,
      select: mocks.select,
    })
    mocks.createAdminClient.mockReturnValue({
      rpc: mocks.rpc,
      from: mocks.from,
    })
    mocks.getTintaPolicy.mockResolvedValue(DEFAULT_TINTA_POLICY)
  })

  describe('AC11.1: Schema & Event Names Strictness', () => {
    it('includes all 4 economy event names in ANALYTICS_EVENT_NAMES', () => {
      expect(ANALYTICS_EVENT_NAMES).toContain('tinta_earned')
      expect(ANALYTICS_EVENT_NAMES).toContain('author_reward_skipped')
      expect(ANALYTICS_EVENT_NAMES).toContain('tinta_exchanged')
      expect(ANALYTICS_EVENT_NAMES).toContain('story_visibility_changed')
    })

    it('accepts valid tinta_earned payload with all tinta sources and buckets', () => {
      const sources = [
        'mission_checkin',
        'mission_choice',
        'mission_ad_batch',
        'author_read_reward',
      ] as const
      const buckets = ['1_9', '10_49', '50_99', '100_plus'] as const

      for (const source of sources) {
        for (const bucket of buckets) {
          const res = AnalyticsEventSchema.safeParse({
            event_name: 'tinta_earned',
            tinta_source: source,
            tinta_amount_bucket: bucket,
            story_id: 'story-123',
            anonymous_id: null,
            created_at: new Date().toISOString(),
          })
          expect(res.success).toBe(true)
        }
      }
    })

    it('accepts valid author_reward_skipped payload with all skip reasons', () => {
      const reasons = [
        'disabled',
        'not_public',
        'self_read',
        'duplicate',
        'capped',
        'guest',
      ] as const

      for (const reason of reasons) {
        const res = AnalyticsEventSchema.safeParse({
          event_name: 'author_reward_skipped',
          tinta_skip_reason: reason,
          story_id: 'story-123',
          anonymous_id: null,
          created_at: new Date().toISOString(),
        })
        expect(res.success).toBe(true)
      }
    })

    it('accepts valid tinta_exchanged payload with lakoin buckets and exchange rates', () => {
      const buckets = ['1_4', '5_19', '20_99', '100_plus'] as const

      for (const bucket of buckets) {
        const res = AnalyticsEventSchema.safeParse({
          event_name: 'tinta_exchanged',
          lakoin_out_bucket: bucket,
          exchange_rate: 100,
          anonymous_id: null,
          created_at: new Date().toISOString(),
        })
        expect(res.success).toBe(true)
      }
    })

    it('accepts valid story_visibility_changed payload with to_visibility', () => {
      const visibilities = ['private', 'public'] as const

      for (const vis of visibilities) {
        const res = AnalyticsEventSchema.safeParse({
          event_name: 'story_visibility_changed',
          to_visibility: vis,
          story_id: 'story-abc',
          anonymous_id: null,
          created_at: new Date().toISOString(),
        })
        expect(res.success).toBe(true)
      }
    })

    it('rejects unlisted in to_visibility (strict enum private|public)', () => {
      const res = AnalyticsEventSchema.safeParse({
        event_name: 'story_visibility_changed',
        to_visibility: 'unlisted',
        story_id: 'story-abc',
        anonymous_id: null,
        created_at: new Date().toISOString(),
      })
      expect(res.success).toBe(false)
    })

    it('rejects invalid exchange_rate (under 10 or over 100000 or non-integer)', () => {
      expect(
        AnalyticsEventSchema.safeParse({
          event_name: 'tinta_exchanged',
          exchange_rate: 9,
          anonymous_id: null,
          created_at: new Date().toISOString(),
        }).success,
      ).toBe(false)

      expect(
        AnalyticsEventSchema.safeParse({
          event_name: 'tinta_exchanged',
          exchange_rate: 100001,
          anonymous_id: null,
          created_at: new Date().toISOString(),
        }).success,
      ).toBe(false)

      expect(
        AnalyticsEventSchema.safeParse({
          event_name: 'tinta_exchanged',
          exchange_rate: 100.5,
          anonymous_id: null,
          created_at: new Date().toISOString(),
        }).success,
      ).toBe(false)
    })

    it('rejects unknown raw fields via .strict()', () => {
      const res = AnalyticsEventSchema.safeParse({
        event_name: 'tinta_earned',
        tinta_source: 'mission_checkin',
        tinta_amount_bucket: '1_9',
        custom_comment: 'extra raw data not allowed',
        anonymous_id: null,
        created_at: new Date().toISOString(),
      })
      expect(res.success).toBe(false)
    })
  })

  describe('lib/analytics/server.ts: trackServerEvent', () => {
    it('successfully inserts validated event into analytics_events table', () => {
      trackServerEvent(
        'tinta_earned',
        {
          tinta_source: 'author_read_reward',
          tinta_amount_bucket: '10_49',
          story_id: 'story-123',
        },
        { userId: 'user-abc' },
      )

      expect(mocks.from).toHaveBeenCalledWith('analytics_events')
      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-abc',
          anonymous_id: null,
          event_name: 'tinta_earned',
          payload: expect.objectContaining({
            event_name: 'tinta_earned',
            tinta_source: 'author_read_reward',
            tinta_amount_bucket: '10_49',
            story_id: 'story-123',
            is_logged_in: true,
          }),
        }),
      )
    })

    it('silently ignores invalid payload without throwing', () => {
      expect(() => {
        trackServerEvent(
          'tinta_earned',
          // @ts-expect-error test runtime rejection of invalid source
          { tinta_source: 'invalid_source' },
        )
      }).not.toThrow()

      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('silently catches DB errors without throwing or blocking caller', () => {
      mocks.insert.mockRejectedValue(new Error('DB connection reset'))
      expect(() => {
        trackServerEvent('story_visibility_changed', {
          to_visibility: 'public',
          story_id: 'story-xyz',
        })
      }).not.toThrow()
    })
  })

  describe('AC11.2 & AC11.3: Instrumentation in Hook (lib/tinta/author-reward.server.ts)', () => {
    const params = {
      readerUserId: 'reader-111',
      storyId: 'story-abc',
      chapterNumber: 3,
    }

    it('emits tinta_earned event on RPC status ok', async () => {
      mocks.rpc.mockResolvedValue({ data: 'ok', error: null })
      mocks.getTintaPolicy.mockResolvedValue({
        ...DEFAULT_TINTA_POLICY,
        tintaPerRead: 10,
      })

      await maybeGrantAuthorTinta(params)

      expect(mocks.from).toHaveBeenCalledWith('analytics_events')
      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: params.readerUserId,
          event_name: 'tinta_earned',
          payload: expect.objectContaining({
            event_name: 'tinta_earned',
            tinta_source: 'author_read_reward',
            tinta_amount_bucket: '10_49',
            story_id: params.storyId,
          }),
        }),
      )
    })

    it('emits author_reward_skipped event on RPC status capped', async () => {
      mocks.rpc.mockResolvedValue({ data: 'capped', error: null })

      await maybeGrantAuthorTinta(params)

      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: params.readerUserId,
          event_name: 'author_reward_skipped',
          payload: expect.objectContaining({
            event_name: 'author_reward_skipped',
            tinta_skip_reason: 'capped',
            story_id: params.storyId,
          }),
        }),
      )
    })

    it('emits author_reward_skipped event on RPC status disabled', async () => {
      mocks.rpc.mockResolvedValue({ data: 'disabled', error: null })

      await maybeGrantAuthorTinta(params)

      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: params.readerUserId,
          event_name: 'author_reward_skipped',
          payload: expect.objectContaining({
            event_name: 'author_reward_skipped',
            tinta_skip_reason: 'disabled',
            story_id: params.storyId,
          }),
        }),
      )
    })

    it('emits author_reward_skipped event on RPC status duplicate (server hook)', async () => {
      mocks.rpc.mockResolvedValue({ data: 'duplicate', error: null })

      await maybeGrantAuthorTinta(params)

      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: params.readerUserId,
          event_name: 'author_reward_skipped',
          payload: expect.objectContaining({
            event_name: 'author_reward_skipped',
            tinta_skip_reason: 'duplicate',
            story_id: params.storyId,
          }),
        }),
      )
    })

    it('does NOT emit author_reward_skipped on status ineligible (log server only)', async () => {
      mocks.rpc.mockResolvedValue({ data: 'ineligible', error: null })

      await maybeGrantAuthorTinta(params)

      expect(mocks.insert).not.toHaveBeenCalled()
    })
  })

  describe('AC11.2: Instrumentation in Exchange Server Action (app/(shell)/profil/tinta/actions.ts)', () => {
    it('emits tinta_exchanged event on successful exchange', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-exchange-1' })
      mocks.exchangeTintaForLakoin.mockResolvedValue({
        lakoinOut: 2,
        tintaSpent: 200,
      })
      mocks.getTintaPolicy.mockResolvedValue({
        ...DEFAULT_TINTA_POLICY,
        tintaPerLakoin: 100,
      })

      const res = await actExchangeTinta(200)

      expect(res).toEqual({ ok: true, lakoinOut: 2, tintaSpent: 200 })
      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-exchange-1',
          event_name: 'tinta_exchanged',
          payload: expect.objectContaining({
            event_name: 'tinta_exchanged',
            lakoin_out_bucket: '1_4',
            exchange_rate: 100,
          }),
        }),
      )
    })
  })

  describe('AC11.2: Instrumentation in Visibility Route (app/api/stories/[id]/visibility/route.ts)', () => {
    it('emits story_visibility_changed event on successful PATCH', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'owner-uuid' })
      mocks.isStoryOwnedBy.mockResolvedValue(true)

      const updateEqMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      mocks.update.mockReturnValue({
        eq: updateEqMock,
      })

      const req = new Request('http://localhost/api/stories/story-999/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-999', visibility: 'public' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-999' }) })
      expect(res.status).toBe(200)

      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'owner-uuid',
          event_name: 'story_visibility_changed',
          payload: expect.objectContaining({
            event_name: 'story_visibility_changed',
            to_visibility: 'public',
            story_id: 'story-999',
          }),
        }),
      )
    })
  })

  describe('AC11.2: Instrumentation in Missions View (components/missions/missions-view.tsx)', () => {
    it('contains trackEvent tinta_earned with correct source mapping', () => {
      const filePath = join(process.cwd(), 'components/missions/missions-view.tsx')
      const source = readFileSync(filePath, 'utf-8')

      expect(source).toContain("import { trackEvent } from '@/lib/analytics/client'")
      expect(source).toContain("import { tintaAmountBucket } from '@/lib/tinta/policy'")
      expect(source).toContain("trackEvent('tinta_earned'")
      expect(source).toContain("daily_checkin: 'mission_checkin'")
      expect(source).toContain("make_choice: 'mission_choice'")
      expect(source).toContain("watch_ad: 'mission_ad_batch'")
      expect(source).toContain("tinta_amount_bucket: tintaAmountBucket(mission.credits)")
    })
  })
})
