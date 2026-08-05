import { createHash, randomUUID } from 'node:crypto'
import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateNextPersonalizedChapter } from '@/lib/runtime/personalized-generation'

const REQUEST_KIND = 'premium_clone' as const
const UNIQUE_VIOLATION = '23505'
const REQUEST_COLUMNS = 'story_id,request_hash,status,error_code' as const
const TARGET_COLUMNS = 'id,owner_user_id,visibility,source_story_id,story_mode' as const
const CHAPTER_COLUMNS = 'story_id,number' as const
const MAX_RESERVATION_ATTEMPTS = 3
const MAX_STORY_ID_LENGTH = 128

const IdempotencyKeySchema = z.string().trim().min(1).max(240).regex(/^[\x21-\x7E]+$/)
const UserIdSchema = z.string().uuid()
const TemplateIdSchema = z.string().min(1).max(120).regex(/^premium:[a-z0-9]+(?:-[a-z0-9]+)*$/)

const CreationRequestSchema = z
  .object({
    story_id: z.string().min(1),
    request_hash: z.string().length(64),
    status: z.enum(['RESERVED', 'READY', 'FAILED', 'WAITING_FOR_CREDITS']),
    error_code: z.string().nullable().optional(),
  })
  .strict()

const TargetStorySchema = z
  .object({
    id: z.string().min(1),
    owner_user_id: z.string().uuid(),
    visibility: z.literal('private'),
    source_story_id: z.string().min(1),
    story_mode: z.literal('premium_instance'),
    commercial_origin: z.string().nullable().optional(),
  })
  .strict()

export interface PremiumCloneResult {
  storyId: string
  redirectUrl: string
  replayed: boolean
}

const CloneRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    story_id: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['INVALID_TEMPLATE', 'TARGET_STORY_EXISTS', 'INTERNAL_ERROR']),
    error: z.string().optional(),
  }),
])

const ReserveStartRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.literal('RESERVED'),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.literal('INSUFFICIENT_CREDITS'),
    available: z.number().int().min(0),
    required: z.number().int().min(1),
  }),
])

const ClaimStarterRpcResultSchema = z.object({
  claimed: z.boolean(),
})

const ChapterOneSchema = z.object({
  story_id: z.string().min(1),
  number: z.literal(1),
})

export type PremiumCloneErrorCode =
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_USER'
  | 'INVALID_TEMPLATE_ID'
  | 'INVALID_TEMPLATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'GENERATION_IN_PROGRESS'
  | 'GENERATION_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'COMMERCIAL_RUNTIME_NOT_READY'
  | 'INTERNAL_ERROR'

export class PremiumCloneError extends Error {
  public readonly result?: PremiumCloneResult
  public readonly requiredCredits?: number
  public readonly availableCredits?: number

  constructor(
    public readonly code: PremiumCloneErrorCode,
    result?: PremiumCloneResult,
    requiredCredits?: number,
    availableCredits?: number,
  ) {
    super(code)
    this.name = 'PremiumCloneError'
    this.result = result
    this.requiredCredits = requiredCredits
    this.availableCredits = availableCredits
  }
}

export function buildPremiumCloneRequestHash(input: {
  userId: string
  templateStoryId: string
}): string {
  const payload = JSON.stringify({
    kind: REQUEST_KIND,
    userId: input.userId,
    templateStoryId: input.templateStoryId,
  })
  return createHash('sha256').update(payload).digest('hex')
}

function resultFor(storyId: string, replayed: boolean) {
  return {
    storyId,
    redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`,
    replayed,
  }
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
  templateStoryId: string
  userId: string
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

async function verifyDurableStarterProof(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  storyId: string
}): Promise<boolean> {
  const { data: accountState, error: accountErr } = await input.admin
    .from('account_commercial_states')
    .select('starter_story_id, starter_claimed_at')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (accountErr || !accountState) {
    return false
  }

  const { data: storyRow, error: storyErr } = await input.admin
    .from('stories')
    .select('commercial_origin')
    .eq('id', input.storyId)
    .maybeSingle()

  if (storyErr || !storyRow) {
    return false
  }

  return (
    accountState.starter_story_id === input.storyId
    && accountState.starter_claimed_at != null
    && storyRow.commercial_origin === 'STARTER_FREE'
  )
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

  // Ensure cheap premium story instance target shell exists in DB (commercial_origin NULL)
  await ensureTarget({
    admin,
    storyId: reserved.row.story_id,
    userId: input.userId,
    templateStoryId: input.templateStoryId,
  })

  // COMMERCIAL AUTHORIZATION PRE-FLIGHT BEFORE AI PROVIDER CALL
  const { data: accountState, error: accountErr } = await admin
    .from('account_commercial_states')
    .select('starter_story_id, starter_claimed_at')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (accountErr) {
    throw new PremiumCloneError('INTERNAL_ERROR')
  }

  const hasClaimedStarter = Boolean(
    accountState?.starter_claimed_at && accountState?.starter_story_id && accountState.starter_story_id !== reserved.row.story_id
  )

  if (!hasClaimedStarter) {
    const { data: claimData, error: claimErr } = await admin.rpc('claim_starter_story_v1', {
      p_user_id: input.userId,
      p_story_id: reserved.row.story_id,
    })

    if (!claimErr && claimData) {
      const parsed = ClaimStarterRpcResultSchema.safeParse(claimData)
      if (parsed.success && parsed.data.claimed) {
        await admin.rpc('grant_welcome_credit_v1', { p_user_id: input.userId }).then(() => null, () => null)
        const isDurable = await verifyDurableStarterProof({ admin, userId: input.userId, storyId: reserved.row.story_id })
        if (!isDurable) {
          throw new PremiumCloneError('INTERNAL_ERROR')
        }
      } else {
        const isDurableReplay = await verifyDurableStarterProof({ admin, userId: input.userId, storyId: reserved.row.story_id })
        if (!isDurableReplay) {
          throw new PremiumCloneError('INTERNAL_ERROR')
        }
      }
    } else {
      const isDurableReplay = await verifyDurableStarterProof({ admin, userId: input.userId, storyId: reserved.row.story_id })
      if (!isDurableReplay) {
        throw new PremiumCloneError('INTERNAL_ERROR')
      }
    }
  } else {
    const { data: resData, error: resErr } = await admin.rpc('reserve_story_start_v1', {
      p_user_id: input.userId,
      p_story_id: reserved.row.story_id,
    })

    if (resErr || !resData) {
      throw new PremiumCloneError('INTERNAL_ERROR')
    }

    const parsedRes = ReserveStartRpcResultSchema.safeParse(resData)
    if (!parsedRes.success) {
      throw new PremiumCloneError('INTERNAL_ERROR')
    }

    if (parsedRes.data.ok === false) {
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

      throw new PremiumCloneError('INSUFFICIENT_CREDITS', identity, parsedRes.data.required, parsedRes.data.available)
    }

    const { data: storyRow, error: storyErr } = await admin
      .from('stories')
      .select('commercial_origin')
      .eq('id', reserved.row.story_id)
      .maybeSingle()

    if (storyErr || !storyRow) {
      throw new PremiumCloneError('INTERNAL_ERROR')
    }

    if (storyRow.commercial_origin !== 'PENDING_PAID_START') {
      throw new PremiumCloneError('INTERNAL_ERROR')
    }

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
