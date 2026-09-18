import { describe, expect, it } from 'vitest'
import { AnalyticsEventSchema, ANALYTICS_EVENT_NAMES } from '@/lib/analytics/events'

const BASE = {
  anonymous_id: null,
  created_at: '2026-09-18T00:00:00.000Z',
} as const

describe('story setup funnel events', () => {
  it('registers every funnel stage name', () => {
    for (const name of [
      'story_setup_entry_viewed',
      'story_setup_mode_selected',
      'story_setup_question_answered',
      'story_setup_quiz_completed',
      'story_setup_custom_submitted',
      'story_setup_proposals_generated',
      'story_setup_premise_selected',
      'story_setup_build_started',
      'story_setup_login_required',
      'story_setup_resume_succeeded',
      'story_setup_story_started',
      'story_setup_failed',
      'story_setup_abandoned',
      'story_creation_completed',
    ] as const) {
      expect(ANALYTICS_EVENT_NAMES).toContain(name)
    }
  })

  it('accepts per-question drop-off payload', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_question_answered',
      stage: 'quiz',
      story_setup_mode: 'quick',
      question_key: 'coreConflict',
      answer_mode: 'custom',
      step_number: 2,
      question_count: 4,
      duration_ms: 18_320,
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts abandoned payload carrying build stage', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_abandoned',
      stage: 'build',
      build_stage: 'world',
      duration_ms: 90_000,
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts custom idea length bucket', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_custom_submitted',
      stage: 'custom',
      story_setup_mode: 'custom',
      custom_idea_length_bucket: 'medium',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts stage-specific failure codes', () => {
    for (const error_code of [
      'propose_failed',
      'cast_failed',
      'mystery_failed',
      'world_failed',
      'lock_failed',
      'needs_author',
      'chapter_failed',
      'resume_expired',
    ] as const) {
      const parsed = AnalyticsEventSchema.safeParse({
        ...BASE,
        event_name: 'story_setup_failed',
        stage: 'build',
        error_code,
      })
      expect(parsed.success, error_code).toBe(true)
    }
  })

  it('accepts taste step completion payload', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'taste_onboarding_step_completed',
      stage: 'boundaries',
      step_number: 3,
      profile_version: 2,
      genre_count: 2,
      conflict_count: 3,
      soft_avoidance_count: 2,
      boundary_count: 1,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('funnel payload stays reader-safe', () => {
  it('rejects raw answer text', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_question_answered',
      answer_text: 'rahasia keluarga yang disembunyikan',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects unknown question key', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_question_answered',
      question_key: 'somethingElse',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects raw custom idea on the custom submit event', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_custom_submitted',
      custom_idea: 'seorang pewaris menemukan surat lama',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects free-form length bucket', () => {
    const parsed = AnalyticsEventSchema.safeParse({
      ...BASE,
      event_name: 'story_setup_custom_submitted',
      custom_idea_length_bucket: '1423 karakter',
    })
    expect(parsed.success).toBe(false)
  })
})
