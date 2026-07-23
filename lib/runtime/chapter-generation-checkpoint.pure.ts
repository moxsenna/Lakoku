/**
 * Pure checkpoint helpers (no server-only / DB). Safe for unit tests.
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

export function defaultCheckpointExpiry(from = new Date()): string {
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString()
}

export function isCheckpointUsableForChoiceRetry(
  checkpoint: Pick<ChapterGenerationCheckpoint, 'status' | 'expiresAt' | 'proseFingerprint'>,
  now = new Date(),
): boolean {
  if (
    checkpoint.status !== 'PROSE_READY' &&
    checkpoint.status !== 'CHOICES_RETRY_WAIT' &&
    checkpoint.status !== 'QUEUED_CHOICES' &&
    checkpoint.status !== 'RUNNING_CHOICES'
  ) {
    return false
  }
  if (!checkpoint.proseFingerprint) return false
  return new Date(checkpoint.expiresAt).getTime() > now.getTime()
}

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
  ready: null as string | null,
  failed: 'Bab ini belum berhasil disiapkan.',
} as const

export function isChoiceDurableCheckpointEnabled(): boolean {
  const raw =
    typeof process !== 'undefined'
      ? process.env.LAKOKU_CHOICE_DURABLE_CHECKPOINT?.trim().toLowerCase()
      : undefined
  if (raw === undefined || raw === '') return true
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false
  return true
}

export function draftFromCheckpoint(checkpoint: ChapterGenerationCheckpoint): {
  storyId: string
  title: string
  paragraphs: string[]
  chapterNumber: number
  wordCount: number
  sceneCount: number
  hasChoiceOrGate: boolean
  events: []
  knowledgeAssertions: []
  reveals: []
  proposedStateDelta: Record<string, never>
  newNamedCharacters: []
  dialogue: []
  emotionBeats: []
  softClaims: []
} {
  const wordCount = checkpoint.paragraphs
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
  return {
    storyId: checkpoint.storyId,
    title: checkpoint.title,
    paragraphs: checkpoint.paragraphs,
    chapterNumber: checkpoint.chapterNumber,
    wordCount,
    sceneCount: Math.max(1, checkpoint.paragraphs.length),
    hasChoiceOrGate: checkpoint.chapterNumber < 50,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
}
