import { describe, expect, it } from 'vitest'
import { AnalyticsEventSchema, ANALYTICS_EVENT_NAMES } from '@/lib/analytics/events'

describe('taste analytics events', () => {
  it('includes plan funnel events', () => {
    for (const name of [
      'taste_onboarding_viewed',
      'taste_onboarding_started',
      'taste_onboarding_skipped',
      'taste_profile_saved',
      'taste_profile_saved_local_only',
      'story_premises_generated',
    ] as const) {
      expect(ANALYTICS_EVENT_NAMES).toContain(name)
    }
  })

  it('accepts safe aggregate payload', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      event_name: 'taste_profile_saved',
      anonymous_id: null,
      created_at: '2026-07-22T00:00:00.000Z',
      profile_version: 2,
      genre_count: 2,
      conflict_count: 2,
      soft_avoidance_count: 1,
      boundary_count: 2,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects raw custom idea field', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      event_name: 'taste_profile_saved',
      anonymous_id: null,
      created_at: '2026-07-22T00:00:00.000Z',
      customIdea: 'should not pass',
    })
    expect(parsed.success).toBe(false)
  })
})
