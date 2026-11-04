import { z } from 'zod'

/**
 * Kontrak job setup cerita (perakitan story bible latar belakang).
 * Web & Android berbagi kontrak ini: client memulai job, lalu poll statusnya
 * sampai succeeded (dapat storyId) atau failed (dapat pesan ramah pembaca).
 */

export const STORY_SETUP_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export const STORY_SETUP_JOB_STAGES = ['cast', 'mystery', 'world', 'lock'] as const

export const STORY_SETUP_JOB_ERROR_CODES = [
  'cast_failed',
  'mystery_failed',
  'world_failed',
  'lock_failed',
  'needs_author',
  'busy',
  'unknown',
] as const

export const StorySetupJobStatusSchema = z.enum(STORY_SETUP_JOB_STATUSES)
export const StorySetupJobStageSchema = z.enum(STORY_SETUP_JOB_STAGES)
export const StorySetupJobErrorCodeSchema = z.enum(STORY_SETUP_JOB_ERROR_CODES)

export type StorySetupJobStatus = z.infer<typeof StorySetupJobStatusSchema>
export type StorySetupJobStage = z.infer<typeof StorySetupJobStageSchema>
export type StorySetupJobErrorCode = z.infer<typeof StorySetupJobErrorCodeSchema>

/** Response POST /api/stories/setup-jobs (202 Accepted). */
export const StorySetupJobStartResponseSchema = z
  .object({
    ok: z.literal(true),
    jobId: z.string().uuid(),
    status: StorySetupJobStatusSchema,
    stage: StorySetupJobStageSchema,
  })
  .strict()

export type StorySetupJobStartResponse = z.infer<typeof StorySetupJobStartResponseSchema>

export const StorySetupJobStartFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
  })
  .strict()

export type StorySetupJobStartFailure = z.infer<typeof StorySetupJobStartFailureSchema>

export const StorySetupJobStartResultSchema = z.discriminatedUnion('ok', [
  StorySetupJobStartResponseSchema,
  StorySetupJobStartFailureSchema,
])

/** Response GET /api/stories/setup-jobs/[id] — state polling. */
export const StorySetupJobPollResponseSchema = z
  .object({
    ok: z.literal(true),
    job: z
      .object({
        id: z.string().uuid(),
        status: StorySetupJobStatusSchema,
        stage: StorySetupJobStageSchema,
        errorCode: StorySetupJobErrorCodeSchema.optional(),
        errorMessage: z.string().optional(),
        storyId: z.string().optional(),
      })
      .strict(),
  })
  .strict()

export type StorySetupJobPollResponse = z.infer<typeof StorySetupJobPollResponseSchema>

export const StorySetupJobPollFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
  })
  .strict()

export type StorySetupJobPollFailure = z.infer<typeof StorySetupJobPollFailureSchema>
