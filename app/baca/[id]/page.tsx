import { notFound } from 'next/navigation'
import { getStory, getChapter, getChapterAvailability } from '@/lib/api/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getReadingPolicy, getCreditBalance, isChapterUnlocked } from '@/lib/credits/server'
import { chapterCost } from '@/lib/credits/policy'
import { ReaderView } from '@/components/reader-view'
import { ChapterUnavailable } from '@/components/chapter-unavailable'
import { ChapterLocked } from '@/components/chapter-locked'
import { resolveReaderFallbackNotice } from '@/lib/reader-fallback'

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
  // Clamp >= 1: currentChapter 0 (legacy / belum mulai) tidak valid di reader.
  const requested = bab ? Number.parseInt(bab, 10) : undefined
  const rawTarget = Number.isFinite(requested) ? Number(requested) : story.currentChapter
  const targetNumber = Math.max(1, Math.min(story.totalChapters || 50, rawTarget || 1))

  const chapter = await getChapter(story.id, targetNumber)
  // Bila bab yang diminta belum tersedia, tampilkan layar reader-safe yang tepat
  // (sedang ditulis vs sedang dirapikan)—jangan dialihkan diam-diam ke detail.
  if (!chapter) {
    const availability = await getChapterAvailability(story.id, targetNumber)
    return (
      <ChapterUnavailable
        story={story}
        chapterNumber={targetNumber}
        state={availability === 'PREPARING' ? 'PREPARING' : 'UNAVAILABLE'}
      />
    )
  }

  // Gerbang berbayar: bab di luar kuota gratis harus sudah dibuka dengan kredit.
  const [user, policy] = await Promise.all([getSessionUser(), getReadingPolicy()])
  const unlocked = await isChapterUnlocked(user?.id ?? null, story.id, chapter.number, policy)
  if (!unlocked) {
    const balance = user ? await getCreditBalance(user.id) : 0
    return (
      <ChapterLocked
        story={story}
        chapterNumber={chapter.number}
        cost={chapterCost(chapter.number, policy)}
        balance={balance}
      />
    )
  }

  const fallbackFromChapter = resolveReaderFallbackNotice(requested, story.currentChapter, chapter.number)
  return (
    <ReaderView
      key={chapter.number}
      story={story}
      chapter={chapter}
      fallbackFromChapter={fallbackFromChapter}
    />
  )
}



export const dynamic = 'force-dynamic';
