/**
 * Pure helpers for chapter generation status polling (reader UI).
 * No React / DOM — unit-testable without jsdom.
 */

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

/** Format soft wait estimate for Indonesian casual UI. */
export function formatEstimatedWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `±${Math.max(15, s)} detik`
  const mins = Math.max(1, Math.round(s / 60))
  if (mins === 1) return '±1 menit'
  return `±${mins} menit`
}

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
        title: 'Bab ini sedang mengantri.',
        description:
          `Banyak pembaca menulis bersamaan. Bab ${chapterNumber} menunggu giliran ` +
          'biar kualitasnya tetap jaga. Halaman ini akan terbuka sendiri begitu babnya siap.',
        primaryCta: 'Periksa sekarang',
        queueLine:
          pos != null
            ? `Antrian #${pos} · estimasi ${wait}`
            : `Sedang mengantri · estimasi ${wait}`,
      }
    }
    const waitLine =
      queue?.estimatedWaitSeconds != null
        ? ` Estimasi ${formatEstimatedWait(queue.estimatedWaitSeconds)}.`
        : ''
    return {
      title: 'Bab ini sedang ditulis.',
      description:
        `Bab ${chapterNumber} sedang disusun dengan cermat agar tetap setia pada kisahmu. ` +
        `Halaman ini akan terbuka sendiri begitu babnya siap.${waitLine}`,
      primaryCta: 'Periksa sekarang',
      queueLine:
        queue?.estimatedWaitSeconds != null
          ? `Sedang ditulis · estimasi ${formatEstimatedWait(queue.estimatedWaitSeconds)}`
          : null,
    }
  }
  return {
    title: 'Bab ini belum berhasil disiapkan.',
    description:
      `Bab ${chapterNumber} belum bisa ditampilkan sekarang. ` +
      'Kamu bisa mencoba menulis ulang tanpa mengubah bagian cerita yang sudah tersimpan.',
    primaryCta: 'Coba tulis ulang',
    queueLine: null,
  }
}

export function noteForStartStatus(
  status: 'STARTED' | 'ALREADY_RUNNING' | 'ALREADY_READY' | undefined,
): string {
  if (status === 'ALREADY_READY') return 'Bab sudah siap. Membuka halaman…'
  if (status === 'ALREADY_RUNNING') return 'Bab ini masih sedang disiapkan.'
  return 'Penulisan dimulai. Halaman akan terbuka bila bab siap.'
}
