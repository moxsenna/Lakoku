import Link from 'next/link'
import Image from 'next/image'
import { resolveStoryCover } from '@/lib/api'
import { libraryChapterLabel, libraryProgressPercent } from '@/lib/library/order'
import type { LibraryStoryItem } from '@/lib/library/types'

/**
 * Kartu grid Koleksiku: sampul 9:16 jadi hero, judul, bar progres, label bab.
 * Tanpa badge, tagline, atau trope — sengaja, supaya rak pribadi tetap
 * bisa dipindai cepat.
 */
export function LibraryStoryCard({ story }: { story: LibraryStoryItem }) {
  const percent = libraryProgressPercent(story)
  const done = story.status === 'SELESAI'

  return (
    <Link
      href={`/cerita/${story.id}`}
      className="group flex flex-col gap-1.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-muted shadow-md">
        <Image
          src={resolveStoryCover(story.cover)}
          alt={`Sampul cerita ${story.title}`}
          fill
          sizes="(max-width: 448px) 30vw, 128px"
          className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      </div>
      <h3 className="line-clamp-2 font-serif text-xs leading-snug text-foreground">
        {story.title}
      </h3>
      <div className="flex flex-col gap-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={done ? 'h-full bg-gold' : 'h-full bg-primary'}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">{libraryChapterLabel(story)}</span>
      </div>
    </Link>
  )
}
