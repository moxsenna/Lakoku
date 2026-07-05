import Link from 'next/link'
import Image from 'next/image'
import { Drama, GitFork, Flame } from 'lucide-react'

const values = [
  {
    icon: Drama,
    title: 'Jalani peranmu',
    desc: 'Kamu masuk ke cerita sebagai tokoh utama—bukan sekadar mengikuti tokoh lain.',
  },
  {
    icon: GitFork,
    title: 'Pilihanmu menentukan',
    desc: 'Setiap keputusan mengubah hubungan, membuka rahasia, dan membentuk jalur ceritamu.',
  },
  {
    icon: Flame,
    title: 'Hadapi akibatnya',
    desc: 'Akhir cerita yang kamu capai adalah hasil dari siapa dirimu di dalam cerita.',
  },
]

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="relative h-[46svh] w-full overflow-hidden">
        <Image
          src="/covers/pesan-terakhir.png"
          alt=""
          fill
          priority
          sizes="448px"
          className="object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/60 to-background" />
        <header className="absolute left-6 top-8">
          <span className="font-serif text-2xl tracking-tight text-foreground">lakoku</span>
        </header>
      </div>

      <section className="lk-fade-up -mt-10 flex flex-1 flex-col gap-8 px-6 pb-10">
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-4xl leading-tight text-foreground text-balance">
            Kamu bukan sekadar pembaca. Kamu adalah tokoh utamanya.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Masuk ke cerita, ambil keputusan, dan lihat hidup tokohmu berubah karena pilihanmu.
          </p>
        </div>

        <ul className="flex flex-col gap-4">
          {values.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex items-start gap-4 rounded-2xl bg-card p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-col gap-3">
          <Link
            href="/mulai"
            className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Masuk ke Cerita Pertamaku
          </Link>
          <Link
            href="/beranda"
            className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
          >
            Jelajahi Cerita
          </Link>
        </div>
      </section>
    </main>
  )
}
