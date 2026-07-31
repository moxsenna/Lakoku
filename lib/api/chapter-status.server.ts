import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
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
 *   1. chapter row exists              → ready
 *   2. process-local capacity gate
 *      queued / active for chapter     → queued | generating (+ soft estimate)
 *   3. active unexpired lease          → generating
 *   4. usable PROSE_READY / CHOICES_* checkpoint → generating
 *      (prose done; preparing choices — same public status for contract compat)
 *   5. latest GENERATION_ATTEMPT REVIEW_REQUIRED or GENERATION_RUNTIME_FAILED
 *      for that chapter → failed
 *      (ignored when step 4 has a usable checkpoint for the same chapter)
 *   6. otherwise                       → failed (dead generation — no perpetual preparing)
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

const ChapterNumberSchema = z.number().int().positive().max(10_000)
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
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chapters')
    .select('number')
    .eq('story_id', storyId)
    .eq('number', chapterNumber)
    .maybeSingle()
  if (error) throw new ChapterStatusError('INTERNAL_ERROR')
  return data != null
}

async function hasActiveLease(storyId: string, chapterNumber: number): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('generation_leases')
    .select('id')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .eq('status', 'ACTIVE')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()
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
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('generation_jobs')
    .select('status, available_at, id, correlation_id, attempt_id')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .in('status', ['QUEUED', 'RUNNING', 'RETRY_WAIT'])
    .order('updated_at', { ascending: false })
    .limit(5)
  if (error) {
    // Missing relation / not deployed → treat as no durable job (legacy path).
    return { kind: 'none' }
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    status?: unknown
    id?: unknown
    correlation_id?: unknown
    attempt_id?: unknown
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
}

async function latestExactFailedAttempt(
  storyId: string,
  chapterNumber: number,
  opts?: { identity?: GenerationAttemptIdentity | null },
): Promise<boolean> {
  const admin = createAdminClient()
  // Indexed path: story_events(story_id, seq). Filter exact chapter + outcome in app.
  // Include both attempt review failures and runtime failures.
  const { data, error } = await admin
    .from('story_events')
    .select('seq, type, payload, created_at')
    .eq('story_id', storyId)
    .in('type', [GENERATION_ATTEMPT_EVENT, GENERATION_RUNTIME_FAILED_EVENT])
    .order('seq', { ascending: false })
    .limit(50)
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

  // Capacity gate may hold the job before a DB lease exists (queued / just acquired).
  const progress = getGenerationProgress(storyId, chapterNumber)
  if (progress) {
    const queue: ChapterStatusQueueHint = {
      position: progress.queuePosition,
      estimatedWaitSeconds: progress.estimatedWaitSeconds,
      phase: progress.phase,
    }
    return {
      status: progress.phase === 'queued' ? 'queued' : 'generating',
      chapterNumber,
      queue,
      progressPhase: 'writing',
      ...identityFields,
    }
  }

  if (await hasActiveLease(storyId, chapterNumber)) {
    return {
      status: 'generating',
      chapterNumber,
      progressPhase: 'writing',
      ...identityFields,
    }
  }

  // P1-3: durable job liveness (worker path). Resolved once and reused below so a
  // CHOICES_RETRY_WAIT checkpoint is only "preparing choices" when a real job is
  // still scheduled — otherwise it is a stalled retry and must surface as failed.
  const jobState = await activeJobState(storyId, chapterNumber, identity)
  // Checkpoint is resumability evidence. It may refine live activity phase, but
  // never replaces requested identity or prove liveness by itself.
  try {
    const admin = createAdminClient()
    const { data: checkpoints } = await admin
      .from('chapter_generation_checkpoints')
      .select('attempt_id, correlation_id, status')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber)
      .in('status', ['PROSE_READY', 'QUEUED_CHOICES', 'RUNNING_CHOICES', 'CHOICES_RETRY_WAIT'])
      .gt('expires_at', new Date().toISOString())
      .order('updated_at', { ascending: false })
      .limit(5)
    const rows = (Array.isArray(checkpoints) ? checkpoints : checkpoints ? [checkpoints] : []) as Array<{
      attempt_id?: unknown
      correlation_id?: unknown
      status?: unknown
    }>
    const cp = identity
      ? rows.find((candidate) => candidate.correlation_id === identity.correlationId
        && (identity.attemptId === null || candidate.attempt_id === identity.attemptId))
      : rows[0]
    if (cp && jobState.kind !== 'none') {
      return {
        status: 'generating',
        chapterNumber,
        ...identityFields,
        progressPhase: 'preparing_choices',
      }
    }
  } catch {
    // best-effort — missing checkpoint table must not break status
  }

  if (jobState.kind === 'running') {
    return {
      status: 'generating',
      chapterNumber,
      progressPhase: 'writing',
      ...identityFields,
    }
  }
  if (jobState.kind === 'queued' || jobState.kind === 'retry_scheduled') {
    // No reusable prose: job is still queued or waiting for its next retry.
    return {
      status: 'queued',
      chapterNumber,
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
