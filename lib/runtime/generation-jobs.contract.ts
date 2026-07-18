import { z } from 'zod'
import { GenerationKindSchema } from '../../packages/contracts/src/generation-job'

const WorkerIdSchema = z.string().trim().min(1).max(200)

export const ClaimedGenerationJobSchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().min(1),
  chapterNumber: z.number().int().min(1).max(50),
  userId: z.string().uuid(),
  generationKind: GenerationKindSchema,
  triggerChoiceId: z.string().min(1).nullable(),
  attemptCount: z.number().int().min(1).max(20),
  maxAttempts: z.number().int().min(1).max(20),
  deadlineAt: z.iso.datetime({ offset: true }),
  correlationId: z.string().uuid(),
  workerId: WorkerIdSchema,
  claimToken: z.string().uuid(),
}).strict().superRefine((job, context) => {
  if (job.attemptCount > job.maxAttempts) {
    context.addIssue({
      code: 'custom',
      message: 'attemptCount must not exceed maxAttempts',
      path: ['attemptCount'],
    })
  }
})

export const GenerationJobClaimResultSchema = z.discriminatedUnion('claimed', [
  z.object({ claimed: z.literal(false) }).strict(),
  z.object({
    claimed: z.literal(true),
    job: ClaimedGenerationJobSchema,
  }).strict(),
])

export const GenerationJobLeaseResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    leaseId: z.string().uuid(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['LEASE_HELD', 'OWNERSHIP_LOST']),
  }).strict(),
])

export const GenerationJobHeartbeatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.literal('OWNERSHIP_LOST'),
  }).strict(),
])

export const GenerationJobFinishOutcomeSchema = z.enum([
  'RETRY_WAIT',
  'FAILED',
  'CANCELLED',
])

export const GenerationJobRecoveryResultSchema = z.object({
  recoveredCount: z.number().int().nonnegative(),
}).strict()

export const FencedPublicationIdentitySchema = z.object({
  jobId: z.string().uuid(),
  workerId: WorkerIdSchema,
  claimToken: z.string().uuid(),
  leaseId: z.string().uuid(),
}).strict()

export type ClaimedGenerationJob = z.infer<typeof ClaimedGenerationJobSchema>
export type GenerationJobClaimResult = z.infer<typeof GenerationJobClaimResultSchema>
export type GenerationJobLeaseResult = z.infer<typeof GenerationJobLeaseResultSchema>
export type GenerationJobHeartbeatResult = z.infer<typeof GenerationJobHeartbeatResultSchema>
export type GenerationJobFinishOutcome = z.infer<typeof GenerationJobFinishOutcomeSchema>
export type GenerationJobRecoveryResult = z.infer<typeof GenerationJobRecoveryResultSchema>
export type FencedPublicationIdentity = z.infer<typeof FencedPublicationIdentitySchema>
