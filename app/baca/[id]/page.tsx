import { notFound } from 'next/navigation'
import { getStory, getChapter, listStories } from '@/lib/api'
import { ReaderView } from '@/components/reader-view'

export async function generateStaticParams() {
  const stories = await listStories()
  return stories.map((s) => ({ id: s.id }))
}

export default async function BacaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const story = await getStory(id)
  if (!story) notFound()

  const chapter = await getChapter(story.id)
  if (!chapter) notFound()

  return <ReaderView story={story} chapter={chapter} />
}
