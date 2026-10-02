// lib/cover/url.ts
/**
 * Rakitan URL publik sampul cerita.
 *
 * Sumber kebenaran di DB adalah object key relatif (`<storyId>/<stamp>.webp`).
 * URL publik dirakit dari `NEXT_PUBLIC_COVER_BASE` (custom domain bucket R2),
 * jadi pindah provider/CDN berikutnya cukup ganti env — DB tidak disentuh.
 * Bisa dipakai dari client maupun server (tidak ada import server-only).
 */

/** Sampul default untuk cerita tanpa cover (ringan, WebP untuk mobile). */
export const DEFAULT_STORY_COVER = '/covers/default-cover.webp'

/** Base publik bucket sampul, tanpa trailing slash ('' bila env belum diset). */
export function coverPublicBase(): string {
  return (process.env.NEXT_PUBLIC_COVER_BASE ?? '').replace(/\/+$/, '')
}

/** Rakit URL publik dari key; tanpa base, key dikembalikan apa adanya. */
export function coverPublicUrl(key: string): string {
  const base = coverPublicBase()
  return base ? `${base}/${key.replace(/^\/+/, '')}` : key
}

/** Kembalikan key bila URL berprefix base publik; selain itu null. */
export function coverKeyFromPublicUrl(url: string): string | null {
  const base = coverPublicBase()
  if (!base || !url.startsWith(`${base}/`)) return null
  return url.slice(base.length + 1)
}

/**
 * 4 cabang: kosong/placeholder → default; URL absolut (sisa legacy) atau
 * path lokal aset publik (diawali /) → apa adanya; selain itu dianggap key
 * relatif dan dirakit dengan base.
 */
export function resolveStoryCover(cover: string | null | undefined): string {
  if (!cover || cover.startsWith('/placeholder.svg')) return DEFAULT_STORY_COVER
  if (/^https?:\/\//i.test(cover) || cover.startsWith('/')) return cover
  return coverPublicUrl(cover)
}
