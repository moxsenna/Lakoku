import 'server-only'
import {
  acquireGenerationLease,
  publishChapter,
  type PublishResult,
  type PublishOutcome,
} from './lifecycle'

/**
 * Fake generation workflow (M2/T2.2).
 *
 * Menghasilkan bab fixture DETERMINISTIK (tanpa LLM) lalu mem-publish-nya lewat
 * jalur atomik yang sama dengan generasi nyata nanti (M4/M5). Tujuannya menguji
 * lifecycle end-to-end: lease → tulis → publish transaksional → release.
 *
 * Sifat penting:
 *  - Deterministik: input (storyId, chapterNumber) → output bab yang sama.
 *  - Idempoten: idempotency key stabil per (story, chapter); retry aman.
 *  - Atomic: publish memakai RPC all-or-nothing; gagal = tak ada state parsial.
 */

function deterministicChapter(storyId: string, n: number) {
  const title = `Bab ${n}`
  const paragraphs = [
    `Bab ${n} dari kisah ini dibuka dengan langkah yang mantap.`,
    `Setiap keputusan sebelumnya menumpuk, dan kini pilihan baru menanti di ujung ${storyId.replace(/-/g, ' ')}.`,
  ]
  const choicePrompt = 'Apa yang kaulakukan sekarang?'
  const choices = [
    { id: 'maju', label: 'Melangkah maju' },
    { id: 'ragu', label: 'Berhenti sejenak' },
  ]
  const outcomes: PublishOutcome[] = [
    {
      choiceId: 'maju',
      consequence: ['Kau memilih maju; jalan cerita terbuka lebih lebar.'],
      nextChapterNumber: n + 1,
      isEnding: false,
    },
    {
      choiceId: 'ragu',
      consequence: ['Kau ragu sejenak, namun tetap melanjutkan langkah.'],
      nextChapterNumber: n + 1,
      isEnding: false,
    },
  ]
  return { title, paragraphs, choicePrompt, choices, outcomes }
}

/** Idempotency key stabil per (story, chapter, scope). */
export function generationKey(storyId: string, n: number, scope: string) {
  return `gen:${scope}:${storyId}:${n}`
}

export type GenerateChapterResult =
  | { ok: true; chapterNumber: number; seq: number }
  | { ok: false; reason: 'LEASE_HELD' | 'CHAPTER_EXISTS' }

/**
 * Jalankan workflow generasi satu bab: ambil lease, susun konten, publish atomik.
 * Aman dipanggil berulang (idempoten) dan aman untuk resume.
 */
export async function generateNextChapter(
  storyId: string,
  chapterNumber: number,
): Promise<GenerateChapterResult> {
  // 1) Ambil lease (idempoten). Menolak bila ada generasi lain aktif.
  const lease = await acquireGenerationLease({
    storyId,
    chapterNumber,
    holder: 'fake-generation',
    idempotencyKey: generationKey(storyId, chapterNumber, 'lease'),
  })
  if (!lease.ok) return { ok: false, reason: lease.reason }

  // 2) Susun konten deterministik (mensimulasikan tahap planner+writer).
  const content = deterministicChapter(storyId, chapterNumber)

  // 3) Publish atomik + release lease dalam satu transaksi.
  const result: PublishResult = await publishChapter({
    storyId,
    chapterNumber,
    title: content.title,
    paragraphs: content.paragraphs,
    choicePrompt: content.choicePrompt,
    choices: content.choices,
    outcomes: content.outcomes,
    leaseId: lease.lease_id,
    idempotencyKey: generationKey(storyId, chapterNumber, 'publish'),
  })

  if (!result.ok) return { ok: false, reason: result.reason }
  return { ok: true, chapterNumber: result.chapter_number, seq: result.seq }
}
