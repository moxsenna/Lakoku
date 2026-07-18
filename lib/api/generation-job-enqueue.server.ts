import 'server-only'
import { z } from 'zod'
import {
  EnqueueGenerationJobResultSchema,
  GenerationKindSchema,
  type EnqueueGenerationJobResult,
} from '@/packages/contracts/src/generation-job'
import { createClient } from '@/lib/supabase/server'

export type GenerationJobErrorCode =
  | 'AUTH_REQUIRED'
  | 'STORY_NOT_FOUND'
  | 'GENERATION_JOB_CONFLICT'
  | 'GENERATION_JOB_OWNERSHIP_LOST'
  | 'LEASE_HELD'
  | 'GENERATION_DEADLINE_EXCEEDED'
  | 'GENERATION_RETRY_EXHAUSTED'
  | 'GENERATION_PUBLICATION_CONFLICT'
  | 'INVALID_GENERATION_JOB_TRANSITION'
  | 'INTERNAL_ERROR'

export class GenerationJobError extends Error {
  constructor(public readonly code: GenerationJobErrorCode) {
    super(code)
    this.name = 'GenerationJobError'
  }
}

const BoundedIdentifierSchema = z.string().min(1).max(200)
  .refine((value) => value === value.trim())
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value))

const EnqueueGenerationJobInputSchema = z.object({
  storyId: BoundedIdentifierSchema,
  chapterNumber: z.number().int().min(1).max(50),
  generationKind: GenerationKindSchema,
  triggerChoiceId: BoundedIdentifierSchema.nullable(),
}).strict()

const RawEnqueueResultSchema = z.object({
  alreadyComplete: z.boolean(),
  jobId: z.string().uuid().nullable(),
  correlationId: z.string().uuid().nullable(),
  status: z.enum(['QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED']),
}).passthrough()

export type EnqueueGenerationJobInput = z.input<typeof EnqueueGenerationJobInputSchema>

type RpcError = { message?: unknown; code?: unknown }

const ERROR_TOKEN_MAP: ReadonlyArray<readonly [string, GenerationJobErrorCode]> = [
  ['INVALID_GENERATION_JOB_TRANSITION', 'INVALID_GENERATION_JOB_TRANSITION'],
  ['GENERATION_PUBLICATION_CONFLICT', 'GENERATION_PUBLICATION_CONFLICT'],
  ['GENERATION_JOB_DEADLINE_EXCEEDED', 'GENERATION_DEADLINE_EXCEEDED'],
  ['GENERATION_DEADLINE_EXCEEDED', 'GENERATION_DEADLINE_EXCEEDED'],
  ['GENERATION_RETRY_EXHAUSTED', 'GENERATION_RETRY_EXHAUSTED'],
  ['GENERATION_JOB_OWNERSHIP_LOST', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_CONFLICT', 'GENERATION_JOB_CONFLICT'],
  ['STORY_NOT_FOUND', 'STORY_NOT_FOUND'],
  ['AUTH_REQUIRED', 'AUTH_REQUIRED'],
  ['LEASE_HELD', 'LEASE_HELD'],
]

function mapRpcError(error: RpcError): GenerationJobError {
  const message = typeof error.message === 'string' ? error.message : ''
  const mapped = ERROR_TOKEN_MAP.find(([token]) => message.includes(token))?.[1]
  return new GenerationJobError(mapped ?? 'INTERNAL_ERROR')
}

export async function enqueueGenerationJob(
  input: EnqueueGenerationJobInput,
): Promise<EnqueueGenerationJobResult> {
  const parsed = EnqueueGenerationJobInputSchema.parse(input)
  const client = await createClient()
  const { data, error } = await client.rpc('enqueue_generation_job_v1', {
    p_story_id: parsed.storyId,
    p_chapter_number: parsed.chapterNumber,
    p_generation_kind: parsed.generationKind,
    p_trigger_choice_id: parsed.triggerChoiceId,
  })
  if (error) throw mapRpcError(error)

  const raw = RawEnqueueResultSchema.parse(data)
  return EnqueueGenerationJobResultSchema.parse({
    alreadyComplete: raw.alreadyComplete,
    jobId: raw.jobId,
    correlationId: raw.correlationId,
    status: raw.status,
  })
}
