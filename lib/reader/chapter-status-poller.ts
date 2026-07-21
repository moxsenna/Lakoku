/**
 * Pure helpers for chapter generation status polling (reader UI).
 * No React / DOM — unit-testable without jsdom.
 */

import { formatEstimatedWait } from '@/lib/runtime/generation-latency-estimate'

export type ReaderChapterUiState = 'PREPARING' | 'UNAVAILABLE'

export type ChapterPollStatus = 'ready' | 'queued' | 'generating' | 'failed'

export type ChapterQueueHint = {
  position: number | null
  estimatedWaitSeconds: number
  phase: 'queued' | 'active'
}

export const CHAPTER_STATUS_POLL_MS = 5_000

export type PollDecision =
  | { action: 'refresh' }
  | { action: 'continue'; nextDelayMs: number }
  | { action: 'failed' }
  | { action: 'retry_later'; nextDelayMs: number }

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
  // queued + generating keep polling
  return { action: 'continue', nextDelayMs: pollMs }
}

export function decideAfterNetworkError(
  pollMs = CHAPTER_STATUS_POLL_MS,
): PollDecision {
  return { action: 'retry_later', nextDelayMs: pollMs }
}

export { formatEstimatedWait }

export function readerCopy(
  state: ReaderChapterUiState,
  chapterNumber: number,
  queue?: ChapterQueueHint | null,
): { title: string; description: string; primaryCta: string; queueLine: string | null } {
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
