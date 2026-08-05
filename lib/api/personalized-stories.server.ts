import { createHash, randomUUID } from 'crypto'
import 'server-only'
import { z } from 'zod'
import { selectProvider } from '@lakoku/ai-gateway/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createResilientStoryContract } from '@/lib/story-engine/contract-generation.server'
import { persistContractAndCanon } from '@/lib/story-engine/contract-persistence.server'
import { getTasteProfileForUser } from '@/lib/api/taste-profile'
import { createDefaultTasteProfile, asV1Compat, type TasteProfile } from '@/lib/taste-profile/schema'
import { generateNextPersonalizedChapter } from '@/lib/runtime/personalized-generation'
import { createSynchronousProviderContext } from '@/lib/runtime/generation-provider-context'
import { normalizeRouteState } from '@/lib/story-engine/route-state'

const REQUEST_KIND = 'personalized'
const UNIQUE_VIOLATION = '23505'

const IdempotencyKeySchema = z.string().trim().min(1).max(240).regex(/^[\x21-\x7E]+$/)
const UserIdSchema = z.string().uuid()

const CreationRequestRowSchema = z.object({
  story_id: z.string().min(1),
  request_hash: z.string().min(1),
  status: z.enum(['RESERVED', 'READY', 'FAILED', 'WAITING_FOR_CREDITS']),
  error_code: z.string().nullable().optional(),
}).strict()

function shellMetadata(contractTitle: string, contractGenre: string, tropes: string[]) {
  return {
    title: contractTitle || 'Cerita Pribadi',
    cover: '/covers/default-personalized.webp',
    tagline: contractGenre ? `Kisah ${contractGenre} interaktif.` : 'Cerita personal sedang disiapkan...',
    role: 'Pemeran Utama',
    tropes: Array.isArray(tropes) ? tropes.slice(0, 5) : [],
    synopsis: 'Kisah interaktif yang dibuat khusus berdasarkan pilihan dan selera Anda.',
  }
}

export function tasteProfileVersion(profile: TasteProfile): number {
  return profile.version ?? 2
}

export function buildPersonalizedRequestHash(input: {
  userId: string
  tasteProfileVersion: number
}): string {
  const payload = JSON.stringify({
    kind: REQUEST_KIND,
    userId: input.userId,
    tasteProfileVersion: input.tasteProfileVersion,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export type PersonalizedStoryErrorCode =
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_USER'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RESERVATION_FAILED'
  | 'SHELL_FAILED'
  | 'CONTRACT_FAILED'
  | 'READER_STATE_FAILED'
  | 'GENERATION_FAILED'
  | 'INSUFFICIENT_CREDITS'
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

export interface CreatePersonalizedStoryResult {
  storyId: string
  redirectUrl: string
  replayed: boolean
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
  errorCode: PersonalizedStoryErrorCode
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
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.storyId)
        .eq('owner_user_id', input.userId)
    }
  } catch {
    // Ignore update failures during error reporting so original error is preserved
  }
}

async function markWaiting(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId?: string
}): Promise<void> {
  await input.admin
    .from('story_creation_requests')
    .update({
      status: 'WAITING_FOR_CREDITS',
      error_code: 'INSUFFICIENT_CREDITS',
      updated_at: new Date().toISOString(),
    })
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)
}

async function markReady(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId: string
}): Promise<void> {
  await input.admin
    .from('story_creation_requests')
    .update({
      status: 'READY',
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)

  await input.admin
    .from('stories')
    .update({
      generation_status: 'ready',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.storyId)
    .eq('owner_user_id', input.userId)
}

async function authorizeStoryCreation(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  storyId: string
}): Promise<
  | { ok: true; origin: string }
  | { ok: false; error: 'INSUFFICIENT_CREDITS'; requiredCredits: number; availableCredits: number }
> {
  // Check lifetime starter entitlement
  const { data: accountState } = await input.admin
    .from('account_commercial_states')
    .select('starter_story_id, starter_claimed_at')
    .eq('user_id', input.userId)
    .maybeSingle()

  const hasClaimedStarter = Boolean(accountState?.starter_claimed_at || accountState?.starter_story_id)

  if (!hasClaimedStarter) {
    if (typeof input.admin.rpc === 'function') {
      const { data, error } = await input.admin.rpc('claim_starter_story_v1', {
        p_user_id: input.userId,
        p_story_id: input.storyId,
      })
      if (!error && data && typeof data === 'object' && 'claimed' in data && data.claimed) {
        await input.admin.rpc('grant_welcome_credit_v1', { p_user_id: input.userId }).then(() => null, () => null)
        return { ok: true, origin: 'STARTER_FREE' }
      }

      const { data: reCheckState } = await input.admin
        .from('account_commercial_states')
        .select('starter_story_id')
        .eq('user_id', input.userId)
        .maybeSingle()

      if (reCheckState?.starter_story_id === input.storyId || !reCheckState?.starter_story_id) {
        return { ok: true, origin: 'STARTER_FREE' }
      }
    } else {
      return { ok: true, origin: 'STARTER_FREE' }
    }
  }

  // Story #2+ require reserve_story_start_v1
  if (typeof input.admin.rpc === 'function') {
    const { data: resData, error: resError } = await input.admin.rpc('reserve_story_start_v1', {
      p_user_id: input.userId,
      p_story_id: input.storyId,
    })

    if (resError) {
      throw new PersonalizedStoryError('INTERNAL_ERROR')
    }

    if (resData && typeof resData === 'object') {
      if ('reason' in resData && resData.reason === 'INSUFFICIENT_CREDITS') {
        return {
          ok: false,
          error: 'INSUFFICIENT_CREDITS',
          requiredCredits: Number(resData.required ?? 24),
          availableCredits: Number(resData.available ?? 0),
        }
      }
      if ('ok' in resData && resData.ok === true) {
        return { ok: true, origin: 'PENDING_PAID_START' }
      }
    }
    throw new PersonalizedStoryError('INTERNAL_ERROR')
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
    .select('story_id,request_hash,status,error_code')
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
    // Retry commercial authorization
    const authRes = await authorizeStoryCreation({
      admin: input.admin,
      userId: input.userId,
      storyId: existingStoryId,
    })

    if (!authRes.ok) {
      await markWaiting({ admin: input.admin, userId: input.userId, idempotencyKey: input.idempotencyKey, storyId: existingStoryId })
      throw new PersonalizedStoryError('INSUFFICIENT_CREDITS', existingStoryId, authRes.requiredCredits, authRes.availableCredits)
    }

    // Transition back to RESERVED and continue contract generation / Bab 1 kickoff
    await input.admin
      .from('story_creation_requests')
      .update({ status: 'RESERVED', error_code: null, updated_at: new Date().toISOString() })
      .eq('owner_user_id', input.userId)
      .eq('request_kind', REQUEST_KIND)
      .eq('idempotency_key', input.idempotencyKey)

    await runContractAndGeneration({
      admin: input.admin,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      storyId: existingStoryId,
      tasteProfile: input.tasteProfile,
      commercialOrigin: authRes.origin,
    })

    return resultFor(existingStoryId, true)
  }

  throw new PersonalizedStoryError('RESERVATION_FAILED')
}

async function runContractAndGeneration(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId: string
  tasteProfile: TasteProfile
  commercialOrigin: string
}): Promise<void> {
  // CRITICAL FAIL-CLOSED GUARD: Check commercial origin AT THE VERY TOP before provider work
  if (input.commercialOrigin === 'PENDING_PAID_START') {
    // Paid Story #2+ MUST stop BEFORE provider calls until Phase 2B V5 exists
    throw new PersonalizedStoryError('COMMERCIAL_RUNTIME_NOT_READY', input.storyId)
  }

  const correlationId = randomUUID()

  // Inspect if story_generation_contracts already exists (Item 15 crash-resume optimization)
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
    throw new PersonalizedStoryError('RESERVATION_FAILED')
  }

  // Authorize commercial story creation
  const authRes = await authorizeStoryCreation({ admin, userId, storyId })
  if (!authRes.ok) {
    await markWaiting({ admin, userId, idempotencyKey, storyId })
    throw new PersonalizedStoryError('INSUFFICIENT_CREDITS', storyId, authRes.requiredCredits, authRes.availableCredits)
  }

  // Create story shell in DB
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
    owner_user_id: userId,
    visibility: 'private',
    story_mode: 'personalized_ai',
    commercial_origin: authRes.origin,
    generation_status: 'creating_contract',
  })

  if (storyError) {
    await markFailed({ admin, userId, idempotencyKey, storyId, errorCode: 'SHELL_FAILED' })
    throw new PersonalizedStoryError('SHELL_FAILED', storyId)
  }

  try {
    await runContractAndGeneration({
      admin,
      userId,
      idempotencyKey,
      storyId,
      tasteProfile,
      commercialOrigin: authRes.origin,
    })
  } catch (error) {
    if (error instanceof PersonalizedStoryError) {
      if (error.code === 'COMMERCIAL_RUNTIME_NOT_READY') {
        // Do NOT mark failed; request remains in RESERVED / WAITING_FOR_CREDITS so it stays cleanly resumable for Phase 2B!
        throw error
      }
      if (error.code === 'CONTRACT_FAILED' || error.code === 'READER_STATE_FAILED' || error.code === 'GENERATION_FAILED') {
        await markFailed({ admin, userId, idempotencyKey, storyId, errorCode: error.code })
        throw error
      }
      throw error
    }
    await markFailed({ admin, userId, idempotencyKey, storyId, errorCode: 'INTERNAL_ERROR' })
    throw new PersonalizedStoryError('INTERNAL_ERROR', storyId)
  }

  return resultFor(storyId, false)
}
