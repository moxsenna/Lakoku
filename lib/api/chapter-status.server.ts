import 'server-only'
import { z } from 'zod'
import { getDb, result, single } from '@lakoku/db'
import { queryStoryForUser } from '@/lib/api/queries'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { GENERATION_ATTEMPT_EVENT } from '@/lib/observability/telemetry'
import { GENERATION_RUNTIME_FAILED_EVENT } from '@/lib/observability/generation-stages'
import { getGenerationProgress } from '@/lib/runtime/generation-concurrency'
import {
  GenerationAttemptIdentitySchema,
  type GenerationAttemptIdentity,
} from '../../packages/contracts/src/reader'

/**
 * Exact per-chapter generation status for personalized reader polling (Task 21).
 *
 * Precedence (exact chapter only):
 *   1. chapter row exists                         → ready
 *   2. matching durable RUNNING job               → generating
 *   3. matching durable QUEUED / RETRY_WAIT job   → queued
 *   4. active lease or process-local slot         → queued | generating
 *   5. matching terminal event                    → failed
 *   6. otherwise                                  → failed
 *
 * A matching reusable checkpoint refines live work to preparing_choices. It is
 * resumability evidence only and never proves liveness by itself.
 *
 * Never consults stories.generation_status as chapter truth.
 * Public contract statuses remain: ready | queued | generating | failed.
 * Reader-facing copy for generating may say "menyiapkan pilihan" when checkpoint exists.
 */

export type PersonalizedChapterStatus = 'ready' | 'queued' | 'generating' | 'failed'

export type ChapterStatusQueueHint = {
  position: number | null
  estimatedWaitSeconds: number
  phase: 'queued' | 'active'
}

export type ChapterStatusResult = {
  status: PersonalizedChapterStatus
  chapterNumber: number
  queue?: ChapterStatusQueueHint
  attemptId?: string | null
  correlationId?: string
  /**
   * Soft phase for UI copy only. Not part of strict public schema unless
   * clients opt in; route currently omits this field to keep contract strict.
   */
  progressPhase?: 'writing' | 'preparing_choices'
}

export type ChapterStatusErrorCode =
  | 'INVALID_CHAPTER'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

export class ChapterStatusError extends Error {
  constructor(public readonly code: ChapterStatusErrorCode) {
    super(code)
    this.name = 'ChapterStatusError'
  }
}

const ChapterNumberSchema = z.number().int().positive().max(50)
const UserIdSchema = z.string().uuid().nullable()

interface GenerationAttemptPayload {
  chapter_number?: unknown
  chapter?: unknown
  outcome?: unknown
}

function chapterFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as GenerationAttemptPayload
  const raw = p.chapter_number ?? p.chapter
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0) return n
  }
  return null
}

function isReviewRequiredOutcome(outcome: unknown): boolean {
  return outcome === 'REVIEW_REQUIRED' || outcome === 'FAILED_REVIEW_REQUIRED'
}

async function chapterExists(storyId: string, chapterNumber: number): Promise<boolean> {
  const db = getDb()
  // RLS_AUDIT: chapters_public_read
  const { data, error } = await single(
    db
      .selectFrom('chapters')
      .select('number')
      .where('story_id', '=', storyId)
      .where('number', '=', chapterNumber)
      .limit(1)
      .execute(),
  )
  if (error) throw new ChapterStatusError('INTERNAL_ERROR')
  return data != null
}

async function hasActiveLease(storyId: string, chapterNumber: number): Promise<boolean> {
  const db = getDb()
  // RLS_AUDIT: generation_leases_service_only
  const { data, error } = await single(
    db
      .selectFrom('generation_leases')
      .select('id')
      .where('story_id', '=', storyId)
      .where('chapter_number', '=', chapterNumber)
      .where('status', '=', 'ACTIVE')
      .where('expires_at', '>', new Date())
      .limit(1)
      .execute(),
  )
  if (error) throw new ChapterStatusError('INTERNAL_ERROR')
  return data != null
}

type ActiveJobState =
  | { kind: 'none' }
  | { kind: 'running' }
  | { kind: 'queued' }
  | { kind: 'retry_scheduled' }

/**
 * P1-3: job-aware liveness. A durable job in QUEUED/RUNNING/RETRY_WAIT means the
 * chapter is genuinely in flight or scheduled — even a RETRY_WAIT whose
 * available_at is in the future counts as "queued" (retry scheduled), NOT idle.
 * Missing table (worker path never deployed) → { kind: 'none' } (fall through).
 */
async function activeJobState(
  storyId: string,
  chapterNumber: number,
  identity?: GenerationAttemptIdentity | null,
): Promise<ActiveJobState> {
  try {
    const db = getDb()
    // RLS_AUDIT: generation_jobs_service_only
    const { data, error } = await result(
      db
        .selectFrom('generation_jobs')
        .select(['status', 'available_at', 'id', 'correlation_id'])
        .where('story_id', '=', storyId)
        .where('chapter_number', '=', chapterNumber)
        .where('generation_kind', 'in', ['personalized', 'standard'])
        .where('status', 'in', ['QUEUED', 'RUNNING', 'RETRY_WAIT'])
        .orderBy('updated_at', 'desc')
        .limit(5)
        .execute(),
    )
    if (error) {
      // Missing relation / not deployed → treat as no durable job (legacy path).
      return { kind: 'none' }
    }
    const rows = (data ?? []) as Array<{
      status?: unknown
      id?: unknown
      correlation_id?: unknown
    }>
    const row = identity
      ? rows.find((candidate) => candidate.correlation_id === identity.correlationId
        && (identity.attemptId === null || candidate.id === identity.attemptId))
      : rows[0]
    if (!row) return { kind: 'none' }
    const status = String(row.status ?? '')
    if (status === 'RUNNING') return { kind: 'running' }
    if (status === 'QUEUED') return { kind: 'queued' }
    if (status === 'RETRY_WAIT') {
      // Future available_at still counts as an active (scheduled) job.
      return { kind: 'retry_scheduled' }
    }
    return { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

async function latestExactFailedAttempt(
  storyId: string,
  chapterNumber: number,
  opts?: { identity?: GenerationAttemptIdentity | null },
): Promise<boolean> {
  const db = getDb()
  // RLS_AUDIT: story_events_service_only
  const { data, error } = await result(
    db
      .selectFrom('story_events')
      .select(['seq', 'type', 'payload', 'created_at'])
      .where('story_id', '=', storyId)
      .where('type', 'in', [GENERATION_ATTEMPT_EVENT, GENERATION_RUNTIME_FAILED_EVENT])
      .orderBy('seq', 'desc')
      .limit(50)
      .execute(),
  )
  if (error) throw new ChapterStatusError('INTERNAL_ERROR')

  const identity = opts?.identity ?? null

  for (const row of data ?? []) {
    const typed = row as { type?: string; payload?: unknown }
    const payload = typed.payload
    const chapter = chapterFromPayload(payload)
    if (chapter !== chapterNumber) continue

    if (identity) {
      if (!payload || typeof payload !== 'object') continue
      const p = payload as { correlation_id?: unknown; attempt_id?: unknown }
      if (p.correlation_id !== identity.correlationId) continue
      if (identity.attemptId !== null && p.attempt_id !== identity.attemptId) continue
    }

    if (typed.type === GENERATION_RUNTIME_FAILED_EVENT) return true

    const outcome = payload && typeof payload === 'object'
      ? (payload as GenerationAttemptPayload).outcome
      : undefined
    if (isReviewRequiredOutcome(outcome)) return true
    // Latest exact attempt for this chapter is not a failure (e.g. PUBLISHED).
    return false
  }
  return false
}

/**
 * Resolve exact personalized chapter status for an authorized user.
 * `userId` null = anonymous; private stories deny.
 */
export async function getChapterStatusForUser(input: {
  userId: string | null
  storyId: string
  chapterNumber: number
  identity?: GenerationAttemptIdentity | null
}): Promise<ChapterStatusResult> {
  const userId = UserIdSchema.parse(input.userId)
  const chapterNumber = ChapterNumberSchema.parse(input.chapterNumber)
  const storyId = normalizeStoryRouteId(input.storyId)
  const identity = input.identity == null ? null : GenerationAttemptIdentitySchema.parse(input.identity)
  const requestedIdentity = identity
  const identityFields = requestedIdentity ? {
    attemptId: requestedIdentity.attemptId,
    correlationId: requestedIdentity.correlationId,
  } : {}

  // Authorize parent story first (public or exact owner). Never query generation_status.
  const story = await queryStoryForUser(storyId, userId)
  if (!story) throw new ChapterStatusError('NOT_FOUND')

  if (await chapterExists(storyId, chapterNumber)) {
    return { status: 'ready', chapterNumber, ...identityFields }
  }

  const jobState = await activeJobState(storyId, chapterNumber, identity)
  const progress = getGenerationProgress(storyId, chapterNumber)
  const activeLease = await hasActiveLease(storyId, chapterNumber)

  // Checkpoint is resumability evidence. It may refine live activity phase, but
  // never replaces requested identity or proves liveness by itself.
  let hasMatchingCheckpoint = false
  try {
    const db = getDb()
    // RLS_AUDIT: chapter_generation_checkpoints_service_only
    const { data: checkpoints } = await result(
      db
        .selectFrom('chapter_generation_checkpoints')
        .select(['attempt_id', 'correlation_id', 'status'])
        .where('story_id', '=', storyId)
        .where('chapter_number', '=', chapterNumber)
        .where('status', 'in', ['PROSE_READY', 'QUEUED_CHOICES', 'RUNNING_CHOICES', 'CHOICES_RETRY_WAIT'])
        .where('expires_at', '>', new Date())
        .orderBy('updated_at', 'desc')
        .limit(5)
        .execute(),
    )
    const rows = (checkpoints ?? []) as Array<{
      attempt_id?: unknown
      correlation_id?: unknown
    }>
    hasMatchingCheckpoint = identity
      ? rows.some((candidate) => candidate.correlation_id === identity.correlationId
        && (identity.attemptId === null || candidate.attempt_id === identity.attemptId))
      : rows.length > 0
  } catch {
    // best-effort — missing checkpoint table must not break status
  }

  if (jobState.kind === 'running') {
    return {
      status: 'generating',
      chapterNumber,
      progressPhase: hasMatchingCheckpoint ? 'preparing_choices' : 'writing',
      ...identityFields,
    }
  }
  if (jobState.kind === 'queued' || jobState.kind === 'retry_scheduled') {
    return {
      status: 'queued',
      chapterNumber,
      ...(hasMatchingCheckpoint ? { progressPhase: 'preparing_choices' as const } : {}),
      ...identityFields,
    }
  }

  if (progress || activeLease) {
    const queue = progress ? {
      position: progress.queuePosition,
      estimatedWaitSeconds: progress.estimatedWaitSeconds,
      phase: progress.phase,
    } satisfies ChapterStatusQueueHint : undefined
    return {
      status: progress?.phase === 'queued' ? 'queued' : 'generating',
      chapterNumber,
      ...(queue ? { queue } : {}),
      progressPhase: hasMatchingCheckpoint ? 'preparing_choices' : 'writing',
      ...identityFields,
    }
  }

  if (await latestExactFailedAttempt(storyId, chapterNumber, { identity })) {
    return { status: 'failed', chapterNumber, ...identityFields }
  }
  // No chapter + no live lease / queue ticket: generation died (timeout/kill) or never started.
  // Do NOT report perpetual "generating" — that traps the reader UI forever.
  return { status: 'failed', chapterNumber, ...identityFields }
}
