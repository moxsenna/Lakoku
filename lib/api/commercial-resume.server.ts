import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { continuePersonalizedGeneration } from '@/lib/api/generation-continuation.server'
import { getTasteProfileForUser } from '@/lib/api/taste-profile'
import { normalizeTasteProfile } from '@/lib/taste-profile/schema'
import { authorizeStoryCreation, runContractAndGeneration } from '@/lib/api/personalized-stories.server'

export type CommercialResumeErrorCode =
  | 'STORY_NOT_FOUND'
  | 'NO_RESUMABLE_OPERATION'
  | 'AMBIGUOUS_RESUME_STATE'
  | 'INSUFFICIENT_CREDITS'
  | 'INTERNAL_ERROR'

export class CommercialResumeError extends Error {
  constructor(
    public readonly code: CommercialResumeErrorCode,
    public readonly requiredCredits?: number,
    public readonly availableCredits?: number,
    public readonly targetChapterNumber?: number,
  ) {
    super(code)
    this.name = 'CommercialResumeError'
  }
}

export interface ResumeCommercialOperationInput {
  userId: string
  storyId: string
}

export interface ResumeCommercialOperationResult {
  ok: true
  operationType: 'creation' | 'chapter'
  storyId: string
  chapterNumber: number
  ready: boolean
  redirectUrl?: string
  status?: 'READY' | 'PENDING'
}

const AuthorizeIntentResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.literal('AUTHORIZED'),
    replayed: z.boolean().optional(),
    amount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.literal('INSUFFICIENT_CREDITS'),
    available: z.number().int().nonnegative(),
    required: z.number().int().positive(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.string(),
  }).strict(),
])

const QueueJobResultSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  replayed: z.boolean().optional(),
  job_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
}).strict()

export async function resumeCommercialOperation(
  input: ResumeCommercialOperationInput,
): Promise<ResumeCommercialOperationResult> {
  const admin = createAdminClient()

  // 1) Query pending creation request for this story
  const { data: creationReqs, error: creationErr } = await admin
    .from('story_creation_requests')
    .select('story_id, status, generation_job_id, idempotency_key')
    .eq('owner_user_id', input.userId)
    .eq('story_id', input.storyId)
    .eq('request_kind', 'personalized')

  if (creationErr) throw new CommercialResumeError('INTERNAL_ERROR')

  const pendingCreation = (creationReqs ?? []).filter((r) => r.status === 'WAITING_FOR_CREDITS' || r.status === 'RESERVED')

  // 2) Query pending commercial intents for this story
  const { data: choiceIntents, error: choiceErr } = await admin
    .from('commercial_generation_intents')
    .select('story_id, chapter_number, status, generation_job_id, quoted_credits')
    .eq('user_id', input.userId)
    .eq('story_id', input.storyId)

  if (choiceErr) throw new CommercialResumeError('INTERNAL_ERROR')

  const pendingIntents = (choiceIntents ?? []).filter((i) => i.status === 'WAITING_FOR_CREDITS' || i.status === 'AUTHORIZED')

  const totalResumable = pendingCreation.length + pendingIntents.length

  if (totalResumable === 0) {
    throw new CommercialResumeError('NO_RESUMABLE_OPERATION')
  }

  if (totalResumable > 1) {
    throw new CommercialResumeError('AMBIGUOUS_RESUME_STATE')
  }

  // Handle Resumable Creation Request (Paid Story #2+ Start)
  if (pendingCreation.length === 1) {
    const creationReq = pendingCreation[0]
    const authRes = await authorizeStoryCreation({
      admin,
      userId: input.userId,
      storyId: input.storyId,
    })

    if (!authRes.ok) {
      throw new CommercialResumeError('INSUFFICIENT_CREDITS', authRes.requiredCredits, authRes.availableCredits, 1)
    }

    const tasteProfile = (await getTasteProfileForUser(input.userId)) ?? normalizeTasteProfile(null)

    const runRes = await runContractAndGeneration({
      admin,
      userId: input.userId,
      idempotencyKey: creationReq.idempotency_key,
      storyId: input.storyId,
      tasteProfile,
      commercialOrigin: authRes.origin,
    })

    const nextChapterReady = !runRes.pending

    return {
      ok: true,
      operationType: 'creation',
      storyId: input.storyId,
      chapterNumber: 1,
      ready: nextChapterReady,
      redirectUrl: nextChapterReady ? `/stories/${encodeURIComponent(input.storyId)}/read` : undefined,
      status: nextChapterReady ? 'READY' : 'PENDING',
    }
  }

  // Handle Resumable Choice Intent (Bab 4+)
  const intent = pendingIntents[0]

  const { data: authData, error: authErr } = await admin.rpc('authorize_commercial_generation_intent_v1', {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_chapter_number: intent.chapter_number,
  })

  if (authErr || !authData) throw new CommercialResumeError('INTERNAL_ERROR')

  const authParsed = AuthorizeIntentResultSchema.safeParse(authData)
  if (!authParsed.success) throw new CommercialResumeError('INTERNAL_ERROR')

  if (authParsed.data.ok === false) {
    if (
      authParsed.data.reason === 'INSUFFICIENT_CREDITS' &&
      'required' in authParsed.data &&
      typeof authParsed.data.required === 'number' &&
      'available' in authParsed.data &&
      typeof authParsed.data.available === 'number'
    ) {
      throw new CommercialResumeError('INSUFFICIENT_CREDITS', authParsed.data.required, authParsed.data.available, intent.chapter_number)
    }
    throw new CommercialResumeError('INTERNAL_ERROR')
  }

  const { data: queueData, error: queueErr } = await admin.rpc('queue_authorized_commercial_generation_v1', {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_chapter_number: intent.chapter_number,
  })

  if (queueErr || !queueData) {
    if (queueErr) console.error('[resumeCommercialOperation] queueErr:', queueErr)
    throw new CommercialResumeError('INTERNAL_ERROR')
  }

  const queueParsed = QueueJobResultSchema.safeParse(queueData)
  if (!queueParsed.success || !queueParsed.data.ok) throw new CommercialResumeError('INTERNAL_ERROR')

  const jobId = queueParsed.data.job_id

  const { nextChapterReady } = await continuePersonalizedGeneration({
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: intent.chapter_number,
    correlationId: queueParsed.data.correlation_id || '',
  })

  return {
    ok: true,
    operationType: 'chapter',
    storyId: input.storyId,
    chapterNumber: intent.chapter_number,
    ready: nextChapterReady,
    status: nextChapterReady ? 'READY' : 'PENDING',
  }
}
