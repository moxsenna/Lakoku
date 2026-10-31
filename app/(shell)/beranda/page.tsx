import Link from 'next/link'
import Image from 'next/image'
import { Coins, Feather, Play } from 'lucide-react'
import { ResumeChapter } from '@/components/resume-chapter'
import { TasteProfileFirstRunGate } from '@/components/onboarding/taste-profile-first-run-gate'
import { listExploreStories, listMyLibraryStories, listPublicUserStories } from '@/lib/api/server'
import { listPublicShareTeasers } from '@/lib/api/share'
import { getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance } from '@/lib/credits/server'
import { getTintaBalance } from '@/lib/tinta/server'
import { AdsenseBanner } from '@/components/ads/adsense-banner'
import { resolveAdSlot } from '@/lib/ads/server'

export const dynamic = 'force-dynamic'

// Keputusan PM (2026-10-31): section "Dari Pembaca Lain" kembali tampil di
// beranda (disembunyikan sementara saat arah "Panggung Tunggal"). Set false
// bila ingin disembunyikan lagi; tidak ada perubahan lain yang diperlukan.
const SHOW_DARI_PEMBACA_LAIN = true

/** Jam WIB (UTC+7) — seluruh pembaca berada di Indonesia. */
function hourWib(): number {
  return (new Date().getUTCHours() + 7) % 24
}

function greetingByHour(hour: number): string {
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 18) return 'Selamat sore'
  return 'Selamat malam'
}

export default async function BerandaPage() {
  const user = await getSessionUser()
  const [library, explore, publicShares, publicUserStories, creditBalance, tintaBalance] =
    await Promise.all([
      listMyLibraryStories(),
      listExploreStories(),
      listPublicShareTeasers(6).catch(() => []),
      SHOW_DARI_PEMBACA_LAIN ? listPublicUserStories(12).catch(() => []) : Promise.resolve([]),
      user ? getCreditBalance(user.id) : Promise.resolve(0),
      user
        ? getTintaBalance(user.id)
        : Promise.resolve({ total: 0, available: 0, pending: 0 }),
    ])
  const adSlot = await resolveAdSlot({ slotKey: 'beranda', userId: user?.id })

  const berjalan = library.find((s) => s.status === 'BERJALAN')
  const featured = explore.find((s) => s.id !== berjalan?.id) ?? explore[0]
  const rail = explore.filter((s) => s.id !== berjalan?.id).slice(0, 8)
  const shares = publicShares.slice(0, 3)

  const metadataName =
    typeof user?.user_metadata?.name === 'string' ? user.user_metadata.name.trim() : ''
  const displayName = metadataName || user?.email?.split('@')[0] || 'Tamu'
  const greeting = `${greetingByHour(hourWib())}, ${displayName}`

  return (
    <main className="flex flex-col gap-8 px-5 pt-8">
      <TasteProfileFirstRunGate next="/beranda" />

      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold lowercase tracking-wide text-muted-foreground">
            lakoku
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/kredit"
              title="Saldo Lakoin"
              aria-label={`Saldo Lakoin: ${creditBalance}`}
              className="flex min-h-8 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-secondary/60"
            >
              <Coins className="size-3.5 text-gold" aria-hidden="true" />
              {creditBalance}
            </Link>
            <Link
              href="/profil/tinta"
              title="Saldo Tinta"
              aria-label={`Saldo Tinta: ${tintaBalance.available}`}
              className="flex min-h-8 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-secondary/60"
            >
              <Feather className="size-3.5 text-primary" aria-hidden="true" />
              {tintaBalance.available}
            </Link>
          </div>
        </div>
        <h1 className="font-serif text-3xl leading-tight tracking-tight text-foreground">
          {greeting}.
        </h1>
        <p className="text-xs text-muted-foreground">
          {berjalan ? 'Bab selanjutnya sudah menunggumu.' : 'Setiap cerita, kamu tokoh utamanya.'}
        </p>
      </header>

      {berjalan ? (
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
                src={
                  berjalan.cover && berjalan.cover !== '/placeholder.svg'
                    ? berjalan.cover
                    : '/covers/default-cover.webp'
                }
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
      ) : (
        featured && (
          <section aria-labelledby="mulai-heading" className="lk-fade-up">
            <h2 id="mulai-heading" className="sr-only">
              Pilihan Lakoku
            </h2>
            <Link
              href={`/cerita/${featured.id}`}
              className="group relative block overflow-hidden rounded-3xl"
            >
              <div className="relative aspect-[4/5] w-full">
                <Image
                  src={
                    featured.cover && featured.cover !== '/placeholder.svg'
                      ? featured.cover
                      : '/covers/default-cover.webp'
                  }
                  alt={`Sampul cerita ${featured.title}`}
                  fill
                  priority
                  sizes="448px"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
              </div>
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6">
                <span className="w-fit rounded-full bg-gold/20 px-3 py-1 text-[11px] font-semibold tracking-wide text-gold backdrop-blur">
                  PILIHAN LAKOKU
                </span>
                <h3 className="font-serif text-3xl leading-tight text-cream text-balance">
                  {featured.title}
                </h3>
                <p className="text-sm leading-relaxed text-cream/80">{featured.tagline}</p>
                <span className="mt-1 flex min-h-12 w-fit items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
                  <Play className="size-4" aria-hidden="true" />
                  Jalani Cerita Ini
                </span>
              </div>
            </Link>
          </section>
        )
      )}

      {adSlot.shouldRender && <AdsenseBanner clientId={adSlot.clientId} slotId={adSlot.slotId} />}

      {rail.length > 0 && (
        <section aria-labelledby="rail-heading" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 id="rail-heading" className="font-serif text-xl text-foreground">
              Setelah ini, coba…
            </h2>
            <Link href="/jelajah" className="text-xs font-medium text-primary">
              Semua cerita
            </Link>
          </div>
          <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {rail.map((story) => (
              <Link
                key={story.id}
                href={`/cerita/${story.id}`}
                className="group w-28 shrink-0 snap-start"
              >
                <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted">
                  <Image
                    src={
                      story.cover && story.cover !== '/placeholder.svg'
                        ? story.cover
                        : '/covers/default-cover.webp'
                    }
                    alt={`Sampul cerita ${story.title}`}
                    fill
                    sizes="112px"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </div>
                <span className="mt-2 block truncate text-xs font-medium text-foreground">
                  {story.title}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {shares.length > 0 && (
        <section aria-labelledby="dibagikan-heading" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 id="dibagikan-heading" className="font-serif text-xl text-foreground">
              Sedang Dibagikan
            </h2>
            <Link href="/jelajah" className="text-xs font-medium text-primary">
              Lihat semua di Jelajah →
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {shares.map((share) => (
              <Link
                key={share.id}
                href={`/s/${share.shareSlug}`}
                className="flex flex-col gap-2 rounded-2xl bg-card p-4 transition-colors hover:bg-secondary/40"
              >
                <span className="w-fit rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-gold">
                  DIBAGIKAN · {share.teaser.endingName ?? 'ENDING'}
                </span>
                <span className="font-serif text-lg text-foreground">{share.teaser.title}</span>
                {share.teaser.tagline && (
                  <span className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {share.teaser.tagline}
                  </span>
                )}
                <span className="text-xs font-medium text-primary">{share.teaser.cta} →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {SHOW_DARI_PEMBACA_LAIN && publicUserStories.length > 0 && (
        <section aria-labelledby="pembaca-lain-heading" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 id="pembaca-lain-heading" className="font-serif text-xl text-foreground">
              Dari Pembaca Lain
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {publicUserStories.map((story) => (
              <div key={story.id} className="relative">
                <div className="pointer-events-none absolute right-3 top-3 z-10">
                  <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-gold">
                    DARI PENULIS
                  </span>
                </div>
                <Link
                  href={`/cerita/${story.id}`}
                  className="flex flex-col gap-2 rounded-2xl bg-card p-4 transition-colors hover:bg-secondary/40"
                >
                  <span className="font-serif text-lg text-foreground">{story.title}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {story.tagline}
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mb-4 text-center text-[11px] text-muted-foreground">
        Lakoku — Novel Interaktif
      </p>
    </main>
  )
}
