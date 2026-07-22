import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Drama, GitFork, Flame, BookOpen, Shield } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Lakoku — Interactive Fiction / Novel Interaktif',
  description:
    'Lakoku is an interactive fiction web app. Read branching stories, make choices that change the plot, and save progress with email or Google sign-in. Lakoku: novel interaktif di web.',
  applicationName: 'Lakoku',
}

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

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="relative h-[42svh] w-full overflow-hidden">
        <Image
          src="/covers/pesan-terakhir.png"
          alt="Ilustrasi sampul cerita Lakoku"
          fill
          priority
          sizes="448px"
          className="object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/60 to-background" />
        <header className="absolute left-6 top-8 right-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Lakoku Logo"
              width={32}
              height={32}
              className="h-8 w-8 rounded-full object-cover shadow-sm"
            />
            <span className="font-serif text-2xl tracking-tight text-foreground">Lakoku</span>
          </Link>
          <Link
            href="/auth/login"
            className="text-xs font-semibold text-foreground/90 underline-offset-4 hover:underline"
          >
            Masuk
          </Link>
        </header>
      </div>

      <section className="lk-fade-up -mt-10 flex flex-1 flex-col gap-8 px-6 pb-10">
        <div className="flex flex-col gap-3">
          <span className="w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold tracking-wide text-primary">
            3 bab gratis - tanpa kartu
          </span>
          {/* Exact OAuth consent app name must appear as primary heading for Google branding checks. */}
          <h1 className="font-serif text-4xl leading-tight text-foreground text-balance">Lakoku</h1>
          <p className="font-serif text-2xl leading-snug text-foreground text-balance">
            Kamu bukan sekadar pembaca. Kamu adalah tokoh utamanya.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            <strong className="font-semibold text-foreground">Lakoku</strong> is an interactive
            fiction web app (novel interaktif). Sign in to read branching stories, make choices that
            change the plot, and save your progress. Use email or Google login so your account,
            reading history, and story preferences stay with you.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Lakoku adalah aplikasi novel interaktif di web. Masuk ke cerita, ambil keputusan, dan
            lihat hidup tokohmu berubah karena pilihanmu—bukan sekadar membaca, melainkan menjalani
            alurmu sendiri.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <BookOpen className="size-5" aria-hidden="true" />
            </span>
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <h2 className="text-sm font-semibold text-foreground">
                About Lakoku / Apa itu Lakoku?
              </h2>
              <p>
                <strong className="text-foreground">Purpose of this application:</strong> Lakoku
                provides interactive novels on the web. You create or pick a story, read chapters,
                and choose branches that change relationships, mysteries, and endings. Some story
                text is generated with AI models based on your inputs and choices.
              </p>
              <p>
                <strong className="text-foreground">Tujuan aplikasi:</strong> Lakoku menampilkan
                novel interaktif di web—membuat atau memilih cerita, membaca bab, dan memilih cabang
                yang mengubah hubungan, misteri, dan akhir. Sebagian konten disusun dengan bantuan
                model AI sesuai input dan pilihanmu.
              </p>
              <p>
                <strong className="text-foreground">Google Sign-In:</strong> optional login via
                Google shares your Google name, email, and profile photo so Lakoku can create or
                link your account and save progress. See the{' '}
                <Link href="/privacy" className="font-semibold text-primary">
                  Privacy Policy
                </Link>{' '}
                /{' '}
                <Link href="/privacy" className="font-semibold text-primary">
                  Kebijakan Privasi
                </Link>
                .
              </p>
            </div>
          </div>
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

        <footer className="flex flex-col gap-3 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          <p className="flex items-center justify-center gap-1.5">
            <Shield className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Akun &amp; data dilindungi sesuai kebijakan kami</span>
          </p>
          <p>
            <Link href="/privacy" className="font-semibold text-primary">
              Kebijakan Privasi
            </Link>
            {' · '}
            <Link href="/terms" className="font-semibold text-primary">
              Syarat Layanan
            </Link>
            {' · '}
            <Link href="/privacy" className="font-semibold text-primary">
              Privacy Policy
            </Link>
            {' · '}
            <Link href="/terms" className="font-semibold text-primary">
              Terms of Service
            </Link>
          </p>
          <p className="text-[11px]">© {new Date().getFullYear()} Lakoku</p>
        </footer>
      </section>
    </main>
  )
}
