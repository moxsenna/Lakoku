import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateNextPersonalizedChapter } from '@/lib/runtime/personalized-generation'

const REQUEST_KIND = 'premium_clone' as const
const UNIQUE_VIOLATION = '23505'
const MAX_STORY_ID_LENGTH = 128
const MAX_RESERVATION_ATTEMPTS = 3
const REQUEST_COLUMNS = 'story_id,request_hash,status' as const
const TARGET_COLUMNS = 'id,owner_user_id,visibility,source_story_id,story_mode' as const
const CHAPTER_COLUMNS = 'story_id,number' as const

const UserIdSchema = z.string().uuid()
const IdempotencyKeySchema = z.string().min(1).max(240).regex(/^[\x21-\x7E]+$/)
const TemplateIdSchema = z.string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim())
  .refine((value) => value.startsWith('premium:') && value.slice('premium:'.length).length > 0)

const CreationRequestSchema = z.object({
  story_id: z.string().min(1).max(MAX_STORY_ID_LENGTH),
  request_hash: z.string().length(64).regex(/^[a-f0-9]+$/),
  status: z.enum(['RESERVED', 'READY', 'FAILED']),
}).strict()

const TargetStorySchema = z.object({
  id: z.string().min(1),
  owner_user_id: z.string().uuid().nullable(),
  visibility: z.string(),
  source_story_id: z.string().nullable(),
  story_mode: z.string(),
}).strict()

const ChapterOneSchema = z.object({
  story_id: z.string().min(1),
  number: z.literal(1),
}).strict()

const CloneRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), story_id: z.string().min(1) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).passthrough(),
])

export type PremiumCloneErrorCode =
  | 'INVALID_USER'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_TEMPLATE_ID'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_TEMPLATE'
  | 'GENERATION_IN_PROGRESS'
  | 'GENERATION_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'COMMERCIAL_RUNTIME_NOT_READY'
  | 'INTERNAL_ERROR'

export interface PremiumCloneResult {
  storyId: string
  redirectUrl: string
  replayed: boolean
}

export class PremiumCloneError extends Error {
  constructor(
    public readonly code: PremiumCloneErrorCode,
    public readonly result?: PremiumCloneResult,
  ) {
    super(code)
    this.name = 'PremiumCloneError'
  }
}

function resultFor(storyId: string, replayed: boolean): PremiumCloneResult {
  return {
    storyId,
    redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`,
    replayed,
  }
}

export function buildPremiumCloneRequestHash(input: {
  userId: string
  templateStoryId: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      kind: REQUEST_KIND,
      userId: input.userId,
      templateStoryId: input.templateStoryId,
    }))
    .digest('hex')
}

function targetStoryId(templateStoryId: string): string {
  const rawSlug = templateStoryId.replace(/^premium:/, '')
  const uuid = randomUUID()
  const suffixLength = `ai:premium::${uuid}`.length
  const slug = rawSlug.slice(0, MAX_STORY_ID_LENGTH - suffixLength)
  if (!slug) throw new PremiumCloneError('INVALID_TEMPLATE_ID')
  return `ai:premium:${slug}:${uuid}`
}

async function loadReservation(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  requestHash: string
  hashMismatchCode?: 'IDEMPOTENCY_CONFLICT' | 'INTERNAL_ERROR'
}): Promise<z.infer<typeof CreationRequestSchema> | null> {
  const { data, error } = await input.admin
    .from('story_creation_requests')
    .select(REQUEST_COLUMNS)
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (error) throw new PremiumCloneError('INTERNAL_ERROR')
  if (!data) return null

  const parsed = CreationRequestSchema.safeParse(data)
  if (!parsed.success) throw new PremiumCloneError('INTERNAL_ERROR')
  if (parsed.data.request_hash !== input.requestHash) {
    throw new PremiumCloneError(input.hashMismatchCode ?? 'IDEMPOTENCY_CONFLICT')
  }
  return parsed.data
}

async function reserveTarget(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  templateStoryId: string
  idempotencyKey: string
  requestHash: string
}): Promise<{ row: z.infer<typeof CreationRequestSchema>; replayed: boolean }> {
  for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1) {
    const storyId = targetStoryId(input.templateStoryId)
    const { error } = await input.admin.from('story_creation_requests').insert({
      owner_user_id: input.userId,
      request_kind: REQUEST_KIND,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      story_id: storyId,
      status: 'RESERVED',
      error_code: null,
    })
    if (!error) {
      return {
        row: { story_id: storyId, request_hash: input.requestHash, status: 'RESERVED' },
        replayed: false,
      }
    }
    if (error.code !== UNIQUE_VIOLATION) throw new PremiumCloneError('INTERNAL_ERROR')

    const existing = await loadReservation(input)
    if (existing) return { row: existing, replayed: true }
  }
  throw new PremiumCloneError('INTERNAL_ERROR')
}

async function loadTarget(input: {
  admin: ReturnType<typeof createAdminClient>
  storyId: string
}): Promise<z.infer<typeof TargetStorySchema> | null> {
  const { data, error } = await input.admin
    .from('stories')
    .select(TARGET_COLUMNS)
    .eq('id', input.storyId)
    .maybeSingle()
  if (error) throw new PremiumCloneError('INTERNAL_ERROR')
  if (!data) return null
  const parsed = TargetStorySchema.safeParse(data)
  if (!parsed.success) throw new PremiumCloneError('INTERNAL_ERROR')
  return parsed.data
}

function assertExactTarget(input: {
  row: z.infer<typeof TargetStorySchema>
  storyId: string
  userId: string
  templateStoryId: string
}): void {
  if (
    input.row.id !== input.storyId
    || input.row.owner_user_id !== input.userId
    || input.row.visibility !== 'private'
    || input.row.source_story_id !== input.templateStoryId
    || input.row.story_mode !== 'premium_instance'
  ) {
    throw new PremiumCloneError('INTERNAL_ERROR')
  }
}

async function ensureTarget(input: {
  admin: ReturnType<typeof createAdminClient>
  storyId: string
  userId: string
  templateStoryId: string
}): Promise<void> {
  const existing = await loadTarget(input)
  if (existing) {
    assertExactTarget({ ...input, row: existing })
    return
  }

  const { data, error } = await input.admin.rpc('clone_premium_story_instance', {
    p_template_story_id: input.templateStoryId,
    p_user_id: input.userId,
    p_new_story_id: input.storyId,
  })

  if (error) {
    if (error.message.includes('INVALID_TEMPLATE')) {
      throw new PremiumCloneError('INVALID_TEMPLATE')
    }
    if (error.message.includes('TARGET_STORY_EXISTS')) {
      const racedTarget = await loadTarget(input)
      if (!racedTarget) throw new PremiumCloneError('INTERNAL_ERROR')
      assertExactTarget({ ...input, row: racedTarget })
      return
    }
    throw new PremiumCloneError('INTERNAL_ERROR')
  }

  const parsed = CloneRpcResultSchema.safeParse(data)
  if (!parsed.success) throw new PremiumCloneError('INTERNAL_ERROR')
  if (!parsed.data.ok) {
    if (parsed.data.reason === 'INVALID_TEMPLATE') {
      throw new PremiumCloneError('INVALID_TEMPLATE')
    }
    throw new PremiumCloneError('INTERNAL_ERROR')
  }
  if (parsed.data.story_id !== input.storyId) throw new PremiumCloneError('INTERNAL_ERROR')
}

async function chapterOneExists(input: {
  admin: ReturnType<typeof createAdminClient>
  storyId: string
}): Promise<boolean> {
  const { data, error } = await input.admin
    .from('chapters')
    .select(CHAPTER_COLUMNS)
    .eq('story_id', input.storyId)
    .eq('number', 1)
    .maybeSingle()
  if (error) throw new PremiumCloneError('INTERNAL_ERROR')
  if (!data) return false
  const parsed = ChapterOneSchema.safeParse(data)
  if (!parsed.success || parsed.data.story_id !== input.storyId) {
    throw new PremiumCloneError('INTERNAL_ERROR')
  }
  return true
}

async function updateReservation(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  requestHash: string
  storyId: string
  status: 'READY' | 'FAILED'
  errorCode: 'GENERATION_FAILED' | null
}): Promise<{ row: z.infer<typeof CreationRequestSchema>; replayed: boolean }> {
  const { data, error } = await input.admin
    .from('story_creation_requests')
    .update({
      status: input.status,
      error_code: input.errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)
    .eq('request_hash', input.requestHash)
    .eq('story_id', input.storyId)
    .in('status', ['RESERVED', 'FAILED'])
    .select(REQUEST_COLUMNS)
    .maybeSingle()
  if (error) throw new PremiumCloneError('INTERNAL_ERROR')

  let row: z.infer<typeof CreationRequestSchema> | null = null
  let replayed = false
  if (data) {
    const parsed = CreationRequestSchema.safeParse(data)
    if (!parsed.success) throw new PremiumCloneError('INTERNAL_ERROR')
    row = parsed.data
  } else {
    replayed = true
    row = await loadReservation({ ...input, hashMismatchCode: 'INTERNAL_ERROR' })
  }
  if (
    !row
    || row.story_id !== input.storyId
    || row.request_hash !== input.requestHash
    || (row.status !== input.status && row.status !== 'READY')
  ) {
    throw new PremiumCloneError('INTERNAL_ERROR')
  }
  return { row, replayed }
}

export async function clonePremiumStoryForUser(input: {
  userId: string
  templateStoryId: string
  idempotencyKey: string
}): Promise<{ storyId: string; redirectUrl: string; replayed: boolean }> {
  if (!UserIdSchema.safeParse(input.userId).success) {
    throw new PremiumCloneError('INVALID_USER')
  }
  if (!IdempotencyKeySchema.safeParse(input.idempotencyKey).success) {
    throw new PremiumCloneError('INVALID_IDEMPOTENCY_KEY')
  }
  if (!TemplateIdSchema.safeParse(input.templateStoryId).success) {
    throw new PremiumCloneError('INVALID_TEMPLATE_ID')
  }

  const requestHash = buildPremiumCloneRequestHash({
    userId: input.userId,
    templateStoryId: input.templateStoryId,
  })
  const admin = createAdminClient()
  const reserved = await reserveTarget({ ...input, requestHash, admin })
  const identity = resultFor(reserved.row.story_id, reserved.replayed)

  if (reserved.row.status === 'READY') return identity

  await ensureTarget({
    admin,
    storyId: reserved.row.story_id,
    userId: input.userId,
    templateStoryId: input.templateStoryId,
  })

  // COMMERCIAL AUTHORIZATION PRE-FLIGHT BEFORE AI PROVIDER CALL
  const { data: accountState } = await admin
    .from('account_commercial_states')
    .select('starter_story_id, starter_claimed_at')
    .eq('user_id', input.userId)
    .maybeSingle()

  const hasClaimedStarter = Boolean(accountState?.starter_claimed_at || accountState?.starter_story_id)

  if (!hasClaimedStarter) {
    if (typeof admin.rpc === 'function') {
      const { data: claimData, error: claimErr } = await admin.rpc('claim_starter_story_v1', {
        p_user_id: input.userId,
        p_story_id: reserved.row.story_id,
      })
      if (!claimErr && claimData && typeof claimData === 'object' && 'claimed' in claimData && claimData.claimed) {
        await admin.rpc('grant_welcome_credit_v1', { p_user_id: input.userId }).then(() => null, () => null)
      }
    }
  } else {
    if (typeof admin.rpc === 'function') {
      const { data: resData, error: resErr } = await admin.rpc('reserve_story_start_v1', {
        p_user_id: input.userId,
        p_story_id: reserved.row.story_id,
      })
      const isInsufficient = resErr || (resData && typeof resData === 'object' && 'status' in resData && resData.status === 'insufficient') || String(resData) === 'insufficient'
      if (isInsufficient) {
        await admin
          .from('story_creation_requests')
          .update({
            status: 'WAITING_FOR_CREDITS',
            error_code: 'INSUFFICIENT_CREDITS',
            updated_at: new Date().toISOString(),
          })
          .eq('owner_user_id', input.userId)
          .eq('request_kind', REQUEST_KIND)
          .eq('idempotency_key', input.idempotencyKey)

        throw new PremiumCloneError('INSUFFICIENT_CREDITS', identity)
      }
    }
  }

  const { data: storyRow } = await admin
    .from('stories')
    .select('commercial_origin')
    .eq('id', reserved.row.story_id)
    .maybeSingle()

  if (storyRow?.commercial_origin === 'PENDING_PAID_START') {
    throw new PremiumCloneError('COMMERCIAL_RUNTIME_NOT_READY', identity)
  }

  if (!await chapterOneExists({ admin, storyId: reserved.row.story_id })) {
    let generated
    try {
      generated = await generateNextPersonalizedChapter({
        storyId: reserved.row.story_id,
        userId: input.userId,
        chapterNumber: 1,
        correlationId: crypto.randomUUID(),
      })
    } catch {
      throw new PremiumCloneError('INTERNAL_ERROR')
    }

    if (!generated.ok) {
        // Includes FAILED_REVIEW_REQUIRED and CHOICE_GENERATION_FAILED
      if (generated.reason === 'CHAPTER_EXISTS') {
        if (!await chapterOneExists({ admin, storyId: reserved.row.story_id })) {
          throw new PremiumCloneError('INTERNAL_ERROR')
        }
      } else if (generated.reason === 'LEASE_HELD') {
        throw new PremiumCloneError('GENERATION_IN_PROGRESS', identity)
      } else if (
        generated.reason === 'CANON_MISSING'
        || generated.reason === 'FAILED_REVIEW_REQUIRED'
        || generated.reason === 'CHOICE_GENERATION_FAILED'
      ) {
        const transition = await updateReservation({
          admin,
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          storyId: reserved.row.story_id,
          status: 'FAILED',
          errorCode: 'GENERATION_FAILED',
        })
        if (transition.row.status === 'READY') {
          return resultFor(transition.row.story_id, true)
        }
        throw new PremiumCloneError('GENERATION_FAILED')
      } else {
        throw new PremiumCloneError('INTERNAL_ERROR')
      }
    }
  }

  const transition = await updateReservation({
    admin,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    storyId: reserved.row.story_id,
    status: 'READY',
    errorCode: null,
  })
  return resultFor(transition.row.story_id, reserved.replayed || transition.replayed)
}
