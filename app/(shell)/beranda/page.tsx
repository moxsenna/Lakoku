import Link from 'next/link'
import Image from 'next/image'
import { StoryCard } from '@/components/story-card'
import { ResumeChapter } from '@/components/resume-chapter'
import { TasteProfileFirstRunGate } from '@/components/onboarding/taste-profile-first-run-gate'
import { listExploreStories, listMyLibraryStories } from '@/lib/api/server'
import { listPublicShareTeasers } from '@/lib/api/share'
import { Play } from 'lucide-react'

// Request-time data (Supabase). Avoid CF Workers Builds prerender without build env.
export const dynamic = 'force-dynamic'

export default async function BerandaPage() {
  const [library, explore, publicShares] = await Promise.all([
    listMyLibraryStories(),
    listExploreStories(),
    listPublicShareTeasers(12).catch(() => []),
  ])
  const berjalan = library.find((s) => s.status === 'BERJALAN')
  // Jelajahi: demo resmi + share publik (AMENDMENTS v0.5).
  const jelajahi = explore.filter((s) => s.id !== berjalan?.id)

  return (
    <main className="flex flex-col gap-8 px-5 pt-8">
        <TasteProfileFirstRunGate next="/beranda" />
        <header className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-serif text-2xl tracking-tight text-foreground">lakoku</span>
            <p className="text-xs text-muted-foreground">Ceritamu menunggumu malam ini.</p>
          </div>
        </header>

        {berjalan && (
          <section aria-labelledby="lanjutkan-heading" className="lk-fade-up">
            <h2 id="lanjutkan-heading" className="sr-only">
              Lanjutkan Cerita
            </h2>
            <Link
              href={`/baca/${berjalan.id}`}
              className="group relative block overflow-hidden rounded-3xl"
            >
              <div className="relative aspect-[4/5] w-full">
                <Image
                  src={berjalan.cover || '/placeholder.svg'}
                  alt={`Sampul cerita ${berjalan.title}`}
                  fill
                  priority
                  sizes="448px"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
              </div>
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6">
                <span className="w-fit rounded-full bg-primary/20 px-3 py-1 text-[11px] font-semibold tracking-wide text-primary backdrop-blur">
                  CERITA BERJALAN — BAB{' '}
                  <ResumeChapter storyId={berjalan.id} fallback={berjalan.currentChapter} /> DARI{' '}
                  {berjalan.totalChapters}
                </span>
                <h3 className="font-serif text-3xl leading-tight text-cream text-balance">
                  {berjalan.title}
                </h3>
                <p className="text-sm leading-relaxed text-cream/80">{berjalan.tagline}</p>
                <span className="mt-1 flex min-h-12 w-fit items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
                  <Play className="size-4" aria-hidden="true" />
                  Lanjutkan Cerita
                </span>
              </div>
            </Link>
          </section>
        )}

        <section aria-labelledby="jelajahi-heading" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 id="jelajahi-heading" className="font-serif text-xl text-foreground">
              Jelajahi Cerita
            </h2>
            <Link href="/koleksiku" className="text-xs font-medium text-primary">
              Lihat Koleksiku
            </Link>
          </div>
          {jelajahi.length > 0 || publicShares.length > 0 ? (
            <div className="flex flex-col gap-3">
              {publicShares.map((share) => (
                <Link
                  key={share.id}
                  href={`/s/${share.shareSlug}`}
                  className="flex flex-col gap-2 rounded-2xl bg-card p-4 transition-colors hover:bg-secondary/40"
                >
                  <span className="w-fit rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-gold">
                    DIBAGIKAN · {share.teaser.endingName ?? 'ENDING'}
                  </span>
                  <span className="font-serif text-lg text-foreground">
                    {share.teaser.title}
                  </span>
                  {share.teaser.tagline && (
                    <span className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                      {share.teaser.tagline}
                    </span>
                  )}
                  <span className="text-xs font-medium text-primary">
                    {share.teaser.cta} →
                  </span>
                </Link>
              ))}
              {jelajahi.map((story) => (
                <StoryCard key={story.id} story={story} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
              <p className="text-sm text-muted-foreground">
                Belum ada cerita yang dibagikan. Mulai ceritamu sendiri, atau coba demo resmi.
              </p>
              <Link
                href="/mulai"
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Mulai Cerita Baru
              </Link>
            </div>
          )}
        </section>

        <section className="mb-4 flex flex-col items-start gap-3 rounded-3xl bg-secondary p-6">
          <h2 className="font-serif text-2xl leading-snug text-secondary-foreground text-balance">
            Cerita ini menunggumu mengambil peran.
          </h2>
          <p className="text-sm leading-relaxed text-secondary-foreground/70">
            Pilih peranmu, tentukan konflik yang ingin kamu jalani, dan mulai cerita yang dibentuk
            oleh pilihanmu sendiri.
          </p>
          <Link
            href="/mulai"
            className="mt-1 flex min-h-12 items-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Mulai Cerita Baru
          </Link>
        </section>

    </main>
  )
}
