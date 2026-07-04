/**
 * Lakoku — Seam data sisi SERVER (API-first).
 *
 * Dipakai oleh Server Components / route handlers. Kontraknya identik dengan
 * lib/api/client.ts (sisi browser) — dua pintu, satu kontrak (lib/api/types.ts).
 *
 * Implementasi saat ini: query langsung ke Supabase (konten published).
 * Saat migrasi ke Cloudflare Workers, file ini tinggal diganti menjadi
 * fetch() ke Workers — komponen tidak berubah.
 */
import 'server-only'
import type { StorySummary, StoryDetail, Chapter } from './types'
import { queryStories, queryStory, queryChapter } from './queries'

/** Daftar seluruh cerita (ringkasan) untuk katalog/beranda/koleksiku. */
export async function listStories(): Promise<StorySummary[]> {
  return queryStories()
}

/** Detail lengkap satu cerita berdasarkan id. */
export async function getStory(id: string): Promise<StoryDetail | null> {
  return queryStory(id)
}

/**
 * Ambil satu bab. Jika `chapterNumber` tidak diberikan, kembalikan
 * bab pada posisi terkini pembaca (currentChapter).
 */
export async function getChapter(
  storyId: string,
  chapterNumber?: number,
): Promise<Chapter | null> {
  let target = chapterNumber
  if (target == null) {
    const story = await queryStory(storyId)
    if (!story) return null
    target = story.currentChapter
  }
  return queryChapter(storyId, target)
}
