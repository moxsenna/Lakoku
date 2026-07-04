import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Footprints, Lock, RotateCcw, Share2 } from 'lucide-react'
import { getStory, listStories } from '@/lib/api'

export async function generateStaticParams() {
  const stories = await listStories()
  return stories.map((s) => ({ id: s.id }))
}

export default async function AkhirCeritaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const story = await getStory(id)
  if (!story || story.status !== 'SELESAI') notFound()

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="relative h-[44svh] w-full overflow-hidden">
        <Image
          src={story.cover || '/placeholder.svg'}
          alt={`Sampul cerita ${story.title}`}
          fill
          priority
          sizes="448px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/50 via-ink/20 to-background" />
        <Link
          href={`/cerita/${story.id}`}
          aria-label="Kembali ke detail cerita"
          className="absolute left-4 top-6 flex size-10 items-center justify-center rounded-full bg-ink/50 text-cream backdrop-blur"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
      </div>

      <section className="lk-fade-up -mt-12 flex flex-1 flex-col gap-6 px-5 pb-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="rounded-full border border-gold/40 bg-gold/10 px-4 py-1.5 text-[11px] font-semibold tracking-widest text-gold">
            AKHIR CERITA
          </span>
          <h1 className="font-serif text-4xl leading-tight text-foreground text-balance">
            {story.endingName}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Kamu telah mencapai akhir cerita <span className="text-foreground">{story.title}</span>.
            Tapi apakah ini akhir yang kamu inginkan?
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl bg-card p-5">
          <div className="flex items-center gap-2">
            <Footprints className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Jejak Pilihan yang Membentukmu</h2>
          </div>
          <ol className="flex flex-col gap-4">
            {story.jejak.map((j) => (
              <li key={j.chapter} className="flex flex-col gap-1 border-l-2 border-gold/50 pl-4">
                <span className="text-[11px] font-medium text-lavender">Bab {j.chapter}</span>
                <p className="text-sm font-medium text-foreground">{j.decision}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{j.consequence}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-border p-4">
          <Lock className="size-4 shrink-0 text-lavender" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Masih ada <span className="font-semibold text-foreground">3 akhir cerita lain</span>{' '}
            yang belum kamu temukan—termasuk satu akhir rahasia.
          </p>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <button
            type="button"
            className="flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Temukan Akhir Lain
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card"
            >
              <Share2 className="size-4" aria-hidden="true" />
              Bagikan
            </button>
            <Link
              href="/koleksiku"
              className="flex min-h-13 flex-1 items-center justify-center rounded-2xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card"
            >
              Ke Koleksiku
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
