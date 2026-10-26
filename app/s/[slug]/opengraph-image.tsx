import { getShareBySlug } from '@/lib/api/share'
import { OG_SIZE, renderStoryCard } from '@/lib/og/story-card'

export const alt = 'Kartu akhir cerita Lakoku'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const share = await getShareBySlug(slug)
  const t = share?.teaser
  return renderStoryCard({
    eyebrow: 'Akhir yang dicapai temanmu',
    title: t?.title ?? 'Lakoku',
    subtitle: t?.tagline ?? 'Novel interaktif — pilihanmu menentukan akhir cerita.',
    highlight: t?.endingName ?? null,
    cover: t?.cover ?? null,
  })
}
