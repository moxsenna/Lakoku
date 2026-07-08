/**
 * Kebijakan harga baca (kredit) — LOGIKA MURNI (tanpa I/O), agar bisa diuji.
 *
 * Nilai aktual disimpan di DB (tabel `reading_policy`) supaya bisa diubah KAPAN
 * PUN lewat Supabase Dashboard tanpa deploy ulang (lihat lib/credits/server.ts →
 * getReadingPolicy). Konstanta di bawah hanya DEFAULT cadangan bila baris DB
 * belum ada / gagal dibaca.
 *
 *   freeChapters       : jumlah bab awal yang gratis.
 *   creditsPerChapter  : biaya membuka satu bab berbayar.
 */
export interface ReadingPolicy {
  freeChapters: number
  creditsPerChapter: number
}

export const DEFAULT_READING_POLICY: ReadingPolicy = {
  freeChapters: 3,
  creditsPerChapter: 5,
}

/** true bila bab `n` gratis (tak perlu kredit). */
export function isChapterFree(n: number, policy: ReadingPolicy = DEFAULT_READING_POLICY): boolean {
  return n <= policy.freeChapters
}

/** Biaya kredit untuk membuka bab `n` (0 bila gratis). */
export function chapterCost(n: number, policy: ReadingPolicy = DEFAULT_READING_POLICY): number {
  return isChapterFree(n, policy) ? 0 : policy.creditsPerChapter
}

/** Referensi ledger idempoten untuk unlock sebuah bab. */
export function unlockRef(storyId: string, chapter: number): string {
  return `unlock:${storyId}:${chapter}`
}
