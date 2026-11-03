import { getPublicStoryPreview } from '@/lib/api/public-preview'
import { renderStoryCard } from '@/lib/og/story-card'

/**
 * Kartu OG halaman detail cerita. Sengaja route handler biasa, bukan file
 * convention `opengraph-image.tsx`: rute metadata di dalam route group
 * `(shell)` tidak terdaftar pada Next 16.2.6 (404 permanen, terbukti juga
 * di build produksi). URL-nya didaftarkan manual di generateMetadata
 * halaman detail.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const story = await getPublicStoryPreview(id)
  return renderStoryCard({
    eyebrow: 'Novel interaktif · 50 bab',
    title: story?.title ?? 'Lakoku',
    subtitle: story?.tagline ?? 'Kamu tokoh utamanya. Pilihanmu menentukan akhir cerita.',
    highlight: story ? '3 bab pertama gratis' : null,
    cover: story?.cover ?? null,
  })
}
