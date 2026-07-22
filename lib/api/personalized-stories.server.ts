import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { selectProvider } from '@lakoku/ai-gateway/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTasteProfileForUser } from '@/lib/api/taste-profile'
import {
  asV1Compat,
  createDefaultTasteProfile,
  type TasteProfile,
} from '@/lib/taste-profile/schema'
import { createResilientStoryContract } from '@/lib/story-engine/contract-generation.server'
import { persistContractAndCanon } from '@/lib/story-engine/contract-persistence.server'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { generateNextPersonalizedChapter } from '@/lib/runtime/personalized-generation'
import { createSynchronousProviderContext } from '@/lib/runtime/generation-provider-context'

const UNIQUE_VIOLATION = '23505'
const REQUEST_KIND = 'personalized' as const

const IdempotencyKeySchema = z.string().trim().min(1).max(240).regex(/^[\x21-\x7E]+$/)
const UserIdSchema = z.string().uuid()

const CreationRequestRowSchema = z.object({
  story_id: z.string().min(1),
  request_hash: z.string().min(1),
  status: z.enum(['RESERVED', 'READY', 'FAILED']),
}).strict()

export type PersonalizedStoryErrorCode =
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_USER'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RESERVATION_FAILED'
  | 'SHELL_FAILED'
  | 'CONTRACT_FAILED'
  | 'READER_STATE_FAILED'
  | 'GENERATION_FAILED'
  | 'INTERNAL_ERROR'

export class PersonalizedStoryError extends Error {
  constructor(public readonly code: PersonalizedStoryErrorCode) {
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

function redirectUrlFor(storyId: string): string {
  return `/baca/${encodeURIComponent(storyId)}?bab=1`
}

function resultFor(storyId: string, replayed: boolean): CreatePersonalizedStoryResult {
  return {
    storyId,
    redirectUrl: redirectUrlFor(storyId),
    replayed,
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
      kind: REQUEST_KIND,
      userId: input.userId,
      tasteProfileVersion: input.tasteProfileVersion,
    }))
    .digest('hex')
}

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

async function markFailed(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  storyId: string
  errorCode: PersonalizedStoryErrorCode
}): Promise<void> {
  const now = new Date().toISOString()
  await input.admin
    .from('stories')
    .update({ generation_status: 'failed' })
    .eq('id', input.storyId)
    .eq('owner_user_id', input.userId)

  await input.admin
    .from('story_creation_requests')
    .update({
      status: 'FAILED',
      error_code: input.errorCode,
      updated_at: now,
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
  const now = new Date().toISOString()
  const { error: storyError } = await input.admin
    .from('stories')
    .update({ generation_status: 'ready' })
    .eq('id', input.storyId)
    .eq('owner_user_id', input.userId)
  if (storyError) throw new PersonalizedStoryError('INTERNAL_ERROR')

  const { error: requestError } = await input.admin
    .from('story_creation_requests')
    .update({
      status: 'READY',
      error_code: null,
      updated_at: now,
    })
    .eq('owner_user_id', input.userId)
    .eq('request_kind', REQUEST_KIND)
    .eq('idempotency_key', input.idempotencyKey)
  if (requestError) throw new PersonalizedStoryError('INTERNAL_ERROR')
}

async function loadExistingReservation(input: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  idempotencyKey: string
  requestHash: string
}): Promise<CreatePersonalizedStoryResult> {
  const { data, error } = await input.admin
    .from('story_creation_requests')
    .select('story_id,request_hash,status')
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
  return resultFor(row.data.story_id, true)
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
  const correlationId = randomUUID()

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

  if (reserveError) {
    if (reserveError.code === UNIQUE_VIOLATION) {
      return loadExistingReservation({
        admin,
        userId,
        idempotencyKey,
        requestHash,
      })
    }
    throw new PersonalizedStoryError('RESERVATION_FAILED')
  }

  // Temporary shell fields; title/tagline/synopsis refined after contract generation.
  const provisional = shellMetadata('Cerita Pribadi', 'Drama personal', [])
  const { error: shellError } = await admin.from('stories').insert({
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
  if (shellError) {
    await markFailed({
      admin,
      userId,
      idempotencyKey,
      storyId,
      errorCode: 'SHELL_FAILED',
    })
    throw new PersonalizedStoryError('SHELL_FAILED')
  }

  try {
    const contractProviderContext = createSynchronousProviderContext({
      userId,
      storyId,
      chapterNumber: null,
      generationKind: 'personalized',
      correlationId,
    })
    const provider = await selectProvider(contractProviderContext)
    const { contract, contractSource } = await createResilientStoryContract({
      storyId,
      tasteJson: tasteProfile,
      provider,
      telemetryContext: contractProviderContext,
    })

    const meta = shellMetadata(
      contract.title,
      contract.genre,
      asV1Compat(tasteProfile).likedTropes ?? [],
    )
    await admin
      .from('stories')
      .update({
        title: meta.title,
        tagline: meta.tagline,
        synopsis: meta.synopsis,
        tropes: meta.tropes,
        generation_status: 'creating_contract',
      })
      .eq('id', storyId)
      .eq('owner_user_id', userId)

    await persistContractAndCanon({
      ownerUserId: userId,
      contract,
      contractSource,
      onboardingJson: tasteProfile,
    })

    const { error: readerError } = await admin.from('reader_states').insert({
      user_id: userId,
      story_id: storyId,
      status: 'BERJALAN',
      current_chapter: 1,
      jejak: [],
      ending_name: null,
      route_state: normalizeRouteState({}),
      choice_history: [],
      locked_ending_key: null,
      updated_at: new Date().toISOString(),
    })
    if (readerError) throw new PersonalizedStoryError('READER_STATE_FAILED')

    await admin
      .from('stories')
      .update({ generation_status: 'generating_chapter' })
      .eq('id', storyId)
      .eq('owner_user_id', userId)

    const generated = await generateNextPersonalizedChapter({
      storyId,
      userId,
      chapterNumber: 1,
      correlationId,
    })
    if (!generated.ok && generated.reason !== 'CHAPTER_EXISTS') {
      throw new PersonalizedStoryError('GENERATION_FAILED')
    }

    await markReady({ admin, userId, idempotencyKey, storyId })
    return resultFor(storyId, false)
  } catch (error) {
    // Pre-write / conflict errors must not mutate an existing valid reservation.
    if (error instanceof PersonalizedStoryError) {
      if (
        error.code === 'INVALID_IDEMPOTENCY_KEY'
        || error.code === 'INVALID_USER'
        || error.code === 'IDEMPOTENCY_CONFLICT'
      ) {
        throw error
      }
      await markFailed({
        admin,
        userId,
        idempotencyKey,
        storyId,
        errorCode: error.code,
      })
      throw error
    }

    await markFailed({
      admin,
      userId,
      idempotencyKey,
      storyId,
      errorCode: 'INTERNAL_ERROR',
    })
    throw new PersonalizedStoryError('INTERNAL_ERROR')
  }
}
