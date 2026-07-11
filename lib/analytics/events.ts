/**
 * Schema event analytics — definisi tipe dan Zod validator untuk fumek story creation.
 *
 * Hanya 11 event names yang diizinkan. Schema pakai .strict() agar field mentah
 * seperti customIdea, answers, synopsis, taste profile tidak bisa masuk.
 */
import { z } from 'zod'

export const ANALYTICS_EVENT_NAMES = [
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
] as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number]

export const AnalyticsEventSchema = z.object({
  event_name: z.enum(ANALYTICS_EVENT_NAMES),
  story_setup_mode: z.enum(['quick', 'custom', 'brainstorm']).optional(),
  taste_profile_source: z.enum(['none', 'guest', 'server']).optional(),
  selected_premise_index: z.number().int().min(0).max(2).optional(),
  stage: z
    .enum(['entry', 'quiz', 'custom', 'proposal', 'build', 'login_resume', 'start'])
    .optional(),
  is_logged_in: z.boolean().optional(),
  story_id: z.string().max(100).optional(),
  error_code: z.enum(['public_error', 'unknown']).optional(),
  anonymous_id: z.string().uuid().nullable(),
  created_at: z.string(),
}).strict()

export type AnalyticsEventPayload = z.infer<typeof AnalyticsEventSchema>

/** Tipe untuk payload yang dikirim dari client — tanpa anonymous_id/created_at (diisi client.ts). */
export type AnalyticsClientPayload = Omit<
  AnalyticsEventPayload,
  'event_name' | 'anonymous_id' | 'created_at'
>
