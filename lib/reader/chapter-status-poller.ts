/**
 * Pure helpers for chapter generation status polling (reader UI).
 * No React / DOM — unit-testable without jsdom.
 */

import { formatEstimatedWait } from '@/lib/runtime/generation-latency-estimate'

export type ReaderChapterUiState = 'PREPARING' | 'UNAVAILABLE' | 'STATUS_UNKNOWN'

export type ReaderStatusIssue =
  | 'AUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'TRANSIENT_EXHAUSTED'

export type ChapterPollStatus = 'ready' | 'queued' | 'generating' | 'failed'

export type ChapterQueueHint = {
  position: number | null
  estimatedWaitSeconds: number
  phase: 'queued' | 'active'
}

export const CHAPTER_STATUS_POLL_MS = 5_000
export const MAX_TRANSIENT_ATTEMPTS = 5
export const TRANSIENT_DEADLINE_MS = 60_000

export type PollDecision =
  | { action: 'refresh' }
  | { action: 'continue'; nextDelayMs: number }
  | { action: 'failed' }
  | { action: 'unknown'; issue: ReaderStatusIssue }
  | { action: 'retry_later'; nextDelayMs: number }

export type PollBudget = { transientAttempts: number; startedAt: number }

export function createPollBudget(now = Date.now()): PollBudget {
  return { transientAttempts: 0, startedAt: now }
}

export function resetPollBudget(now = Date.now()): PollBudget {
  return createPollBudget(now)
}

export function classifyStatusError(error: unknown): ReaderStatusIssue | null {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : NaN
  if (status === 401 || status === 403) return 'AUTH_REQUIRED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 400) return 'INVALID_REQUEST'
  return null
}

export function consumeSuccessfulBudget(budget: PollBudget, now = Date.now()): 'continue' | 'unknown' {
  budget.transientAttempts = 0
  return now - budget.startedAt >= TRANSIENT_DEADLINE_MS ? 'unknown' : 'continue'
}

export function consumeTransientBudget(budget: PollBudget, now = Date.now()): PollDecision {
  const attempts = budget.transientAttempts + 1
  budget.transientAttempts = attempts
  if (attempts > MAX_TRANSIENT_ATTEMPTS || now - budget.startedAt >= TRANSIENT_DEADLINE_MS) {
    return { action: 'unknown', issue: 'TRANSIENT_EXHAUSTED' }
  }
  const base = Math.min(CHAPTER_STATUS_POLL_MS * 2 ** (attempts - 1), 30_000)
  return { action: 'retry_later', nextDelayMs: Math.round(base * (0.8 + Math.random() * 0.4)) }
}

/**
 * Map a successful status API response to UI action.
 * Network errors are handled separately (retry_later without flipping to failed).
 */
export function decideAfterStatus(
  status: ChapterPollStatus,
  pollMs = CHAPTER_STATUS_POLL_MS,
): PollDecision {
  if (status === 'ready') return { action: 'refresh' }
  if (status === 'failed') return { action: 'failed' }
  return { action: 'continue', nextDelayMs: pollMs }
}

export function decideAfterNetworkError(
  error: unknown,
  budget?: PollBudget,
): PollDecision {
  // Legacy callers may pass poll interval; bounded callers pass budget.
  if (typeof error === 'number') return { action: 'retry_later', nextDelayMs: error }
  const issue = classifyStatusError(error)
  return issue ? { action: 'unknown', issue } : consumeTransientBudget(budget ?? createPollBudget())
}

export { formatEstimatedWait }

export function readerCopy(
  state: ReaderChapterUiState,
  chapterNumber: number,
  queue?: ChapterQueueHint | null,
): { title: string; description: string; primaryCta: string; queueLine: string | null } {
  if (state === 'STATUS_UNKNOWN') {
    return {
      title: 'Status bab belum bisa diperiksa.',
      description: `Bab ${chapterNumber} belum bisa ditampilkan sekarang. Coba periksa lagi atau kembali ke cerita.`,
      primaryCta: 'Cek lagi',
      queueLine: null,
    }
  }
  if (state === 'PREPARING') {
    if (queue?.phase === 'queued') {
      const pos = queue.position
      const wait = formatEstimatedWait(queue.estimatedWaitSeconds)
      return {
        title: 'Lagi antri dulu.',
        description:
          `Lagi ramai yang nulis bab bareng. Bab ${chapterNumber} nunggu giliran ` +
          'biar servernya nggak numpuk. Nanti halaman ini kebuka sendiri kalau babnya siap.',
        primaryCta: 'Cek lagi',
        queueLine:
          pos != null
            ? `Antrian ke-${pos} · perkiraan ${wait}`
            : `Masih antri · perkiraan ${wait}`,
      }
    }

    const wait =
      queue?.estimatedWaitSeconds != null
        ? formatEstimatedWait(queue.estimatedWaitSeconds)
        : null
    return {
      title: 'Babnya lagi ditulis.',
      description:
        `Bab ${chapterNumber} lagi disusun biar nyambung sama cerita kamu. ` +
        'Santai aja — halaman ini kebuka sendiri kalau sudah siap.',
      primaryCta: 'Cek lagi',
      queueLine: wait ? `Lagi ditulis · ${wait}` : null,
    }
  }
  return {
    title: 'Bab ini belum berhasil disiapkan.',
    description:
      `Bab ${chapterNumber} belum bisa ditampilkan sekarang. ` +
      'Kamu bisa coba tulis ulang tanpa mengubah bagian cerita yang sudah tersimpan.',
    primaryCta: 'Coba tulis ulang',
    queueLine: null,
  }
}

export function noteForStartStatus(
  status: 'STARTED' | 'ALREADY_RUNNING' | 'ALREADY_READY' | undefined,
): string {
  if (status === 'ALREADY_READY') return 'Bab sudah siap. Membuka halaman…'
  if (status === 'ALREADY_RUNNING') return 'Bab ini masih disiapkan / mengantri.'
  return 'Penulisan dimulai. Halaman akan terbuka bila bab siap.'
}
