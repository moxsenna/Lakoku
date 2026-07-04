import { notFound, redirect } from 'next/navigation'
import { getStory, getChapter, listStories } from '@/lib/api'
import { ReaderView } from '@/components/reader-view'

export async function generateStaticParams() {
  const stories = await listStories()
  return stories.map((s) => ({ id: s.id }))
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
  // Bila bab yang diminta belum tersedia (konten fixtures terbatas),
  // kembali ke halaman detail dengan anggun—jangan tampilkan error.
  if (!chapter) redirect(`/cerita/${story.id}`)

  return <ReaderView key={chapter.number} story={story} chapter={chapter} />
}
