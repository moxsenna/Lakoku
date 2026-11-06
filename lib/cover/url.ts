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

/** Key wajib polos: tanpa scheme, query, traversal, atau karakter aneh. */
const SAFE_COVER_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/

/**
 * Guard input sampul (audit M8): cerita publik tidak boleh memaksa browser
 * pembaca lain memuat gambar dari domain arbitrer. Diterima:
 *  - URL dengan base publik kita (dinormalisasi jadi key) dgn key polos;
 *  - object key polos dari putCover;
 *  - path lokal aset publik `/...` (legacy, dirender dari domain sendiri).
 * Ditola: URL absolut eksternal, protocol-relative `//`, traversal `..`,
 * scheme menyamar (javascript: dsb.).
 */
export function isSafeStoryCoverInput(input: string): boolean {
  if (!input) return false
  if (input.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    // Ada scheme — hanya izinkan bila URL-nya milik base publik kita.
    return coverKeyFromPublicUrl(input) !== null
  }
  // Audit M-A3: traversal dicek SEBELUM branch path lokal — dulu `/../x`
  // lolos karena `startsWith('/')` mengembalikan true lebih dulu.
  if (input.includes('..')) return false
  if (input.startsWith('/')) return true // path lokal publik (legacy)
  return SAFE_COVER_KEY_RE.test(input)
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
