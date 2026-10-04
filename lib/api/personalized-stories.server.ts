import 'server-only'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { getDb, result, rpcOne, single } from '@lakoku/db'
import type { Json } from '@/lib/supabase/db-types'
import {
  type TasteProfile,
  createDefaultTasteProfile,
  asV1Compat,
} from '@/lib/taste-profile/schema'

import {
  createResilientStoryContract,
} from '@/lib/story-engine/contract-generation.server'
import { persistContractAndCanon } from '@/lib/story-engine/contract-persistence.server'
import {
  generateNextPersonalizedChapter,
} from '@/lib/runtime/personalized-generation'
import { selectProvider } from '@lakoku/ai-gateway/server'
import { createSynchronousProviderContext } from '@/lib/runtime/generation-provider-context'
import { getTasteProfileForUser } from '@/lib/api/taste-profile'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { continuePersonalizedGeneration } from '@/lib/api/generation-continuation.server'

function shellMetadata(contractTitle: string, contractGenre: string, tropes: string[]) {
  const title = contractTitle.trim() || 'Cerita Pribadi'
  const tagline = contractGenre.trim() || 'Drama interaktif personal'
  return {
    title: title.slice(0, 160),
    cover: '/placeholder.svg?height=400&width=300',
    tagline: tagline.slice(0, 200),
    role: 'Pembaca sebagai tokoh utama',
    tropes: tropes.slice(0, 8),
    synopsis: `Cerita pribadi bergenre ${tagline}.`.slice(0, 800),
  }
}

function tasteProfileVersion(profile: TasteProfile): number {
  return typeof profile.version === 'number' ? profile.version : 1
}

export function buildPersonalizedRequestHash(input: {
  userId: string
  tasteProfileVersion: number
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      kind: 'personalized',
      userId: input.userId,
      tasteProfileVersion: input.tasteProfileVersion,
    }))
    .digest('hex')
}

const REQUEST_KIND = 'personalized' as const
const UNIQUE_VIOLATION = '23505' as const

const IdempotencyKeySchema = z.string().trim().min(1).max(240).regex(/^[\x21-\x7E]+$/)
const UserIdSchema = z.string().uuid()

const CreationRequestRowSchema = z.object({
  story_id: z.string().min(1),
  request_hash: z.string().min(1),
  status: z.enum(['RESERVED', 'WAITING_FOR_CREDITS', 'READY', 'FAILED']),
  error_code: z.string().nullable().optional(),
  generation_job_id: z.string().uuid().nullable().optional(),
})

const ClaimStarterRpcResultSchema = z.object({
  claimed: z.boolean(),
  starterStoryId: z.string().nullable().optional(),
  claimedAt: z.string().nullable().optional(),
}).strict()

const ReserveStartRpcResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.string(),
    ref: z.string(),
    replayed: z.boolean().optional(),
    reactivated: z.boolean().optional(),
  }).passthrough(),
  z.object({
    ok: z.literal(false),
    reason: z.string(),
    required: z.number().int().positive().optional(),
    available: z.number().int().nonnegative().optional(),
  }).passthrough(),
])

const QueuePaidStartRpcResultSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  replayed: z.boolean().optional(),
  job_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
}).strict()

export type PersonalizedStoryErrorCode =
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RESERVATION_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'SHELL_FAILED'
  | 'CONTRACT_FAILED'
  | 'READER_STATE_FAILED'
  | 'GENERATION_FAILED'
  | 'MARK_READY_FAILED'
  | 'COMMERCIAL_RUNTIME_NOT_READY'
  | 'INTERNAL_ERROR'

export class PersonalizedStoryError extends Error {
  constructor(
    public readonly code: PersonalizedStoryErrorCode,
    public readonly storyId?: string,
    public readonly requiredCredits?: number,
    public readonly availableCredits?: number,
  ) {
    super(code)
    this.name = 'PersonalizedStoryError'
  }
}

export interface CreatePersonalizedStoryInput {
  userId: string
  idempotencyKey: string
}

export type CreatePersonalizedStoryResult =
  | {
      ok?: true
      storyId: string
      redirectUrl: string
      replayed: boolean
      pending?: false
    }
  | {
      ok?: true
      storyId: string
      redirectUrl?: undefined
      replayed?: false
      pending: true
    }

function resultFor(storyId: string, replayed: boolean): CreatePersonalizedStoryResult {
  return {
    storyId,
    redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`,
    replayed,
  }
}

async function markFailed(input: {
  userId: string
  idempotencyKey: string
  storyId?: string
  errorCode: string
  admin?: unknown
}): Promise<void> {
  try {
    const db = getDb()
    await db
      .updateTable('story_creation_requests')
      .set({
        status: 'FAILED',
        error_code: input.errorCode,
        updated_at: new Date().toISOString(),
      })
      .where('owner_user_id', '=', input.userId)
      .where('request_kind', '=', REQUEST_KIND)
      .where('idempotency_key', '=', input.idempotencyKey)
      .execute()

    if (input.storyId) {
      await db
        .updateTable('stories')
        .set({
          generation_status: 'failed',
        })
        .where('id', '=', input.storyId)
        .where('owner_user_id', '=', input.userId)
        .execute()
    }
  } catch {
    // Ignore update failures during error reporting
  }
}

/**
  Guarded CAS markWaiting: updates status to WAITING_FOR_CREDITS ONLY IF
  status is RESERVED and generation_job_id is NULL. Returns true if CAS succeeded.
 */
async function markWaiting(input: {
  userId: string
  idempotencyKey: string
  storyId?: string
  admin?: unknown
}): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .updateTable('story_creation_requests')
    .set({
      status: 'WAITING_FOR_CREDITS',
      error_code: 'INSUFFICIENT_CREDITS',
      updated_at: new Date().toISOString(),
    })
    .where('owner_user_id', '=', input.userId)
    .where('request_kind', '=', REQUEST_KIND)
    .where('idempotency_key', '=', input.idempotencyKey)
    .where('status', '=', 'RESERVED')
    .where('generation_job_id', 'is', null)
    .returning('status')
    .execute()

  return rows.length > 0
}

async function markReady(input: {
  userId: string
  idempotencyKey: string
  storyId: string
  admin?: unknown
}): Promise<void> {
  const db = getDb()
  const { error: storyError } = await result(
    db
      .updateTable('stories')
      .set({
        generation_status: 'ready',
      })
      .where('id', '=', input.storyId)
      .where('owner_user_id', '=', input.userId)
      .execute(),
  )

  if (storyError) {
    throw new PersonalizedStoryError('MARK_READY_FAILED', input.storyId)
  }

  const { error: requestError } = await result(
    db
      .updateTable('story_creation_requests')
      .set({
        status: 'READY',
        error_code: null,
        updated_at: new Date().toISOString(),
      })
      .where('owner_user_id', '=', input.userId)
      .where('request_kind', '=', REQUEST_KIND)
      .where('idempotency_key', '=', input.idempotencyKey)
      .execute(),
  )

  if (requestError) {
    throw new PersonalizedStoryError('MARK_READY_FAILED', input.storyId)
  }
}

export async function verifyDurableStarterProof(input: {
  userId: string
  storyId: string
  admin?: unknown
}): Promise<boolean> {
  const db = (input.admin && typeof input.admin === 'object' && 'selectFrom' in input.admin)
    ? (input.admin as ReturnType<typeof getDb>)
    : getDb()
  // RLS_AUDIT: account_commercial_states_owner_read
  const { data: accountState, error: accountErr } = await single(
    db
      .selectFrom('account_commercial_states')
      .select(['starter_story_id', 'starter_claimed_at'])
      .where('user_id', '=', input.userId)
      .limit(1)
      .execute(),
  )

  if (accountErr || !accountState) {
    return false
  }

  // RLS_AUDIT: stories_owner_read
  const { data: storyRow, error: storyErr } = await single(
    db
      .selectFrom('stories')
      .select('commercial_origin')
      .where('id', '=', input.storyId)
      .where('owner_user_id', '=', input.userId)
      .limit(1)
      .execute(),
  )

  if (storyErr || !storyRow) {
    return false
  }

  return (
    accountState.starter_story_id === input.storyId
    && accountState.starter_claimed_at != null
    && storyRow.commercial_origin === 'STARTER_FREE'
  )
}

export async function authorizeStoryCreation(input: {
  userId: string
  storyId: string
  admin?: unknown
}): Promise<
  | { ok: true; origin: 'STARTER_FREE' | 'PENDING_PAID_START' }
  | { ok: false; error: 'INSUFFICIENT_CREDITS'; requiredCredits: number; availableCredits: number }
> {
  const db = (input.admin && typeof input.admin === 'object' && 'selectFrom' in input.admin)
    ? (input.admin as ReturnType<typeof getDb>)
    : getDb()
  // RLS_AUDIT: account_commercial_states_owner_read
  const { data: accountState, error: accountErr } = await single(
    db
      .selectFrom('account_commercial_states')
      .select(['starter_story_id', 'starter_claimed_at'])
      .where('user_id', '=', input.userId)
      .limit(1)
      .execute(),
  )

  if (accountErr) {
    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  const hasClaimedStarter = Boolean(
    accountState?.starter_claimed_at && accountState?.starter_story_id && accountState.starter_story_id !== input.storyId
  )

  if (!hasClaimedStarter) {
    const { data: claimData, error: claimErr } = await single(
      rpcOne(db, 'claim_starter_story_v1', {
        p_user_id: input.userId,
        p_story_id: input.storyId,
      }).execute(),
    )

    if (!claimErr && claimData) {
      const parsed = ClaimStarterRpcResultSchema.safeParse(claimData?.fn ?? claimData)
      if (parsed.success && parsed.data.claimed) {
        await single(rpcOne(db, 'grant_welcome_credit_v1', { p_user_id: input.userId }).execute()).catch(() => null)
        return { ok: true, origin: 'STARTER_FREE' }
      }
    }

    const isDurableReplay = await verifyDurableStarterProof({ userId: input.userId, storyId: input.storyId })
    if (isDurableReplay) {
      return { ok: true, origin: 'STARTER_FREE' }
    }

    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  const { data: resData, error: resError } = await single(
    rpcOne(db, 'reserve_story_start_v1', {
      p_user_id: input.userId,
      p_story_id: input.storyId,
    }).execute(),
  )

  if (resError || !resData) {
    if (resError) console.error('[authorizeStoryCreation] resError:', resError)
    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  const parsedRes = ReserveStartRpcResultSchema.safeParse(resData?.fn ?? resData)
  if (!parsedRes.success) {
    console.error('[authorizeStoryCreation] parsedRes error:', parsedRes.error)
    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  if (parsedRes.data.ok === false) {
    console.error('[authorizeStoryCreation] reserve_story_start_v1 ok=false:', parsedRes.data)
    if (parsedRes.data.reason === 'INSUFFICIENT_CREDITS') {
      return {
        ok: false,
        error: 'INSUFFICIENT_CREDITS',
        requiredCredits: parsedRes.data.required ?? 24,
        availableCredits: parsedRes.data.available ?? 0,
      }
    }
    throw new PersonalizedStoryError('RESERVATION_FAILED', input.storyId)
  }

  return { ok: true, origin: 'PENDING_PAID_START' }
}

async function loadExistingReservation(input: {
  userId: string
  idempotencyKey: string
  requestHash: string
  tasteProfile: TasteProfile
  admin?: unknown
}): Promise<CreatePersonalizedStoryResult> {
  const db = getDb()
  // RLS_AUDIT: story_creation_requests_owner_read
  const { data, error } = await single(
    db
      .selectFrom('story_creation_requests')
      .select(['story_id', 'request_hash', 'status', 'error_code', 'generation_job_id'])
      .where('owner_user_id', '=', input.userId)
      .where('request_kind', '=', REQUEST_KIND)
      .where('idempotency_key', '=', input.idempotencyKey)
      .limit(1)
      .execute(),
  )

  if (error || !data) throw new PersonalizedStoryError('RESERVATION_FAILED')
  const row = CreationRequestRowSchema.safeParse(data)
  if (!row.success) throw new PersonalizedStoryError('INTERNAL_ERROR')
  if (row.data.request_hash !== input.requestHash) {
    throw new PersonalizedStoryError('IDEMPOTENCY_CONFLICT')
  }

  const existingStoryId = row.data.story_id

  if (row.data.status === 'READY') {
    return resultFor(existingStoryId, true)
  }

  if (row.data.status === 'WAITING_FOR_CREDITS' || row.data.status === 'RESERVED') {
    const authRes = await authorizeStoryCreation({
      userId: input.userId,
      storyId: existingStoryId,
    })

    if (!authRes.ok) {
      const casSuccess = await markWaiting({ userId: input.userId, idempotencyKey: input.idempotencyKey, storyId: existingStoryId })
      if (!casSuccess) {
        // Re-read authoritative request state
        const { data: latestData } = await single(
          db
            .selectFrom('story_creation_requests')
            .select(['status', 'story_id'])
            .where('owner_user_id', '=', input.userId)
            .where('request_kind', '=', REQUEST_KIND)
            .where('idempotency_key', '=', input.idempotencyKey)
            .limit(1)
            .execute(),
        )
        if (latestData?.status === 'READY') {
          return resultFor(existingStoryId, true)
        }
      }
      throw new PersonalizedStoryError('INSUFFICIENT_CREDITS', existingStoryId, authRes.requiredCredits, authRes.availableCredits)
    }

    const runRes = await runContractAndGeneration({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      storyId: existingStoryId,
      tasteProfile: input.tasteProfile,
      commercialOrigin: authRes.origin,
    })

    if (runRes.pending) {
      return { ok: true, storyId: existingStoryId, pending: true }
    }

    return resultFor(existingStoryId, true)
  }

  throw new PersonalizedStoryError('RESERVATION_FAILED')
}

export async function runContractAndGeneration(input: {
  userId: string
  idempotencyKey: string
  storyId: string
  tasteProfile: TasteProfile
  commercialOrigin: string
  admin?: unknown
}): Promise<{ pending?: boolean }> {
  const correlationId = randomUUID()
  const db = getDb()

  // Inspect if story_generation_contracts already exists
  // RLS_AUDIT: story_generation_contracts_owner_read
  const { data: existingContract } = await single(
    db
      .selectFrom('story_generation_contracts')
      .select('story_id')
      .where('story_id', '=', input.storyId)
      .limit(1)
      .execute(),
  )

  if (!existingContract) {
    const contractProviderContext = createSynchronousProviderContext({
      userId: input.userId,
      storyId: input.storyId,
      chapterNumber: null,
      generationKind: 'personalized',
      correlationId,
    })
    const provider = await selectProvider(contractProviderContext)
    const { contract, contractSource } = await createResilientStoryContract({
      storyId: input.storyId,
      tasteJson: input.tasteProfile,
      provider,
      telemetryContext: contractProviderContext,
    })

    const meta = shellMetadata(
      contract.title,
      contract.genre,
      asV1Compat(input.tasteProfile).likedTropes ?? [],
    )
    // RLS_AUDIT: stories_owner_update
    await db
      .updateTable('stories')
      .set({
        title: meta.title,
        tagline: meta.tagline,
        synopsis: meta.synopsis,
        tropes: meta.tropes as unknown as Json,
        generation_status: 'creating_contract',
      })
      .where('id', '=', input.storyId)
      .where('owner_user_id', '=', input.userId)
      .execute()

    await persistContractAndCanon({
      ownerUserId: input.userId,
      contract,
      contractSource,
      onboardingJson: input.tasteProfile,
    })
  }

  // RLS_AUDIT: reader_states_owner
  const { error: readerError } = await result(
    db
      .insertInto('reader_states')
      .values({
        user_id: input.userId,
        story_id: input.storyId,
        status: 'BERJALAN',
        current_chapter: 1,
        jejak: [] as unknown as Json,
        ending_name: null,
        route_state: normalizeRouteState({}) as unknown as Json,
        choice_history: [] as unknown as Json,
        locked_ending_key: null,
        updated_at: new Date().toISOString(),
      })
      .execute(),
  )
  if (readerError && (readerError as { code?: string })?.code !== UNIQUE_VIOLATION && !(readerError as { code?: string })?.code?.includes('23505')) {
    throw new PersonalizedStoryError('READER_STATE_FAILED')
  }

  // Branch based on commercial origin
  if (input.commercialOrigin === 'PENDING_PAID_START') {
    // Paid Story #2+: Atomic Bab 1 job creation & request binding
    const { data: queueData, error: queueError } = await single(
      rpcOne(db, 'queue_paid_story_start_generation_v1', {
        p_owner_user_id: input.userId,
        p_story_id: input.storyId,
      }).execute(),
    )

    if (queueError || !queueData) {
      if (queueError) console.error('[runContractAndGeneration] queueError:', queueError)
      throw new PersonalizedStoryError('GENERATION_FAILED')
    }

    const parsedQueue = QueuePaidStartRpcResultSchema.safeParse(queueData?.fn ?? queueData)
    if (!parsedQueue.success || !parsedQueue.data.ok) {
      throw new PersonalizedStoryError('GENERATION_FAILED')
    }

    const jobId = parsedQueue.data.job_id

    // Kick worker via after() and race 25s.
    // jobId is mandatory: commercial path must claim the EXACT queued job,
    // never fall back into legacy generateNextPersonalizedChapter.
    const { nextChapterReady } = await continuePersonalizedGeneration({
      jobId,
      storyId: input.storyId,
      userId: input.userId,
      chapterNumber: 1,
      correlationId: parsedQueue.data.correlation_id || '',
    })

    if (!nextChapterReady) {
      return { pending: true }
    }

    return { pending: false }
  }

  // Starter Story #1 path: synchronous execution
  // RLS_AUDIT: stories_owner_update
  await db
    .updateTable('stories')
    .set({ generation_status: 'generating_chapter' })
    .where('id', '=', input.storyId)
    .where('owner_user_id', '=', input.userId)
    .execute()

  const generated = await generateNextPersonalizedChapter({
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: 1,
    correlationId,
  })
  if (!generated.ok && generated.reason !== 'CHAPTER_EXISTS') {
    throw new PersonalizedStoryError('GENERATION_FAILED')
  }

  await markReady({ userId: input.userId, idempotencyKey: input.idempotencyKey, storyId: input.storyId })
  return { pending: false }
}

export async function createPersonalizedStory(
  input: CreatePersonalizedStoryInput,
): Promise<CreatePersonalizedStoryResult> {
  const userId = UserIdSchema.parse(input.userId)
  const keyParsed = IdempotencyKeySchema.safeParse(input.idempotencyKey)
  if (!keyParsed.success) throw new PersonalizedStoryError('INVALID_IDEMPOTENCY_KEY')
  const idempotencyKey = keyParsed.data

  const tasteProfile = (await getTasteProfileForUser(userId)) ?? createDefaultTasteProfile()
  const requestHash = buildPersonalizedRequestHash({
    userId,
    tasteProfileVersion: tasteProfileVersion(tasteProfile),
  })

  const db = getDb()
  const storyId = `ai:${randomUUID()}`

  // STEP 1: Reserve target in story_creation_requests
  // RLS_AUDIT: story_creation_requests_owner
  const { error: reserveError } = await result(
    db
      .insertInto('story_creation_requests')
      .values({
        owner_user_id: userId,
        request_kind: REQUEST_KIND,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        story_id: storyId,
        status: 'RESERVED',
        error_code: null,
      })
      .execute(),
  )

  if (reserveError && ((reserveError as { code?: string })?.code === UNIQUE_VIOLATION || (reserveError as { code?: string })?.code === '23505' || reserveError.message?.includes('duplicate key') || reserveError.message?.includes('unique constraint'))) {
    return loadExistingReservation({
      userId,
      idempotencyKey,
      requestHash,
      tasteProfile,
    })
  }

  if (reserveError) {
    console.error('[createPersonalizedStory] reserveError:', reserveError)
    throw new PersonalizedStoryError('RESERVATION_FAILED')
  }

  // STEP 2: INSERT cheap owned story shell BEFORE commercial authorization (commercial_origin MUST start NULL)
  const provisional = shellMetadata('Cerita Pribadi', 'Drama personal', [])
  // RLS_AUDIT: stories_owner_insert
  const { error: storyError } = await result(
    db
      .insertInto('stories')
      .values({
        id: storyId,
        title: provisional.title,
        cover: provisional.cover,
        tagline: provisional.tagline,
        role: provisional.role,
        tropes: provisional.tropes as unknown as Json,
        total_chapters: 50,
        synopsis: provisional.synopsis,
        status: 'BARU',
        current_chapter: 0,
        jejak: [] as unknown as Json,
        ending_name: null,
        owner_user_id: userId,
        visibility: 'private',
        story_mode: 'personalized_ai',
        generation_status: 'creating_contract',
        story_contract_version: 1,
      })
      .execute(),
  )

  if (storyError) {
    await markFailed({ userId, idempotencyKey, storyId, errorCode: 'SHELL_FAILED' })
    throw new PersonalizedStoryError('SHELL_FAILED', storyId)
  }

  // STEP 3: Authorize commercial story creation (reads owned story row with initial NULL origin)
  const authRes = await authorizeStoryCreation({ userId, storyId })
  if (!authRes.ok) {
    const casSuccess = await markWaiting({ userId, idempotencyKey, storyId })
    if (!casSuccess) {
      // RLS_AUDIT: story_creation_requests_owner_read
      const { data: latestData } = await single(
        db
          .selectFrom('story_creation_requests')
          .select(['status', 'story_id'])
          .where('owner_user_id', '=', userId)
          .where('request_kind', '=', REQUEST_KIND)
          .where('idempotency_key', '=', idempotencyKey)
          .limit(1)
          .execute(),
      )
      if (latestData?.status === 'READY') {
        return resultFor(storyId, false)
      }
    }
    throw new PersonalizedStoryError('INSUFFICIENT_CREDITS', storyId, authRes.requiredCredits, authRes.availableCredits)
  }

  try {
    const runRes = await runContractAndGeneration({
      userId,
      idempotencyKey,
      storyId,
      tasteProfile,
      commercialOrigin: authRes.origin,
    })

    if (runRes.pending) {
      return { ok: true, storyId, pending: true }
    }
  } catch (error) {
    if (error instanceof PersonalizedStoryError) {
      if (
        error.code === 'INVALID_IDEMPOTENCY_KEY'
        || error.code === 'IDEMPOTENCY_CONFLICT'
        || error.code === 'INSUFFICIENT_CREDITS'
      ) {
        throw error
      }
      await markFailed({ userId, idempotencyKey, storyId, errorCode: error.code })
      throw error
    }
    await markFailed({ userId, idempotencyKey, storyId, errorCode: 'INTERNAL_ERROR' })
    throw new PersonalizedStoryError('INTERNAL_ERROR', storyId)
  }

  return resultFor(storyId, false)
}
