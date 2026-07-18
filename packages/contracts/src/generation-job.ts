import { z } from 'zod'

export const GENERATION_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRY_WAIT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const

export const GENERATION_KINDS = ['standard', 'personalized'] as const

export const GenerationJobStatusSchema = z.enum(GENERATION_JOB_STATUSES)
export const GenerationKindSchema = z.enum(GENERATION_KINDS)
export const GenerationJobReaderErrorCodeSchema = z.enum([
  'GENERATION_JOB_CONFLICT',
  'GENERATION_DEADLINE_EXCEEDED',
  'GENERATION_RETRY_EXHAUSTED',
  'GENERATION_FAILED',
  'GENERATION_CANCELLED',
])

const ActiveEnqueueGenerationJobResultSchema = z.object({
  alreadyComplete: z.literal(false),
  jobId: z.string().uuid(),
  correlationId: z.string().uuid(),
  status: z.enum(['QUEUED', 'RUNNING', 'RETRY_WAIT']),
}).strict()

const CompletedEnqueueGenerationJobResultSchema = z.object({
  alreadyComplete: z.literal(true),
  jobId: z.null(),
  correlationId: z.null(),
  status: z.literal('SUCCEEDED'),
}).strict()

export const EnqueueGenerationJobResultSchema = z.discriminatedUnion('alreadyComplete', [
  ActiveEnqueueGenerationJobResultSchema,
  CompletedEnqueueGenerationJobResultSchema,
])

export const GenerationJobReaderStatusSchema = z.object({
  jobId: z.string().uuid(),
  chapterNumber: z.number().int().min(1).max(50),
  status: GenerationJobStatusSchema,
  errorCode: GenerationJobReaderErrorCodeSchema.nullable(),
}).strict()

export type GenerationJobStatus = z.infer<typeof GenerationJobStatusSchema>
export type GenerationKind = z.infer<typeof GenerationKindSchema>
export type GenerationJobReaderErrorCode = z.infer<typeof GenerationJobReaderErrorCodeSchema>
export type EnqueueGenerationJobResult = z.infer<typeof EnqueueGenerationJobResultSchema>
export type GenerationJobReaderStatus = z.infer<typeof GenerationJobReaderStatusSchema>
