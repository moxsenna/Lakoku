/**
 * Durable prose checkpoint helpers (PROSE_READY).
 * Service/worker only — never expose draft prose via Reader API.
 *
 * Full choice-only job integration lands with generation_jobs worker path.
 * This module provides typed status + fingerprint helpers used by both
 * the sync path (future) and tests.
 */
import { createHash } from 'node:crypto'

export type CheckpointStatus =
  | 'PROSE_READY'
  | 'QUEUED_CHOICES'
  | 'RUNNING_CHOICES'
  | 'CHOICES_RETRY_WAIT'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED'
  | 'EXPIRED'
  | 'FAILED'

export type ChapterGenerationCheckpoint = {
  storyId: string
  chapterNumber: number
  attemptId: string
  correlationId: string
  status: CheckpointStatus
  title: string
  paragraphs: string[]
  proseFingerprint: string
  canonVersion: number | null
  blueprintVersion: number | null
  directionFingerprint: string | null
  proseAttemptCount: number
  choiceAttemptCount: number
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export function proseFingerprint(title: string, paragraphs: string[]): string {
  const payload = JSON.stringify({ title, paragraphs })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export function choiceJobIdempotencyKey(args: {
  storyId: string
  chapterNumber: number
  proseFingerprint: string
}): string {
  return `choice:${args.storyId}:${args.chapterNumber}:${args.proseFingerprint}`
}

export function publishIdempotencyKey(args: {
  storyId: string
  chapterNumber: number
  proseFingerprint: string
  choiceFingerprint: string
}): string {
  return `publish:${args.storyId}:${args.chapterNumber}:${args.proseFingerprint}:${args.choiceFingerprint}`
}

export function choiceFingerprint(branch: {
  choicePrompt: string
  choices: Array<{ id: string; label: string }>
  outcomes: Array<{ choiceId: string; consequence: string[] }>
}): string {
  const payload = JSON.stringify({
    choicePrompt: branch.choicePrompt,
    choices: branch.choices.map((c) => ({ id: c.id, label: c.label })),
    outcomes: branch.outcomes.map((o) => ({
      choiceId: o.choiceId,
      consequence: o.consequence,
    })),
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

/** Default retention: 24h after prose ready. */
export function defaultCheckpointExpiry(from = new Date()): string {
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString()
}

export function isCheckpointUsableForChoiceRetry(
  checkpoint: Pick<ChapterGenerationCheckpoint, 'status' | 'expiresAt' | 'proseFingerprint'>,
  now = new Date(),
): boolean {
  if (checkpoint.status !== 'PROSE_READY' && checkpoint.status !== 'CHOICES_RETRY_WAIT') {
    return false
  }
  if (!checkpoint.proseFingerprint) return false
  return new Date(checkpoint.expiresAt).getTime() > now.getTime()
}

/** Reader-facing status mapping for attempt-aware UI. */
export function readerStatusFromCheckpoint(
  status: CheckpointStatus | null | undefined,
): 'writing' | 'preparing_choices' | 'ready' | 'failed' | null {
  if (!status) return null
  switch (status) {
    case 'PROSE_READY':
    case 'QUEUED_CHOICES':
    case 'RUNNING_CHOICES':
    case 'CHOICES_RETRY_WAIT':
    case 'READY_TO_PUBLISH':
      return 'preparing_choices'
    case 'PUBLISHED':
      return 'ready'
    case 'FAILED':
    case 'EXPIRED':
      return 'failed'
    default:
      return null
  }
}

export const READER_STATUS_COPY = {
  queued: 'Babmu masuk antrean penulisan.',
  writing: 'Bab ini sedang ditulis.',
  preparing_choices: 'Babnya sudah terbentuk. Kami sedang menyiapkan pilihanmu.',
  ready: null as string | null, // refresh page
  failed: 'Bab ini belum berhasil disiapkan.',
} as const
