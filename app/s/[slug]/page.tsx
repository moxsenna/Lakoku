import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { BookOpen, Footprints, Sparkles, Trophy, Users } from 'lucide-react'
import { getShareBySlug } from '@/lib/api/share'
import { getSessionUser } from '@/lib/api/user-state'
import { StartFromShareButton } from '@/components/start-from-share-button'

export const dynamic = 'force-dynamic'

export default async function ShareLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const share = await getShareBySlug(slug)
  if (!share) notFound()

  const user = await getSessionUser()
  const t = share.teaser
  const ending = t.endingName ?? 'Akhir Cerita'

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="relative h-[40svh] w-full overflow-hidden">
        <Image
          src={t.cover && t.cover !== '/placeholder.svg' ? t.cover : '/covers/default-cover.webp'}
          alt={`Sampul ${t.title}`}
          fill
          priority
          sizes="448px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/20 to-background" />
      </div>

      <section className="lk-fade-up -mt-10 flex flex-1 flex-col gap-6 px-5 pb-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="rounded-full border border-gold/40 bg-gold/10 px-4 py-1.5 text-[11px] font-semibold tracking-widest text-gold">
            ENDING CARD
          </span>
          <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
            {t.title}
          </h1>
          {t.tagline && (
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {t.tagline}
            </p>
          )}
          {t.tropes.length > 0 && (
            <ul className="flex flex-wrap justify-center gap-2 pt-1">
              {t.tropes.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ending Card Highlight */}
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-gold/40 bg-gold/5 p-5 text-center">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gold">
            <Trophy className="size-3.5" aria-hidden="true" />
            Akhir yang Dicapai
          </div>
          <p className="font-serif text-xl font-bold text-gold text-balance">{ending}</p>
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            Temanmu menyelesaikan 50 bab dan sampai di akhir ini. Ada berbagai kemungkinan cabang dan
            akhir tersembunyi lain yang bisa kamu jelajahi.
          </p>
        </div>

        {/* Sinopsis Cerita */}
        {t.synopsis && (
          <div className="flex flex-col gap-3 rounded-2xl bg-card p-5">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-gold" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Sinopsis</h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {t.synopsis}
            </p>
          </div>
        )}

        {/* Tokoh Utama */}
        {t.cast && t.cast.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl bg-card p-5">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Tokoh Utama</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Tokoh-tokoh yang akan menyambut dan menguji keputusanmu.
            </p>
            <ul className="flex flex-col gap-2 pt-1">
              {t.cast.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3.5 py-2.5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 font-serif text-xs font-bold text-gold">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.role}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pilihan Awal / Dilema Pertama */}
        {t.bigChoices.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl bg-card p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-gold" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                Titik Awal di Jalur Mereka
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Non-spoiler — keputusan awal yang diambil pembaca sebelum cerita bercabang lebih jauh.
            </p>
            <ol className="flex flex-col gap-2">
              {t.bigChoices.map((label, i) => (
                <li
                  key={`${i}-${label}`}
                  className="rounded-xl border border-border/60 px-3 py-2 text-sm text-foreground"
                >
                  {label}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Penjelasan Interaktif */}
        <div className="flex items-center gap-3 rounded-2xl border border-border p-4">
          <Footprints className="size-5 shrink-0 text-lavender" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            Kamu <span className="font-semibold text-foreground">tidak membaca cerita pasif</span>.
            Kamu menjadi tokoh utama, memilih setiap keputusan, dan menentukan apakah kamu mencapai akhir
            yang sama atau akhir yang berbeda.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-auto flex flex-col gap-3">
          {user ? (
            <StartFromShareButton shareSlug={share.shareSlug} />
          ) : (
            <Link
              href={`/auth/login?next=${encodeURIComponent(`/s/${share.shareSlug}`)}`}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Masuk untuk {t.cta}
            </Link>
          )}
          <Link
            href="/beranda"
            className="flex min-h-12 items-center justify-center text-sm font-medium text-muted-foreground"
          >
            Kembali ke Beranda
          </Link>
        </div>
      </section>
    </main>
  )
}
