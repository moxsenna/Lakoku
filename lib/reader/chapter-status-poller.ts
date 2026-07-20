/**
 * Pure helpers for chapter generation status polling (reader UI).
 * No React / DOM — unit-testable without jsdom.
 */

export type ReaderChapterUiState = 'PREPARING' | 'UNAVAILABLE'

export type ChapterPollStatus = 'ready' | 'generating' | 'failed'

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
  return { action: 'continue', nextDelayMs: pollMs }
}

export function decideAfterNetworkError(
  pollMs = CHAPTER_STATUS_POLL_MS,
): PollDecision {
  return { action: 'retry_later', nextDelayMs: pollMs }
}

export function readerCopy(
  state: ReaderChapterUiState,
  chapterNumber: number,
): { title: string; description: string; primaryCta: string } {
  if (state === 'PREPARING') {
    return {
      title: 'Bab ini sedang ditulis.',
      description:
        `Bab ${chapterNumber} sedang disusun dengan cermat agar tetap setia pada kisahmu. ` +
        'Halaman ini akan terbuka sendiri begitu babnya siap.',
      primaryCta: 'Periksa sekarang',
    }
  }
  return {
    title: 'Bab ini belum berhasil disiapkan.',
    description:
      `Bab ${chapterNumber} belum bisa ditampilkan sekarang. ` +
      'Kamu bisa mencoba menulis ulang tanpa mengubah bagian cerita yang sudah tersimpan.',
    primaryCta: 'Coba tulis ulang',
  }
}

export function noteForStartStatus(
  status: 'STARTED' | 'ALREADY_RUNNING' | 'ALREADY_READY' | undefined,
): string {
  if (status === 'ALREADY_READY') return 'Bab sudah siap. Membuka halaman…'
  if (status === 'ALREADY_RUNNING') return 'Bab ini masih sedang disiapkan.'
  return 'Penulisan dimulai. Halaman akan terbuka bila bab siap.'
}
