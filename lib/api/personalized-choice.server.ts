import 'server-only'
import { z } from 'zod'
import { ChoiceEffectSchema } from '@/lib/ai-gateway/schemas'
import {
  ChoiceOutcomeSchema,
  JejakItemSchema,
  type ChoiceOutcome,
} from '@/packages/contracts/src/reader'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createCookieClient } from '@/lib/supabase/server'
import { ChoiceHistoryEntrySchema } from '@/lib/story-engine/chapter-brief'
import { mergeChoiceEffect, RouteStateSchema } from '@/lib/story-engine/route-state'

const STORY_AUTHORIZATION_COLUMNS = 'id' as const
const STORY_INTERNAL_COLUMNS = 'id,owner_user_id,visibility,story_mode' as const
const READER_STATE_INTERNAL_COLUMNS = 'user_id,story_id,status,current_chapter,jejak,ending_name,route_state,choice_history,locked_ending_key,updated_at' as const
const OUTCOME_INTERNAL_COLUMNS = 'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending,effect_json,choice_kind' as const
const CHAPTER_CHOICE_COLUMNS = 'story_id,number,choices' as const

const IdempotencyKeySchema = z.string().trim().min(1).max(240).regex(/^[\x21-\x7E]+$/)
const PersonalizedChapterSchema = z.number().int().min(1).max(49)
const StoryMetadataSchema = z.object({
  id: z.string().min(1),
  owner_user_id: z.string().uuid().nullable(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  story_mode: z.enum(['standard', 'personalized_ai', 'premium_template', 'premium_instance']),
}).strict()
const ReaderStateSchema = z.object({
  user_id: z.string().uuid(),
  story_id: z.string().min(1),
  status: z.enum(['BARU', 'BERJALAN', 'SELESAI']),
  current_chapter: z.number().int().positive(),
  jejak: z.array(JejakItemSchema),
  ending_name: z.string().nullable(),
  route_state: RouteStateSchema,
  choice_history: z.array(ChoiceHistoryEntrySchema).max(49),
  locked_ending_key: z.string().nullable(),
  updated_at: z.string().min(1),
}).strict()
const OutcomeInternalSchema = z.object({
  story_id: z.string().min(1),
  chapter_number: PersonalizedChapterSchema,
  choice_id: z.string().min(1).max(100),
  consequence: z.array(z.string().trim().min(1).max(160)).min(1).max(2),
  next_chapter_number: z.number().int().min(1).max(50).nullable(),
  is_ending: z.boolean(),
  effect_json: ChoiceEffectSchema,
  choice_kind: z.enum(['normal', 'special_bad_ending']),
}).strict()
const ChapterChoiceSchema = z.object({
  story_id: z.string().min(1),
  number: PersonalizedChapterSchema,
  choices: z.array(z.object({
    id: z.string().min(1).max(100),
    label: z.string().trim().min(1).max(240),
    hint: z.string().trim().min(1).optional(),
  }).strict()).min(1),
}).strict()

const AuthorizeIntentResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.enum(['AUTHORIZED', 'QUEUED']),
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
  }).passthrough(),
])

const QueueJobResultSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  replayed: z.boolean().optional(),
  job_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
}).strict()

export type PersonalizedChoiceErrorCode =
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_CHAPTER'
  | 'STORY_NOT_FOUND'
  | 'NOT_PERSONALIZED_STORY'
  | 'CHOICE_NOT_FOUND'
  | 'READER_STATE_MISSING'
  | 'IDEMPOTENCY_KEY_COLLISION'
  | 'CHOICE_CONFLICT'
  | 'POSITION_CONFLICT'
  | 'STALE_READER_STATE'
  | 'INVALID_STORED_DATA'
  | 'INSUFFICIENT_CREDITS'
  | 'INTERNAL_ERROR'

export class PersonalizedChoiceError extends Error {
  constructor(
    public readonly code: PersonalizedChoiceErrorCode,
    public readonly requiredCredits?: number,
    public readonly availableCredits?: number,
    public readonly targetChapterNumber?: number,
  ) {
    super(code)
    this.name = 'PersonalizedChoiceError'
  }
}

export interface ApplyPersonalizedChoiceInput {
  userId: string
  storyId: string
  chapterNumber: number
  choiceId: string
  idempotencyKey: string
}

export interface ApplyPersonalizedChoiceResult {
  outcome: ChoiceOutcome
  nextChapterNumber: number | null
  replayed: boolean
  jobId?: string
  status?: 'READY' | 'PENDING' | 'WAITING_FOR_CREDITS'
  requiredCredits?: number
  availableCredits?: number
  targetChapterNumber?: number
}

function invalidStoredData(): PersonalizedChoiceError {
  return new PersonalizedChoiceError('INVALID_STORED_DATA')
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw invalidStoredData()
  return parsed.data
}

function publicOutcome(row: z.infer<typeof OutcomeInternalSchema>): ChoiceOutcome {
  return ChoiceOutcomeSchema.parse({
    storyId: row.story_id,
    chapterNumber: row.chapter_number,
    choiceId: row.choice_id,
    consequence: row.consequence,
    nextChapterNumber: row.next_chapter_number,
    isEnding: row.is_ending,
  })
}

function effectSummary(effect: z.infer<typeof ChoiceEffectSchema>) {
  return {
    ...effect.routeDeltas,
    flagsSet: Object.entries(effect.flagsSet)
      .filter(([, value]) => value)
      .map(([key]) => key)
      .sort(),
  }
}

function mapRpcError(message: string): PersonalizedChoiceError {
  const typedCodes = [
    'IDEMPOTENCY_KEY_COLLISION',
    'CHOICE_CONFLICT',
    'POSITION_CONFLICT',
    'STALE_READER_STATE',
    'READER_STATE_MISSING',
    'STORY_NOT_FOUND',
    'CHOICE_NOT_FOUND',
  ] as const
  const code = typedCodes.find((candidate) => message.includes(candidate))
  return new PersonalizedChoiceError(code ?? 'INTERNAL_ERROR')
}

async function authorizeParentWithCookieRls(userId: string, storyId: string): Promise<void> {
  const cookieClient = await createCookieClient()
  const { data: { user }, error: userError } = await cookieClient.auth.getUser()
  if (userError || user?.id !== userId) {
    throw new PersonalizedChoiceError('STORY_NOT_FOUND')
  }

  const { data, error } = await cookieClient
    .from('stories')
    .select(STORY_AUTHORIZATION_COLUMNS)
    .eq('id', storyId)
    .maybeSingle()
  if (error) throw new PersonalizedChoiceError('INTERNAL_ERROR')
  if (!data) throw new PersonalizedChoiceError('STORY_NOT_FOUND')
}

export async function applyPersonalizedChoice(
  input: ApplyPersonalizedChoiceInput,
): Promise<ApplyPersonalizedChoiceResult> {
  await authorizeParentWithCookieRls(input.userId, input.storyId)

  const admin = createAdminClient()
  const { data: metadataData, error: metadataError } = await admin
    .from('stories')
    .select(STORY_INTERNAL_COLUMNS)
    .eq('id', input.storyId)
    .maybeSingle()
  if (metadataError) throw new PersonalizedChoiceError('INTERNAL_ERROR')
  if (!metadataData) throw new PersonalizedChoiceError('STORY_NOT_FOUND')

  const metadata = parseStored(StoryMetadataSchema, metadataData)
  const personalized = metadata.owner_user_id === input.userId
    && (metadata.visibility === 'private' || metadata.visibility === 'unlisted')
    && (metadata.story_mode === 'personalized_ai' || metadata.story_mode === 'premium_instance')
  if (!personalized) throw new PersonalizedChoiceError('NOT_PERSONALIZED_STORY')

  if (!IdempotencyKeySchema.safeParse(input.idempotencyKey).success) {
    throw new PersonalizedChoiceError('INVALID_IDEMPOTENCY_KEY')
  }
  if (!PersonalizedChapterSchema.safeParse(input.chapterNumber).success) {
    throw new PersonalizedChoiceError('INVALID_CHAPTER')
  }

  const { data: stateData, error: stateError } = await admin
    .from('reader_states')
    .select(READER_STATE_INTERNAL_COLUMNS)
    .eq('user_id', input.userId)
    .eq('story_id', input.storyId)
    .maybeSingle()
  if (stateError) throw new PersonalizedChoiceError('INTERNAL_ERROR')
  if (!stateData) throw new PersonalizedChoiceError('READER_STATE_MISSING')
  const state = parseStored(ReaderStateSchema, stateData)

  const { data: outcomeData, error: outcomeError } = await admin
    .from('choice_outcomes')
    .select(OUTCOME_INTERNAL_COLUMNS)
    .eq('story_id', input.storyId)
    .eq('chapter_number', input.chapterNumber)
    .eq('choice_id', input.choiceId)
    .maybeSingle()
  if (outcomeError) throw new PersonalizedChoiceError('INTERNAL_ERROR')
  if (!outcomeData) throw new PersonalizedChoiceError('CHOICE_NOT_FOUND')
  const outcomeRow = parseStored(OutcomeInternalSchema, outcomeData)

  const { data: chapterData, error: chapterError } = await admin
    .from('chapters')
    .select(CHAPTER_CHOICE_COLUMNS)
    .eq('story_id', input.storyId)
    .eq('number', input.chapterNumber)
    .maybeSingle()
  if (chapterError) throw new PersonalizedChoiceError('INTERNAL_ERROR')
  if (!chapterData) throw new PersonalizedChoiceError('CHOICE_NOT_FOUND')
  const chapter = parseStored(ChapterChoiceSchema, chapterData)
  const choice = chapter.choices.find((candidate) => candidate.id === input.choiceId)
  if (!choice) throw new PersonalizedChoiceError('CHOICE_NOT_FOUND')

  const outcome = publicOutcome(outcomeRow)
  const nextRouteState = mergeChoiceEffect(state.route_state, outcomeRow.effect_json)
  const createdAt = new Date().toISOString()
  const historyEntry = ChoiceHistoryEntrySchema.parse({
    chapterNumber: input.chapterNumber,
    choiceId: input.choiceId,
    label: choice.label,
    consequence: outcome.consequence,
    effectSummary: effectSummary(outcomeRow.effect_json),
    createdAt,
  })
  const jejakEntry = JejakItemSchema.parse({
    chapter: input.chapterNumber,
    decision: choice.label,
    consequence: outcome.consequence[0],
  })

  // STEP 1: Apply choice durably to DB via apply_personalized_choice_v2 (SQL)
  const { data: rpcData, error: rpcError } = await admin.rpc('apply_personalized_choice_v2', {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_chapter_number: input.chapterNumber,
    p_choice_id: input.choiceId,
    p_idempotency_key: input.idempotencyKey,
    p_expected_state: state,
    p_next_route_state: nextRouteState,
    p_history_entry: historyEntry,
    p_jejak_entry: jejakEntry,
  })
  if (rpcError) {
    if (rpcError.message.includes('COMMERCIAL_INTENT_CONFLICT')) {
      throw new PersonalizedChoiceError('CHOICE_CONFLICT')
    }
    throw mapRpcError(rpcError.message)
  }

  const result = parseStored(z.object({
    outcome: ChoiceOutcomeSchema,
    nextChapterNumber: z.number().int().positive().nullable(),
    replayed: z.boolean(),
  }), rpcData)

  const targetChapter = result.nextChapterNumber ?? outcome.nextChapterNumber

  if (outcome.isEnding || !targetChapter) {
    return {
      outcome: result.outcome,
      nextChapterNumber: targetChapter,
      replayed: result.replayed,
    }
  }

  // STEP 2: Commercial Intent & Job Queueing (personalized_ai only; premium_instance uses authenticated queueing)
  if (targetChapter >= 4 && metadata.story_mode === 'personalized_ai') {
    // Bab 4+: Quote-preserving commercial authorization & atomic queueing
    const { data: authData, error: authErr } = await admin.rpc('authorize_commercial_generation_intent_v1', {
      p_user_id: input.userId,
      p_story_id: input.storyId,
      p_chapter_number: targetChapter,
    })

    if (authErr?.message === 'SUCCEEDED_JOB_PRESENT') {
      return {
        outcome: result.outcome,
        nextChapterNumber: targetChapter,
        replayed: true,
      }
    }

    if (authErr || !authData) {
      throw new PersonalizedChoiceError('INTERNAL_ERROR')
    }

    const authParsed = AuthorizeIntentResultSchema.safeParse(authData)
    if (!authParsed.success) {
      throw new PersonalizedChoiceError('INTERNAL_ERROR')
    }

    if (authParsed.data.ok === false) {
      if (
        authParsed.data.reason === 'INSUFFICIENT_CREDITS' &&
        'required' in authParsed.data &&
        typeof authParsed.data.required === 'number' &&
        'available' in authParsed.data &&
        typeof authParsed.data.available === 'number'
      ) {
        return {
          outcome: result.outcome,
          nextChapterNumber: targetChapter,
          replayed: result.replayed,
          status: 'WAITING_FOR_CREDITS',
          requiredCredits: authParsed.data.required,
          availableCredits: authParsed.data.available,
        }
      }
      if (authParsed.data.reason === 'RESERVATION_ALREADY_CAPTURED') {
        return {
          outcome: result.outcome,
          nextChapterNumber: targetChapter,
          replayed: true,
        }
      }
      throw new PersonalizedChoiceError('INTERNAL_ERROR')
    }

    // Atomic Queueing
    const { data: queueData, error: queueErr } = await admin.rpc('queue_authorized_commercial_generation_v1', {
      p_user_id: input.userId,
      p_story_id: input.storyId,
      p_chapter_number: targetChapter,
    })

    if (queueErr || !queueData) {
      throw new PersonalizedChoiceError('INTERNAL_ERROR')
    }

    const queueParsed = QueueJobResultSchema.safeParse(queueData)
    if (!queueParsed.success || !queueParsed.data.ok) {
      throw new PersonalizedChoiceError('INTERNAL_ERROR')
    }

    return {
      outcome: result.outcome,
      nextChapterNumber: targetChapter,
      replayed: result.replayed,
      jobId: queueParsed.data.job_id,
    }
  } else {
    // Included Bab 2-3: Enqueue via authenticated request-scoped Supabase client
    const cookieClient = await createCookieClient()
    const { data: enqueueData, error: enqueueErr } = await cookieClient.rpc('enqueue_generation_job_v1', {
      p_story_id: input.storyId,
      p_chapter_number: targetChapter,
      p_generation_kind: 'personalized',
      p_trigger_choice_id: input.choiceId,
    })

    if (enqueueErr || !enqueueData) {
      throw new PersonalizedChoiceError('INTERNAL_ERROR')
    }

    const jobId = typeof enqueueData === 'object' && enqueueData !== null
      ? (
          typeof (enqueueData as { jobId?: unknown }).jobId === 'string'
            ? (enqueueData as { jobId: string }).jobId
            : (typeof (enqueueData as { job_id?: unknown }).job_id === 'string'
                ? (enqueueData as { job_id: string }).job_id
                : undefined)
        )
      : undefined

    return {
      outcome: result.outcome,
      nextChapterNumber: targetChapter,
      replayed: result.replayed,
      jobId,
    }
  }
}
