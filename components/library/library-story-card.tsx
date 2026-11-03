import Link from 'next/link'
import Image from 'next/image'
import { resolveStoryCover } from '@/lib/api'
import { libraryChapterLabel, libraryProgressPercent } from '@/lib/library/order'
import type { LibraryStoryItem } from '@/lib/library/types'

/**
 * Kartu padat Koleksiku: sampul, judul, bar progres, label bab.
 * Tanpa badge, tagline, atau trope — sengaja, supaya daftar panjang tetap
 * bisa dipindai cepat.
 */
export function LibraryStoryCard({ story }: { story: LibraryStoryItem }) {
  const percent = libraryProgressPercent(story)
  const done = story.status === 'SELESAI'

  return (
    <Link
      href={`/cerita/${story.id}`}
      className="group flex items-center gap-3 rounded-2xl bg-card p-2.5 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
        <Image
          src={resolveStoryCover(story.cover)}
          alt={`Sampul cerita ${story.title}`}
          fill
          sizes="64px"
          className="object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <h3 className="line-clamp-2 font-serif text-sm leading-snug text-foreground">
          {story.title}
        </h3>
        <div className="flex items-center gap-2">
          <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-secondary">
            <div
              className={done ? 'h-full bg-gold' : 'h-full bg-primary'}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{libraryChapterLabel(story)}</span>
        </div>
      </div>
    </Link>
  )
}
