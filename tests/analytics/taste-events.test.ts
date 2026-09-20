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

  it('accepts genre_id and prefill_genre on safe payloads', () => {
    const answered = AnalyticsEventSchema.safeParse({
      event_name: 'story_setup_question_answered',
      anonymous_id: null,
      created_at: '2026-09-20T00:00:00.000Z',
      question_key: 'genre',
      genre_id: 'romance',
      answer_mode: 'selected',
    })
    expect(answered.success).toBe(true)

    const viewed = AnalyticsEventSchema.safeParse({
      event_name: 'taste_onboarding_viewed',
      anonymous_id: null,
      created_at: '2026-09-20T00:00:00.000Z',
      stage: 'intro',
      profile_version: 2,
      prefill_genre: true,
    })
    expect(viewed.success).toBe(true)

    const invalidGenre = AnalyticsEventSchema.safeParse({
      event_name: 'story_setup_question_answered',
      anonymous_id: null,
      created_at: '2026-09-20T00:00:00.000Z',
      question_key: 'genre',
      genre_id: 'not_a_genre',
    })
    expect(invalidGenre.success).toBe(false)
  })
})
