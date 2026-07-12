/**
 * Lakoku — Seam data sisi SERVER (API-first).
 *
 * Dipakai oleh Server Components / route handlers. Kontraknya identik dengan
 * lib/api/client.ts (sisi browser) — dua pintu, satu kontrak (lib/api/types.ts).
 *
 * AMENDMENTS v0.5:
 * - Library personal = owned / reader_states saja (bukan dump semua `stories`).
 * - Jelajahi = demo resmi (+ share publik nanti), bukan progress orang lain.
 * - Login: progress dari `reader_states`. Tamu: tidak punya library server.
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
  queryChapterMetadatas,
} from './queries'
import {
  getReaderStates,
  getReaderState,
  getSessionUser,
  type ReaderState,
} from './user-state'
import { isChapterPreparing } from './leases'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

/** Demo/seed resmi yang boleh tampil di Jelajahi sebelum share katalog hidup. */
const OFFICIAL_DEMO_STORY_IDS = new Set(['demo:selasa-akhir', 'premium:bilik-ketujuh-kbm-v2'])

function isOfficialDemoStory(id: string): boolean {
  return id.startsWith('demo:') || OFFICIAL_DEMO_STORY_IDS.has(id)
}

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

/**
 * @deprecated Prefer `listMyLibraryStories` / `listExploreStories`.
 * Masih overlay progress login, tetapi mengembalikan seluruh katalog shell —
 * jangan dipakai untuk Koleksiku/stats personal.
 */
export async function listStories(): Promise<StorySummary[]> {
  const [stories, states] = await Promise.all([queryStories(), getReaderStates()])
  return stories.map((s) => overlay(s, states.get(s.id)))
}

/**
 * Library personal (Koleksiku / Lanjutkan / stats).
 * - Tamu: []
 * - Login: hanya story yang punya `reader_states` milik user, dengan progress overlay.
 */
export async function listMyLibraryStories(): Promise<StorySummary[]> {
  const user = await getSessionUser()
  if (!user) return []

  const states = await getReaderStates()
  if (states.size === 0) return []

  const stories = await queryStories()
  const byId = new Map(stories.map((s) => [s.id, s]))
  const mine: StorySummary[] = []
  for (const [storyId, state] of states) {
    const base = byId.get(storyId)
    if (!base) continue
    mine.push(overlay(base, state))
  }
  return mine
}

/**
 * Katalog Jelajahi: demo/seed resmi saja (share publik menyusul T-SHARE).
 * Progress personal di-overlay bila user pernah mulai demo tsb.
 */
export async function listExploreStories(): Promise<StorySummary[]> {
  const [stories, states] = await Promise.all([queryStories(), getReaderStates()])
  return stories
    .filter((s) => isOfficialDemoStory(s.id))
    .map((s) => {
      const state = states.get(s.id)
      if (state) return overlay(s, state)
      // Demo catalog: tampilkan sebagai BARU untuk jelajah, jangan wariskan
      // status global BERJALAN seolah milik user. Bab 1 = titik mulai baca.
      return {
        ...s,
        status: 'BARU' as const,
        currentChapter: 1,
        jejak: [],
        endingName: undefined,
      }
    })
}

/** Detail lengkap satu cerita, dengan state per-user bila login. */
export async function getStory(id: string): Promise<StoryDetail | null> {
  const storyId = normalizeStoryRouteId(id)
  const [story, state] = await Promise.all([queryStory(storyId), getReaderState(storyId)])
  if (!story) return null
  if (state) return overlay(story, state)
  // Login tanpa personal state: jangan pakai demo global status sebagai milik user.
  // currentChapter = 1 (bukan 0): reader butuh bab valid; 0 memicu "Bab 0 dirapikan".
  const user = await getSessionUser()
  if (user) {
    return {
      ...story,
      status: 'BARU',
      currentChapter: 1,
      jejak: [],
      endingName: undefined,
    }
  }
  // Tamu / demo shell: pastikan posisi baca minimal bab 1.
  const chapter = Math.max(1, story.currentChapter || 1)
  return { ...story, currentChapter: chapter }
}

/**
 * Ambil satu bab. Jika `chapterNumber` tidak diberikan, kembalikan
 * bab pada posisi terkini pembaca (per-user bila login, demo bila tamu).
 */
export async function getChapter(
  storyId: string,
  chapterNumber?: number,
): Promise<Chapter | null> {
  storyId = normalizeStoryRouteId(storyId)
  let target = chapterNumber
  if (target == null) {
    const story = await getStory(storyId)
    if (!story) return null
    target = story.currentChapter
  }
  target = Math.max(1, target)

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
  storyId = normalizeStoryRouteId(storyId)
  const chapter = await queryChapter(storyId, chapterNumber)
  if (chapter) return 'PUBLISHED'
  const preparing = await isChapterPreparing(storyId, chapterNumber)
  return preparing ? 'PREPARING' : 'UNAVAILABLE'
}

/**
 * Daftar metadata bab yang sudah bisa diakses pembaca (1..maxReachedChapter).
 *
 * maxReachedChapter = max(currentChapter, semua jejak.chapter + 1).
 * Ini mencegah judul bab yang belum dijangkau bocor ke pembaca (spoiler gate).
 */
export async function listChapterMetadatas(storyId: string): Promise<{
  chapters: { number: number; title: string }[]
  maxReachedChapter: number
}> {
  storyId = normalizeStoryRouteId(storyId)
  const story = await getStory(storyId)
  if (!story) return { chapters: [], maxReachedChapter: 1 }

  // Hitung maxReachedChapter: nilai terjauh antara currentChapter dan bab+1 dari jejak
  const fromJejak =
    story.jejak.length > 0
      ? Math.max(...story.jejak.map((j) => j.chapter + 1))
      : 0
  const maxReached = Math.max(story.currentChapter, fromJejak, 1)

  const chapters = await queryChapterMetadatas(storyId, maxReached)
  return { chapters, maxReachedChapter: maxReached }
}
