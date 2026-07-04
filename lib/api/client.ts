/**
 * Lakoku — Seam data sisi BROWSER (API-first).
 *
 * Ini SATU-SATUNYA pintu yang boleh dipakai komponen client untuk berbicara
 * dengan backend, via Reader API (interim: Next.js route handlers /api/*;
 * nanti: Cloudflare Workers — cukup ganti API_BASE, komponen tidak berubah).
 *
 * Logika naratif (memori T0–T3, validator, alias registry, thread lifecycle,
 * reveal gates) TETAP di backend. Client hanya menampilkan hasilnya.
 *
 * Untuk Server Components, gunakan lib/api/server.ts (kontrak identik).
 */

import type {
  StorySummary,
  StoryDetail,
  Chapter,
  ChoiceOutcome,
} from './types'

const API_BASE = '/api'

/** Daftar seluruh cerita (ringkasan) untuk katalog/beranda/koleksiku. */
export async function listStories(): Promise<StorySummary[]> {
  const res = await fetch(`${API_BASE}/stories`)
  if (!res.ok) throw new Error('Gagal memuat daftar cerita.')
  const data = (await res.json()) as { stories: StorySummary[] }
  return data.stories
}

/** Detail lengkap satu cerita berdasarkan id. */
export async function getStory(id: string): Promise<StoryDetail | null> {
  const res = await fetch(`${API_BASE}/stories/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Gagal memuat cerita.')
  const data = (await res.json()) as { story: StoryDetail }
  return data.story
}

/** Ambil satu bab tertentu. */
export async function getChapter(
  storyId: string,
  chapterNumber: number,
): Promise<Chapter | null> {
  const res = await fetch(
    `${API_BASE}/stories/${encodeURIComponent(storyId)}/chapters/${chapterNumber}`,
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Gagal memuat bab.')
  const data = (await res.json()) as { chapter: Chapter }
  return data.chapter
}

/**
 * Kirim pilihan pembaca. Backend yang menghitung konsekuensi &
 * menentukan bab berikutnya (bounded branching + validator di server).
 */
export async function submitChoice(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<ChoiceOutcome> {
  const res = await fetch(
    `${API_BASE}/stories/${encodeURIComponent(storyId)}/choices`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterNumber, choiceId }),
    },
  )

  if (res.ok) {
    const data = (await res.json()) as { outcome: ChoiceOutcome }
    return data.outcome
  }

  // Fallback aman bila kombinasi belum tersedia (konten demo terbatas):
  // cerita tetap bergerak tanpa menampilkan error teknis ke pembaca.
  return {
    storyId,
    chapterNumber,
    choiceId,
    consequence: [
      'Pilihanmu telah dicatat, dan cerita bergerak ke arah yang baru.',
    ],
    nextChapterNumber: chapterNumber + 1,
    isEnding: false,
  }
}
