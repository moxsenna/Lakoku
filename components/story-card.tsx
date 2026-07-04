import Link from 'next/link'
import Image from 'next/image'
import type { StorySummary } from '@/lib/api'

export function StoryCard({ story }: { story: StorySummary }) {
  const progress = Math.round((story.currentChapter / story.totalChapters) * 100)

  return (
    <Link
      href={`/cerita/${story.id}`}
      className="group flex gap-4 rounded-2xl bg-card p-3 transition-colors hover:bg-secondary/60"
    >
      <div className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-xl">
        <Image
          src={story.cover || '/placeholder.svg'}
          alt={`Sampul cerita ${story.title}`}
          fill
          sizes="80px"
          className="object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {story.status === 'SELESAI' ? (
              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-gold">
                AKHIR CERITA
              </span>
            ) : story.status === 'BARU' ? (
              <span className="rounded-full bg-mauve/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-mauve">
                CERITA BARU
              </span>
            ) : (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary">
                CERITA BERJALAN
              </span>
            )}
          </div>
          <h3 className="font-serif text-lg leading-snug text-foreground text-pretty">{story.title}</h3>
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{story.tagline}</p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={story.status === 'SELESAI' ? 'h-full bg-gold' : 'h-full bg-primary'}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            Bab {story.currentChapter}/{story.totalChapters}
          </span>
        </div>
      </div>
    </Link>
  )
}
