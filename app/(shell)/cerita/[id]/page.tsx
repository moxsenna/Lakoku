import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Footprints } from 'lucide-react'
import { ResumeChapter } from '@/components/resume-chapter'
import { getStory } from '@/lib/api/server'

export default async function CeritaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const story = await getStory(id)
  if (!story) notFound()

  return (
    <main className="flex flex-col">
        <div className="relative h-[52svh] w-full overflow-hidden">
          <Image
            src={story.cover || '/placeholder.svg'}
            alt={`Sampul cerita ${story.title}`}
            fill
            sizes="448px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-transparent to-background" />
          <Link
            href="/beranda"
            aria-label="Kembali ke Beranda"
            className="absolute left-4 top-6 flex size-10 items-center justify-center rounded-full bg-ink/50 text-cream backdrop-blur"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        </div>

        <section className="lk-fade-up -mt-8 flex flex-col gap-6 px-5 pb-8">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {story.tropes.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
            <h1 className="font-serif text-4xl leading-tight text-foreground text-balance">
              {story.title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {story.synopsis}
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
            <span className="text-[11px] font-semibold tracking-wide text-lavender">PERANMU</span>
            <p className="text-sm leading-relaxed text-foreground">{story.role}</p>
          </div>

          {story.jejak.length > 0 && (
            <div className="flex flex-col gap-4 rounded-2xl bg-card p-4">
              <div className="flex items-center gap-2">
                <Footprints className="size-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">Jejak Pilihan</h2>
              </div>
              <ol className="flex flex-col gap-4">
                {story.jejak.map((j) => (
                  <li key={j.chapter} className="flex flex-col gap-1 border-l-2 border-primary/40 pl-4">
                    <span className="text-[11px] font-medium text-lavender">Bab {j.chapter}</span>
                    <p className="text-sm font-medium text-foreground">{j.decision}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{j.consequence}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {story.status === 'SELESAI' ? (
            <Link
              href={`/akhir/${story.id}`}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-gold px-6 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Lihat Akhir Cerita: {story.endingName}
            </Link>
          ) : (
            <Link
              href={`/baca/${story.id}`}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {story.status === 'BARU' ? (
                'Mulai Cerita'
              ) : (
                <>
                  Lanjutkan Cerita — Bab{' '}
                  <ResumeChapter storyId={story.id} fallback={story.currentChapter} />
                </>
              )}
            </Link>
          )}
        </section>
    </main>
  )
}

