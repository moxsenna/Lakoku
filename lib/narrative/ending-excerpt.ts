/**
 * Pure ending-excerpt helper — extracted agar bisa dipakai narrative-core
 * (continuation builder) tanpa melanggar boundary. Tidak ada IO, tidak ada
 * `server-only`. Aturan sebelumnya di `lib/runtime/choice-context.ts` hanya
 * membungkus; sekarang sumber kebenaran murni di sini.
 */

/** Bangun 3–5 paragraf penutup dari prosa FINAL (post-repair). */
export function buildEndingParagraphs(
  finalParagraphs: string[],
  titleFallback = '',
): string[] {
  const paragraphs = finalParagraphs.filter((p) => p.trim().length > 0)
  const slice = paragraphs.slice(-5)
  while (slice.length < 3) {
    slice.unshift(paragraphs[0] ?? titleFallback)
  }
  return slice
}
