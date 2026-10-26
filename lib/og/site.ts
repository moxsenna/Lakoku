/** Origin publik untuk URL absolut (metadataBase, sitemap, OG). */
export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.SITE_URL?.trim()
  if (raw) {
    try {
      return new URL(raw).origin
    } catch {
      // Nilai env rusak: pakai domain produksi.
    }
  }
  return 'https://lakoku.biz.id'
}

/** Potong teks untuk kartu OG tanpa memotong di tengah kata bila bisa. */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Gambar sampul yang bisa dirender ImageResponse (PNG/JPEG absolut). */
export function ogCoverUrl(cover: string | undefined | null): string | null {
  if (!cover || cover === '/placeholder.svg') return null
  const path = cover.split('?')[0].toLowerCase()
  if (!/\.(png|jpe?g)$/.test(path)) return null
  try {
    return new URL(cover, siteOrigin()).toString()
  } catch {
    return null
  }
}
