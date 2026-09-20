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
  'story_setup_question_answered',
  'story_setup_abandoned',
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
  // Lakoin-Tinta economy (spec §9)
  'tinta_earned',
  'author_reward_skipped',
  'tinta_exchanged',
  'story_visibility_changed',
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
    error_code: z
      .enum([
        'public_error',
        'unknown',
        'local_only',
        'save_failed',
        'propose_failed',
        'cast_failed',
        'mystery_failed',
        'world_failed',
        'lock_failed',
        'needs_author',
        'chapter_failed',
        'resume_expired',
      ])
      .optional(),
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
    // Funnel drop-off (reader-safe: id/bucket only, never raw text)
    question_key: z
      .enum([
        'genre',
        'coreConflict',
        'protagonistRole',
        'relationshipFocus',
        'agencyStyle',
        'endingDirection',
      ])
      .optional(),
    // Genre katalog V2 — id stabil, bukan teks bebas.
    genre_id: z
      .enum([
        'family_drama',
        'romance',
        'mystery',
        'fantasy_kingdom',
        'slice_of_life',
        'survival_thriller',
      ])
      .optional(),
    prefill_genre: z.boolean().optional(),
    answer_mode: z.enum(['selected', 'auto', 'custom']).optional(),
    build_stage: z.enum(['cast', 'mystery', 'world', 'lock', 'chapter']).optional(),
    custom_idea_length_bucket: z.enum(['short', 'medium', 'long']).optional(),
    duration_ms: z.number().int().min(0).max(3_600_000).optional(),
    // Lakoin-Tinta economy (spec §9)
    tinta_source: z
      .enum(['mission_checkin', 'mission_choice', 'mission_ad_batch', 'author_read_reward'])
      .optional(),
    tinta_amount_bucket: z.enum(['1_9', '10_49', '50_99', '100_plus']).optional(),
    tinta_skip_reason: z
      .enum(['disabled', 'not_public', 'self_read', 'duplicate', 'capped', 'guest'])
      .optional(),
    lakoin_out_bucket: z.enum(['1_4', '5_19', '20_99', '100_plus']).optional(),
    exchange_rate: z.number().int().min(10).max(100000).optional(),
    to_visibility: z.enum(['private', 'public']).optional(),
  })
  .strict()

export type AnalyticsEventPayload = z.infer<typeof AnalyticsEventSchema>

/** Client payload — tanpa anonymous_id/created_at (diisi client.ts). */
export type AnalyticsClientPayload = Omit<
  AnalyticsEventPayload,
  'event_name' | 'anonymous_id' | 'created_at'
>
