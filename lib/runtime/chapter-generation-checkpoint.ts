/**
 * Durable prose checkpoint persistence (PROSE_READY).
 * Service/worker only — never expose draft prose via Reader API.
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import {
  defaultCheckpointExpiry,
  draftFromCheckpoint,
  isCheckpointUsableForChoiceRetry,
  isChoiceDurableCheckpointEnabled,
  proseFingerprint,
  type ChapterGenerationCheckpoint,
  type CheckpointStatus,
} from './chapter-generation-checkpoint.pure'

export * from './chapter-generation-checkpoint.pure'

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true
  if (message.includes('does not exist')) return true
  if (message.includes('could not find the table')) return true
  return false
}

function rowToCheckpoint(row: Record<string, unknown>): ChapterGenerationCheckpoint | null {
  const paragraphs = row.paragraphs_json
  if (!Array.isArray(paragraphs)) return null
  const status = String(row.status ?? '') as CheckpointStatus
  return {
    storyId: String(row.story_id),
    chapterNumber: Number(row.chapter_number),
    attemptId: String(row.attempt_id),
    correlationId: String(row.correlation_id),
    status,
    title: String(row.title ?? ''),
    paragraphs: paragraphs.map((p) => String(p)),
    proseFingerprint: String(row.prose_fingerprint ?? ''),
    canonVersion: row.canon_version == null ? null : Number(row.canon_version),
    blueprintVersion: row.blueprint_version == null ? null : Number(row.blueprint_version),
    directionFingerprint:
      row.direction_fingerprint == null ? null : String(row.direction_fingerprint),
    proseAttemptCount: Number(row.prose_attempt_count ?? 0),
    choiceAttemptCount: Number(row.choice_attempt_count ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    expiresAt: String(row.expires_at ?? ''),
  }
}

/**
 * Load latest usable checkpoint for story+chapter (choice-only resume).
 * Prefer matching attemptId when provided.
 */
export async function loadUsableProseCheckpoint(args: {
  storyId: string
  chapterNumber: number
  attemptId?: string | null
}): Promise<ChapterGenerationCheckpoint | null> {
  if (!isChoiceDurableCheckpointEnabled()) return null
  try {
    const db = createAdminClient()
    let query = db
      .from('chapter_generation_checkpoints')
      .select('*')
      .eq('story_id', args.storyId)
      .eq('chapter_number', args.chapterNumber)
      .in('status', [
        'PROSE_READY',
        'CHOICES_RETRY_WAIT',
        'QUEUED_CHOICES',
        'RUNNING_CHOICES',
      ])
      .gt('expires_at', new Date().toISOString())
      .order('updated_at', { ascending: false })
      .limit(1)

    if (args.attemptId) {
      query = db
        .from('chapter_generation_checkpoints')
        .select('*')
        .eq('story_id', args.storyId)
        .eq('chapter_number', args.chapterNumber)
        .eq('attempt_id', args.attemptId)
        .in('status', [
          'PROSE_READY',
          'CHOICES_RETRY_WAIT',
          'QUEUED_CHOICES',
          'RUNNING_CHOICES',
        ])
        .gt('expires_at', new Date().toISOString())
        .limit(1)
    }

    const { data, error } = await query.maybeSingle()
    if (error) {
      if (isMissingRelation(error)) {
        console.log('CHECKPOINT_TABLE_UNAVAILABLE', {
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
        })
        return null
      }
      console.log('CHECKPOINT_LOAD_FAILED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        code: error.code,
      })
      return null
    }
    if (!data) return null
    const cp = rowToCheckpoint(data as Record<string, unknown>)
    if (!cp || !isCheckpointUsableForChoiceRetry(cp)) return null
    return cp
  } catch (err) {
    console.log('CHECKPOINT_LOAD_EXCEPTION', {
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      errorName: err instanceof Error ? err.name : 'unknown',
    })
    return null
  }
}

export async function persistProseReadyCheckpoint(args: {
  storyId: string
  chapterNumber: number
  attemptId: string
  correlationId: string
  title: string
  paragraphs: string[]
  proseAttemptCount?: number
  directionFingerprint?: string | null
}): Promise<
  | { ok: true; checkpoint: ChapterGenerationCheckpoint }
  | { ok: false; error: 'TABLE_UNAVAILABLE' | 'WRITE_FAILED' }
> {
  if (!isChoiceDurableCheckpointEnabled()) {
    return { ok: false, error: 'WRITE_FAILED' }
  }

  const fingerprint = proseFingerprint(args.title, args.paragraphs)
  const now = new Date()
  const row = {
    story_id: args.storyId,
    chapter_number: args.chapterNumber,
    attempt_id: args.attemptId,
    correlation_id: args.correlationId,
    status: 'PROSE_READY' as const,
    title: args.title,
    paragraphs_json: args.paragraphs,
    prose_fingerprint: fingerprint,
    canon_version: null,
    blueprint_version: null,
    direction_fingerprint: args.directionFingerprint ?? null,
    prose_attempt_count: args.proseAttemptCount ?? 1,
    choice_attempt_count: 0,
    updated_at: now.toISOString(),
    expires_at: defaultCheckpointExpiry(now),
  }

  try {
    const db = createAdminClient()
    const { error } = await db.from('chapter_generation_checkpoints').upsert(row, {
      onConflict: 'story_id,chapter_number,attempt_id',
    })
    if (error) {
      if (isMissingRelation(error)) {
        console.log('CHECKPOINT_TABLE_UNAVAILABLE', {
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
        })
        return { ok: false, error: 'TABLE_UNAVAILABLE' }
      }
      console.log('CHECKPOINT_WRITE_FAILED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        code: error.code,
      })
      return { ok: false, error: 'WRITE_FAILED' }
    }

    console.log('CHECKPOINT_PROSE_READY', {
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      attemptId: args.attemptId,
      correlationId: args.correlationId,
      proseFingerprint: fingerprint,
    })

    return {
      ok: true,
      checkpoint: {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        attemptId: args.attemptId,
        correlationId: args.correlationId,
        status: 'PROSE_READY',
        title: args.title,
        paragraphs: args.paragraphs,
        proseFingerprint: fingerprint,
        canonVersion: null,
        blueprintVersion: null,
        directionFingerprint: args.directionFingerprint ?? null,
        proseAttemptCount: args.proseAttemptCount ?? 1,
        choiceAttemptCount: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: row.expires_at,
      },
    }
  } catch {
    return { ok: false, error: 'WRITE_FAILED' }
  }
}

export async function markCheckpointStatus(args: {
  storyId: string
  chapterNumber: number
  attemptId: string
  status: CheckpointStatus
  choiceAttemptCount?: number
}): Promise<void> {
  if (!isChoiceDurableCheckpointEnabled()) return
  try {
    const db = createAdminClient()
    const patch: Record<string, unknown> = {
      status: args.status,
      updated_at: new Date().toISOString(),
    }
    if (args.choiceAttemptCount !== undefined) {
      patch.choice_attempt_count = args.choiceAttemptCount
    }
    if (args.status === 'PUBLISHED' || args.status === 'EXPIRED') {
      patch.expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
    const { error } = await db
      .from('chapter_generation_checkpoints')
      .update(patch)
      .eq('story_id', args.storyId)
      .eq('chapter_number', args.chapterNumber)
      .eq('attempt_id', args.attemptId)
    if (error && !isMissingRelation(error)) {
      console.log('CHECKPOINT_STATUS_UPDATE_FAILED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        status: args.status,
        code: error.code,
      })
    } else if (!error) {
      console.log('CHECKPOINT_STATUS', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        attemptId: args.attemptId,
        status: args.status,
      })
    }
  } catch {
    // best-effort
  }
}

// re-export draftFromCheckpoint for server consumers that import this module
export { draftFromCheckpoint }
