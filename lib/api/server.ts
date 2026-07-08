/**
 * Lakoku — Seam data sisi SERVER (API-first).
 *
 * Dipakai oleh Server Components / route handlers. Kontraknya identik dengan
 * lib/api/client.ts (sisi browser) — dua pintu, satu kontrak (lib/api/types.ts).
 *
 * Konten published: query anon ke Supabase (publik by RLS).
 * Reader-state: untuk user login, state per-user (reader_states, RLS
 * pemilik-saja) MENIMPA kolom demo global di stories. Tamu memakai state demo.
 *
 * Saat migrasi ke Cloudflare Workers, file ini tinggal diganti menjadi
 * fetch() ke Workers — komponen tidak berubah.
 */
import 'server-only'
import type {
  StorySummary,
  StoryDetail,
  Chapter,
  ChapterAvailability,
} from './types'
import {
  queryStories,
  queryStory,
  queryChapter,
  queryLatestAvailableChapter,
} from './queries'
import { getReaderStates, getReaderState, type ReaderState } from './user-state'
import { isChapterPreparing } from './leases'

function overlay<T extends StorySummary>(story: T, state?: ReaderState | null): T {
  if (!state) return story
  return {
    ...story,
    status: state.status,
    currentChapter: state.currentChapter,
    jejak: state.jejak,
    ...(state.endingName ? { endingName: state.endingName } : {}),
  }
}

/**
 * Daftar id cerita SAJA — tanpa sesi/cookies. Khusus untuk
 * generateStaticParams (build time, tidak ada request context).
 */
export async function listStoryIds(): Promise<string[]> {
  const stories = await queryStories()
  return stories.map((s) => s.id)
}

/** Daftar seluruh cerita (ringkasan), dengan state per-user bila login. */
export async function listStories(): Promise<StorySummary[]> {
  const [stories, states] = await Promise.all([queryStories(), getReaderStates()])
  return stories.map((s) => overlay(s, states.get(s.id)))
}

/** Detail lengkap satu cerita, dengan state per-user bila login. */
export async function getStory(id: string): Promise<StoryDetail | null> {
  const [story, state] = await Promise.all([queryStory(id), getReaderState(id)])
  return story ? overlay(story, state) : null
}

/**
 * Ambil satu bab. Jika `chapterNumber` tidak diberikan, kembalikan
 * bab pada posisi terkini pembaca (per-user bila login, demo bila tamu).
 */
export async function getChapter(
  storyId: string,
  chapterNumber?: number,
): Promise<Chapter | null> {
  let target = chapterNumber
  if (target == null) {
    const story = await getStory(storyId)
    if (!story) return null
    target = story.currentChapter
  }

  const chapter = await queryChapter(storyId, target)
  if (chapter) return chapter

  // Bab yang diminta belum ada isinya. Bila bab itu SEDANG ditulis (ada lease
  // generasi aktif), biarkan null agar reader menampilkan layar PREPARING yang
  // tepat. Bila tidak sedang ditulis, pembaca kemungkinan terlanjur maju
  // melewati konten yang tersedia — jatuhkan ke bab terakhir yang bisa dibaca
  // (<= target) alih-alih menahan mereka di layar kosong permanen.
  const preparing = await isChapterPreparing(storyId, target)
  if (preparing) return null
  return queryLatestAvailableChapter(storyId, target)
}

/**
 * Ketersediaan satu bab dari sudut pandang pembaca (reader-safe).
 *
 * Dipakai saat sebuah bab yang diminta belum ada isinya, agar reader dapat
 * pesan yang tepat alih-alih dialihkan diam-diam:
 *  - bab ada di DB          → `PUBLISHED`
 *  - ada lease generasi aktif → `PREPARING` (sedang ditulis)
 *  - selain itu             → `UNAVAILABLE` (belum tersedia / sedang dirapikan)
 *
 * TIDAK pernah membocorkan alasan teknis kegagalan (layer/temuan/model).
 */
export async function getChapterAvailability(
  storyId: string,
  chapterNumber: number,
): Promise<ChapterAvailability> {
  const chapter = await queryChapter(storyId, chapterNumber)
  if (chapter) return 'PUBLISHED'
  const preparing = await isChapterPreparing(storyId, chapterNumber)
  return preparing ? 'PREPARING' : 'UNAVAILABLE'
}
