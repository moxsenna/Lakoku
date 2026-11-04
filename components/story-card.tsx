import Link from 'next/link'
import Image from 'next/image'
import { resolveStoryCover } from '@/lib/api'
import type { StorySummary } from '@/lib/api'

/**
 * Kartu grid Jelajah: sampul 9:16 jadi hero, judul di bawahnya.
 * Badge kurasi (RESMI/DARI PENULIS/AKHIR) jadi overlay di sudut sampul —
 * rak tetap padat tanpa kehilangan sinyal. Tagline & trope hidup di halaman
 * detail dan filter trope, bukan di kartu.
 */
export function StoryCard({
  story,
  href,
  badge,
}: {
  story: StorySummary
  /** Tujuan tautan opsional (mis. landing share); bawaan: detail cerita. */
  href?: string
  /** Badge kurasi yang menempel di sudut sampul; null/undefined = tanpa badge. */
  badge?: string | null
}) {
  return (
    <Link
      href={href ?? `/cerita/${story.id}`}
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
        {badge && (
          <span className="absolute right-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-cream">
            {badge}
          </span>
        )}
      </div>
      <h3 className="line-clamp-2 font-serif text-xs leading-snug text-foreground">
        {story.title}
      </h3>
    </Link>
  )
}
