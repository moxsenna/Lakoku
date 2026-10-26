import { getPublicStoryPreview } from '@/lib/api/public-preview'
import { OG_SIZE, renderStoryCard } from '@/lib/og/story-card'

export const alt = 'Cerita interaktif di Lakoku'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
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
