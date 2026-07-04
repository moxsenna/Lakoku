/**
 * Lakoku — Client Data (API-first)
 *
 * Ini SATU-SATUNYA pintu yang boleh dipakai UI untuk mengambil data.
 * Semua fungsi bersifat async agar tanda tangannya identik ketika di masa
 * depan implementasinya diganti dari fixture lokal menjadi pemanggilan
 * `fetch()` ke backend nyata (Hono/Cloudflare Workers + Supabase).
 *
 * Cara migrasi ke backend nanti (tanpa menyentuh komponen UI):
 *   const res = await fetch(`${API_BASE}/stories`, { next: { revalidate } })
 *   return res.json() as Promise<StorySummary[]>
 *
 * Logika naratif (memori T0–T3, validator, alias registry, thread lifecycle,
 * reveal gates) TETAP di backend. Client hanya menampilkan hasilnya.
 */

import type {
  StorySummary,
  StoryDetail,
  Chapter,
  ChoiceOutcome,
} from './types'
import {
  storyFixtures,
  chapterFixtures,
  outcomeFixtures,
} from './fixtures'

/** Simulasi latensi jaringan ringan agar state loading terasa realistis. */
const SIMULATED_LATENCY_MS = 0

function delay<T>(value: T): Promise<T> {
  if (SIMULATED_LATENCY_MS <= 0) return Promise.resolve(value)
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

function toSummary(story: StoryDetail): StorySummary {
  const { synopsis: _synopsis, jejak: _jejak, ...summary } = story
  return summary
}

/** Daftar seluruh cerita (ringkasan) untuk katalog/beranda/koleksiku. */
export async function listStories(): Promise<StorySummary[]> {
  return delay(storyFixtures.map(toSummary))
}

/** Detail lengkap satu cerita berdasarkan id. */
export async function getStory(id: string): Promise<StoryDetail | null> {
  return delay(storyFixtures.find((s) => s.id === id) ?? null)
}

/**
 * Ambil satu bab. Jika `chapterNumber` tidak diberikan, kembalikan
 * bab pada posisi terkini pembaca (currentChapter).
 */
export async function getChapter(
  storyId: string,
  chapterNumber?: number,
): Promise<Chapter | null> {
  const story = storyFixtures.find((s) => s.id === storyId)
  if (!story) return delay(null)

  const target = chapterNumber ?? story.currentChapter
  const chapter = chapterFixtures.find(
    (c) => c.storyId === storyId && c.number === target,
  )
  return delay(chapter ?? null)
}

/**
 * Kirim pilihan pembaca. Backend nanti yang menghitung konsekuensi &
 * menentukan bab berikutnya. Di fase ini dilayani oleh fixture.
 */
export async function submitChoice(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<ChoiceOutcome> {
  const key = `${storyId}:${chapterNumber}:${choiceId}`
  const outcome = outcomeFixtures[key]
  if (outcome) return delay(outcome)

  // Fallback aman bila kombinasi belum tersedia di fixture.
  return delay<ChoiceOutcome>({
    storyId,
    chapterNumber,
    choiceId,
    consequence: [
      'Pilihanmu telah dicatat, dan cerita bergerak ke arah yang baru.',
    ],
    nextChapterNumber: chapterNumber + 1,
    isEnding: false,
  })
}
