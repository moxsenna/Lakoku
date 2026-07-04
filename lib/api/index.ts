/**
 * Titik masuk tunggal lapisan data Lakoku (LD-CONTRACT-SEAM).
 *
 * - Komponen CLIENT ("use client") mengimpor dari sini: fungsi di `client.ts`
 *   memanggil Reader API (route handlers) via fetch.
 * - Halaman SERVER (RSC) mengimpor dari '@/lib/api/server' yang membaca
 *   Supabase langsung (tanpa lompatan HTTP ekstra).
 * - Kontrak tipe tunggal di `types.ts` dipakai keduanya.
 */
export * from './types'
export {
  listStories,
  getStory,
  getChapter,
  submitChoice,
} from './client'
export {
  getLocalProgress,
  recordChapterReached,
  getResumeChapter,
  subscribeProgress,
} from './progress'
