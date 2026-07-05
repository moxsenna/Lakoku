import { notFound } from 'next/navigation'
import { getStory, getChapter, getChapterAvailability, listStoryIds } from '@/lib/api/server'
import { ReaderView } from '@/components/reader-view'
import { ChapterUnavailable } from '@/components/chapter-unavailable'

export async function generateStaticParams() {
  const ids = await listStoryIds()
  return ids.map((id) => ({ id }))
}

export default async function BacaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ bab?: string }>
}) {
  const { id } = await params
  const { bab } = await searchParams
  const story = await getStory(id)
  if (!story) notFound()

  // Nomor bab dari query (mis. saat "Lanjut ke Bab N"); default = posisi terkini.
  const requested = bab ? Number.parseInt(bab, 10) : undefined
  const target = Number.isFinite(requested) ? requested : undefined

  const chapter = await getChapter(story.id, target)
  // Bila bab yang diminta belum tersedia, tampilkan layar reader-safe yang tepat
  // (sedang ditulis vs sedang dirapikan)—jangan dialihkan diam-diam ke detail.
  if (!chapter) {
    const targetNumber = target ?? story.currentChapter
    const availability = await getChapterAvailability(story.id, targetNumber)
    return (
      <ChapterUnavailable
        story={story}
        chapterNumber={targetNumber}
        state={availability === 'PREPARING' ? 'PREPARING' : 'UNAVAILABLE'}
      />
    )
  }

  return <ReaderView key={chapter.number} story={story} chapter={chapter} />
}


export const runtime = 'edge';
