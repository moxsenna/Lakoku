/**
 * Schema event analytics — reader-safe, no raw custom text / prose / boundaries.
 */
import { z } from 'zod'

export const ANALYTICS_EVENT_NAMES = [
  // Story setup (existing)
  'story_setup_entry_viewed',
  'story_setup_mode_selected',
  'story_setup_quiz_completed',
  'story_setup_custom_submitted',
  'story_setup_proposals_generated',
  'story_setup_premise_selected',
  'story_setup_build_started',
  'story_setup_login_required',
  'story_setup_resume_succeeded',
  'story_setup_story_started',
  'story_setup_failed',
  // Taste onboarding (plan §19)
  'taste_onboarding_viewed',
  'taste_onboarding_started',
  'taste_onboarding_step_completed',
  'taste_onboarding_skipped',
  'taste_profile_saved',
  'taste_profile_saved_local_only',
  // Story profile application
  'story_profile_applied',
  'story_profile_overridden',
  'story_premises_generated',
  'story_premise_selected',
  'story_creation_completed',
] as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number]

export const AnalyticsEventSchema = z
  .object({
    event_name: z.enum(ANALYTICS_EVENT_NAMES),
    story_setup_mode: z.enum(['quick', 'custom', 'brainstorm']).optional(),
    taste_profile_source: z.enum(['none', 'guest', 'server']).optional(),
    selected_premise_index: z.number().int().min(0).max(2).optional(),
    stage: z
      .enum([
        'entry',
        'quiz',
        'custom',
        'proposal',
        'build',
        'login_resume',
        'start',
        'intro',
        'genre',
        'conflicts',
        'boundaries',
        'tone',
        'ending_style',
      ])
      .optional(),
    is_logged_in: z.boolean().optional(),
    story_id: z.string().max(100).optional(),
    error_code: z.enum(['public_error', 'unknown', 'local_only', 'save_failed']).optional(),
    anonymous_id: z.string().uuid().nullable(),
    created_at: z.string(),
    // Safe aggregates only (counts / versions / buckets)
    profile_version: z.number().int().min(1).max(10).optional(),
    genre_count: z.number().int().min(0).max(2).optional(),
    conflict_count: z.number().int().min(0).max(3).optional(),
    soft_avoidance_count: z.number().int().min(0).max(8).optional(),
    boundary_count: z.number().int().min(0).max(12).optional(),
    step_number: z.number().int().min(0).max(10).optional(),
    question_count: z.number().int().min(0).max(12).optional(),
    has_usable_taste: z.boolean().optional(),
    direction_fingerprint: z.string().max(32).optional(),
  })
  .strict()

export type AnalyticsEventPayload = z.infer<typeof AnalyticsEventSchema>

/** Client payload — tanpa anonymous_id/created_at (diisi client.ts). */
export type AnalyticsClientPayload = Omit<
  AnalyticsEventPayload,
  'event_name' | 'anonymous_id' | 'created_at'
>
