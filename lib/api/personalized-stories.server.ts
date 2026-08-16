import 'server-only'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
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
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId?: string
  errorCode: string
}): Promise<void> {
  try {
    await input.admin
      .from('story_creation_requests')
      .update({
        status: 'FAILED',
        error_code: input.errorCode,
        updated_at: new Date().toISOString(),
      })
      .eq('owner_user_id', input.userId)
      .eq('request_kind', REQUEST_KIND)
      .eq('idempotency_key', input.idempotencyKey)

    if (input.storyId) {
      await input.admin
        .from('stories')
        .update({
          generation_status: 'failed',
        })
        .eq('id', input.storyId)
        .eq('owner_user_id', input.userId)
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
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId?: string
}): Promise<boolean> {
  const { data, error } = await input.admin
    .from('story_creation_requests')
    .update({
      status: 'WAITING_FOR_CREDITS',
      error_code: 'INSUFFICIENT_CREDITS',
      updated_at: new Date().toISOString(),
    })
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)
    .eq('status', 'RESERVED')
    .is('generation_job_id', null)
    .select('status')

  if (error) return false
  return (data?.length ?? 0) > 0
}

async function markReady(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId: string
}): Promise<void> {
  const { error: storyError } = await input.admin
    .from('stories')
    .update({
      generation_status: 'ready',
    })
    .eq('id', input.storyId)
    .eq('owner_user_id', input.userId)

  if (storyError) {
    throw new PersonalizedStoryError('MARK_READY_FAILED', input.storyId)
  }

  const { error: requestError } = await input.admin
    .from('story_creation_requests')
    .update({
      status: 'READY',
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)

  if (requestError) {
    throw new PersonalizedStoryError('MARK_READY_FAILED', input.storyId)
  }
}

export async function verifyDurableStarterProof(input: {
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

export async function authorizeStoryCreation(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  storyId: string
}): Promise<
  | { ok: true; origin: 'STARTER_FREE' | 'PENDING_PAID_START' }
  | { ok: false; error: 'INSUFFICIENT_CREDITS'; requiredCredits: number; availableCredits: number }
> {
  const { data: accountState, error: accountErr } = await input.admin
    .from('account_commercial_states')
    .select('starter_story_id, starter_claimed_at')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (accountErr) {
    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  const hasClaimedStarter = Boolean(
    accountState?.starter_claimed_at && accountState?.starter_story_id && accountState.starter_story_id !== input.storyId
  )

  if (!hasClaimedStarter) {
    const { data: claimData, error: claimErr } = await input.admin.rpc('claim_starter_story_v1', {
      p_user_id: input.userId,
      p_story_id: input.storyId,
    })

    if (!claimErr && claimData) {
      const parsed = ClaimStarterRpcResultSchema.safeParse(claimData)
      if (parsed.success && parsed.data.claimed) {
        await input.admin.rpc('grant_welcome_credit_v1', { p_user_id: input.userId }).then(() => null, () => null)
        return { ok: true, origin: 'STARTER_FREE' }
      }
    }

    const isDurableReplay = await verifyDurableStarterProof({ admin: input.admin, userId: input.userId, storyId: input.storyId })
    if (isDurableReplay) {
      return { ok: true, origin: 'STARTER_FREE' }
    }

    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  const { data: resData, error: resError } = await input.admin.rpc('reserve_story_start_v1', {
    p_user_id: input.userId,
    p_story_id: input.storyId,
  })

  if (resError || !resData) {
    if (resError) console.error('[authorizeStoryCreation] resError:', resError)
    throw new PersonalizedStoryError('INTERNAL_ERROR', input.storyId)
  }

  const parsedRes = ReserveStartRpcResultSchema.safeParse(resData)
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
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  requestHash: string
  tasteProfile: TasteProfile
}): Promise<CreatePersonalizedStoryResult> {
  const { data, error } = await input.admin
    .from('story_creation_requests')
    .select('story_id,request_hash,status,error_code,generation_job_id')
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()

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
      admin: input.admin,
      userId: input.userId,
      storyId: existingStoryId,
    })

    if (!authRes.ok) {
      const casSuccess = await markWaiting({ admin: input.admin, userId: input.userId, idempotencyKey: input.idempotencyKey, storyId: existingStoryId })
      if (!casSuccess) {
        // Re-read authoritative request state
        const { data: latestData } = await input.admin
          .from('story_creation_requests')
          .select('status,story_id')
          .eq('owner_user_id', input.userId)
          .eq('request_kind', REQUEST_KIND)
          .eq('idempotency_key', input.idempotencyKey)
          .maybeSingle()
        if (latestData?.status === 'READY') {
          return resultFor(existingStoryId, true)
        }
      }
      throw new PersonalizedStoryError('INSUFFICIENT_CREDITS', existingStoryId, authRes.requiredCredits, authRes.availableCredits)
    }

    const runRes = await runContractAndGeneration({
      admin: input.admin,
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
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId: string
  tasteProfile: TasteProfile
  commercialOrigin: string
}): Promise<{ pending?: boolean }> {
  const correlationId = randomUUID()

  // Inspect if story_generation_contracts already exists
  const { data: existingContract } = await input.admin
    .from('story_generation_contracts')
    .select('story_id')
    .eq('story_id', input.storyId)
    .maybeSingle()

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
    await input.admin
      .from('stories')
      .update({
        title: meta.title,
        tagline: meta.tagline,
        synopsis: meta.synopsis,
        tropes: meta.tropes,
        generation_status: 'creating_contract',
      })
      .eq('id', input.storyId)
      .eq('owner_user_id', input.userId)

    await persistContractAndCanon({
      ownerUserId: input.userId,
      contract,
      contractSource,
      onboardingJson: input.tasteProfile,
    })
  }

  const { error: readerError } = await input.admin.from('reader_states').insert({
    user_id: input.userId,
    story_id: input.storyId,
    status: 'BERJALAN',
    current_chapter: 1,
    jejak: [],
    ending_name: null,
    route_state: normalizeRouteState({}),
    choice_history: [],
    locked_ending_key: null,
    updated_at: new Date().toISOString(),
  })
  if (readerError && readerError.code !== UNIQUE_VIOLATION) {
    throw new PersonalizedStoryError('READER_STATE_FAILED')
  }

  // Branch based on commercial origin
  if (input.commercialOrigin === 'PENDING_PAID_START') {
    // Paid Story #2+: Atomic Bab 1 job creation & request binding
    const { data: queueData, error: queueError } = await input.admin.rpc('queue_paid_story_start_generation_v1', {
      p_owner_user_id: input.userId,
      p_story_id: input.storyId,
    })

    if (queueError || !queueData) {
      if (queueError) console.error('[runContractAndGeneration] queueError:', queueError)
      throw new PersonalizedStoryError('GENERATION_FAILED')
    }

    const parsedQueue = QueuePaidStartRpcResultSchema.safeParse(queueData)
    if (!parsedQueue.success || !parsedQueue.data.ok) {
      throw new PersonalizedStoryError('GENERATION_FAILED')
    }

    const jobId = parsedQueue.data.job_id

    // Kick worker via after() and race 25s
    const { nextChapterReady } = await continuePersonalizedGeneration({
      jobId,
      storyId: input.storyId,
      userId: input.userId,
      chapterNumber: 1,
    })

    if (!nextChapterReady) {
      return { pending: true }
    }

    return { pending: false }
  }

  // Starter Story #1 path: synchronous execution
  await input.admin
    .from('stories')
    .update({ generation_status: 'generating_chapter' })
    .eq('id', input.storyId)
    .eq('owner_user_id', input.userId)

  const generated = await generateNextPersonalizedChapter({
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: 1,
    correlationId,
  })
  if (!generated.ok && generated.reason !== 'CHAPTER_EXISTS') {
    throw new PersonalizedStoryError('GENERATION_FAILED')
  }

  await markReady({ admin: input.admin, userId: input.userId, idempotencyKey: input.idempotencyKey, storyId: input.storyId })
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

  const admin = createAdminClient()
  const storyId = `ai:${randomUUID()}`

  // STEP 1: Reserve target in story_creation_requests
  const { error: reserveError } = await admin
    .from('story_creation_requests')
    .insert({
      owner_user_id: userId,
      request_kind: REQUEST_KIND,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      story_id: storyId,
      status: 'RESERVED',
      error_code: null,
    })

  if (reserveError && reserveError.code === UNIQUE_VIOLATION) {
    return loadExistingReservation({
      admin,
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
  const { error: storyError } = await admin.from('stories').insert({
    id: storyId,
    title: provisional.title,
    cover: provisional.cover,
    tagline: provisional.tagline,
    role: provisional.role,
    tropes: provisional.tropes,
    total_chapters: 50,
    synopsis: provisional.synopsis,
    status: 'BARU',
    current_chapter: 0,
    jejak: [],
    ending_name: null,
    owner_user_id: userId,
    visibility: 'private',
    story_mode: 'personalized_ai',
    generation_status: 'creating_contract',
    story_contract_version: 1,
  })

  if (storyError) {
    await markFailed({ admin, userId, idempotencyKey, storyId, errorCode: 'SHELL_FAILED' })
    throw new PersonalizedStoryError('SHELL_FAILED', storyId)
  }

  // STEP 3: Authorize commercial story creation (reads owned story row with initial NULL origin)
  const authRes = await authorizeStoryCreation({ admin, userId, storyId })
  if (!authRes.ok) {
    const casSuccess = await markWaiting({ admin, userId, idempotencyKey, storyId })
    if (!casSuccess) {
      const { data: latestData } = await admin
        .from('story_creation_requests')
        .select('status,story_id')
        .eq('owner_user_id', userId)
        .eq('request_kind', REQUEST_KIND)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (latestData?.status === 'READY') {
        return resultFor(storyId, false)
      }
    }
    throw new PersonalizedStoryError('INSUFFICIENT_CREDITS', storyId, authRes.requiredCredits, authRes.availableCredits)
  }

  try {
    const runRes = await runContractAndGeneration({
      admin,
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
      await markFailed({ admin, userId, idempotencyKey, storyId, errorCode: error.code })
      throw error
    }
    await markFailed({ admin, userId, idempotencyKey, storyId, errorCode: 'INTERNAL_ERROR' })
    throw new PersonalizedStoryError('INTERNAL_ERROR', storyId)
  }

  return resultFor(storyId, false)
}
