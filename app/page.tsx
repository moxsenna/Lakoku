import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowDown, ArrowRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HeroChoice } from '@/components/landing/hero-choice'
import { Reveal } from '@/components/landing/reveal'

export const metadata: Metadata = {
  title: 'Lakoku — Kalau Ini Ceritamu, Apa yang Akan Kamu Lakukan?',
  description:
    'Cerita di mana kamu menjadi tokoh utamanya. Pilihanmu menentukan siapa yang mempercayaimu, rahasia apa yang kamu temukan, dan bagaimana semuanya berakhir. Novel interaktif berbahasa Indonesia — 3 bab pertama gratis.',
  applicationName: 'Lakoku',
}

const PRIMARY_BTN =
  'flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90'
const SECONDARY_BTN =
  'flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card'

const OUTCOMES = [
  'siapa yang mempercayaimu',
  'rahasia apa yang kamu temukan',
  'siapa yang tetap berada di sisimu',
  'dan bagaimana semuanya berakhir',
]

const PREMISES = [
  {
    no: '01',
    title: 'Pernikahan yang Seharusnya Sempurna',
    desc: 'Tiga hari sebelum pernikahanmu, sebuah foto lama muncul—dan seseorang di dalamnya seharusnya tidak pernah kamu kenal.',
  },
  {
    no: '02',
    title: 'Orang yang Pulang Setelah Tujuh Tahun',
    desc: 'Dia kembali membawa satu permintaan. Masalahnya, kamu pernah berjanji tidak akan pernah memaafkannya.',
  },
  {
    no: '03',
    title: 'Rumah yang Menyimpan Nama Keluargamu',
    desc: 'Warisan dari seseorang yang tidak pernah kamu kenal membuka rahasia yang seluruh keluargamu sembunyikan.',
  },
]

const TIMELINE = [
  { bab: 'Bab 3', text: 'Kamu menyembunyikan sebuah surat.' },
  { bab: 'Bab 18', text: 'Seseorang mulai mencurigaimu.' },
  { bab: 'Bab 37', text: 'Surat itu ditemukan.' },
  { bab: 'Bab 48', text: 'Kamu harus menjelaskan kenapa kamu berbohong.' },
]

const ENDINGS = [
  'Akhir: Yang Memilih Bertahan',
  'Akhir: Kebenaran Terakhir',
  'Akhir Rahasia',
]

export default function HomePage() {
  return (
    <main className="relative w-full overflow-x-clip">
      <div aria-hidden="true" className="lk-grain" />

      {/* 1. HERO — masuk ke dalam cerita dalam 5 detik */}
      <section className="relative flex min-h-svh flex-col overflow-hidden">
        <Image
          src="/covers/pesan-terakhir.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/30 to-background" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/60 to-transparent" />

        <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Lakoku Logo"
              width={32}
              height={32}
              className="size-8 rounded-full object-cover shadow-sm"
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

        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end gap-6 px-6 pb-12 pt-28">
          <div className="lk-fade-up flex flex-col gap-4">
            {/* Exact OAuth consent app name must appear inside the primary heading for Google branding checks. */}
            <h1 className="font-serif text-4xl leading-tight text-foreground text-balance sm:text-5xl">
              <span className="mb-4 block font-sans text-[11px] font-bold uppercase tracking-[0.35em] text-muted-foreground">
                Lakoku
              </span>
              Kalau ini ceritamu, apa yang akan kamu lakukan?
            </h1>
            <p className="font-serif text-lg leading-snug text-muted-foreground">
              Kamu bukan sekadar membaca kisah seseorang.{' '}
              <span className="text-foreground">Di sini, kamulah tokoh utamanya.</span>
            </p>
          </div>

          <HeroChoice />
        </div>
      </section>

      {/* 2. REVEAL — jelaskan Lakoku setelah pengunjung penasaran */}
      <section className="mx-auto w-full max-w-md px-6 py-20 sm:py-24">
        <Reveal className="flex flex-col gap-5">
          <h2 className="font-serif text-3xl leading-tight text-foreground text-balance">
            Cerita yang berbeda karena kamu.
          </h2>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">Bukan cuma memilih dialog.</p>
            <p className="text-sm text-muted-foreground">Pilihanmu bisa menentukan:</p>
          </div>
          <ul className="flex flex-col">
            {OUTCOMES.map((outcome, index) => (
              <li
                key={outcome}
                className={cn(
                  'border-l-2 py-2 pl-4 font-serif text-lg leading-snug',
                  index === OUTCOMES.length - 1
                    ? 'border-primary/60 text-primary'
                    : 'border-border text-foreground/85',
                )}
              >
                {outcome}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="mt-10" delay={120}>
          <div>
            <span className="inline-flex rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 font-serif text-base text-foreground">
              Kamu memilih untuk pergi
            </span>
            <div className="ml-5 mt-3 flex flex-col border-l border-border pl-6">
              <div className="relative py-2">
                <span aria-hidden="true" className="absolute -left-6 top-1/2 h-px w-6 bg-border" />
                <p className="text-sm text-muted-foreground">Dia kehilangan kepercayaan</p>
              </div>
              <div className="relative py-2">
                <span aria-hidden="true" className="absolute -left-6 top-1/2 h-px w-6 bg-border" />
                <p className="text-sm text-muted-foreground">Sebuah rahasia tetap tersembunyi</p>
              </div>
              <div className="relative py-2">
                <span aria-hidden="true" className="absolute -left-6 top-1/2 h-px w-6 bg-border" />
                <p className="text-sm font-semibold text-foreground">17 bab kemudian&hellip;</p>
                <ArrowDown aria-hidden="true" className="my-1 size-4 text-gold" />
                <p className="font-serif text-lg italic text-gold">seseorang datang kembali</p>
              </div>
            </div>
          </div>
          <p className="mt-8 font-serif text-xl leading-snug text-foreground text-balance">
            Pilihan kecil bisa kembali jauh setelah kamu melupakannya.
          </p>
        </Reveal>
      </section>

      {/* 3. Cerita seperti apa yang akan menemukanmu — jembatan ke /mulai */}
      <section className="mx-auto w-full max-w-md px-6 py-20 sm:py-24">
        <Reveal className="flex flex-col gap-4">
          <h2 className="font-serif text-3xl leading-tight text-foreground text-balance">
            Ceritamu belum ditulis.
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Beritahu sedikit tentang cerita yang ingin kamu jalani. Lakoku akan menyiapkan tiga
            kemungkinan untukmu.
          </p>
        </Reveal>
        <div className="mt-10 flex flex-col divide-y divide-border border-y border-border">
          {PREMISES.map((premise, index) => (
            <Reveal key={premise.no} delay={index * 90}>
              <Link href="/mulai" className="group flex items-start gap-5 py-6">
                <span className="pt-1 text-xs font-bold tracking-widest text-gold">
                  {premise.no}
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="font-serif text-xl leading-snug text-foreground transition-colors group-hover:text-primary">
                    {premise.title}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {premise.desc}
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10">
          <Link href="/mulai" className={PRIMARY_BTN}>
            Temukan Ceritaku
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Reveal>
      </section>

      {/* 4. Bukan cerita orang lain */}
      <section className="mx-auto w-full max-w-md px-6 py-20 sm:py-24">
        <Reveal className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border bg-card/60 p-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Novel biasa
            </span>
            <p className="mt-3 font-serif text-xl leading-snug text-muted-foreground/70 line-through decoration-foreground/40">
              &ldquo;Dia memutuskan untuk pergi.&rdquo;
            </p>
          </div>
          <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              Lakoku
            </span>
            <p className="mt-3 font-serif text-xl leading-snug text-foreground">
              Kamu harus memutuskan.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <span className="rounded-xl border border-border bg-background/60 px-4 py-3 text-sm font-medium text-foreground">
                Tinggal dan dengarkan kebenarannya?
              </span>
              <span className="text-center text-[11px] text-muted-foreground">atau</span>
              <span className="rounded-xl border border-border bg-background/60 px-4 py-3 text-sm font-medium text-foreground">
                Pergi sebelum semuanya terlambat?
              </span>
            </div>
          </div>
        </Reveal>
        <Reveal className="mt-10 flex flex-col gap-3">
          <h2 className="font-serif text-3xl leading-tight text-foreground text-balance">
            Bukan cerita tentang mereka. Tentang kamu.
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Kamu membaca akibat dari keputusan yang kamu buat sendiri.
          </p>
        </Reveal>
      </section>

      {/* 5. Proof of depth — 50 bab tanpa menjelaskan engine */}
      <section className="mx-auto w-full max-w-md px-6 py-20 sm:py-24">
        <Reveal>
          <h2 className="font-serif text-3xl leading-tight text-foreground text-balance">
            Dan ceritanya tidak melupakanmu.
          </h2>
        </Reveal>
        <ol className="ml-2 mt-10 flex flex-col border-l border-border">
          {TIMELINE.map((step) => (
            <li key={step.bab} className="relative pb-10 pl-7 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute -left-[6px] top-1 size-2.5 rounded-full border border-background bg-gold"
              />
              <Reveal delay={100} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-gold">
                  {step.bab}
                </span>
                <p className="font-serif text-lg leading-snug text-foreground">{step.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
        <Reveal className="mt-10 flex flex-col gap-2">
          <p className="font-serif text-xl leading-snug text-foreground">
            Keputusan lama bisa kembali. Hubungan berubah. Rahasia punya akibat.
          </p>
          <p className="text-sm text-muted-foreground">Cerita bergerak bersamamu sampai akhir.</p>
        </Reveal>
      </section>

      {/* 6. Social curiosity — teaser akhir, bukan testimonial generik */}
      <section className="mx-auto w-full max-w-md px-6 py-20 sm:py-24">
        <Reveal className="flex flex-col gap-2">
          <h2 className="font-serif text-3xl leading-tight text-foreground text-balance">
            Orang lain mungkin mendapat cerita yang sama.
          </h2>
          <p className="font-serif text-2xl leading-snug text-foreground">
            Tapi <span className="italic text-primary">belum tentu mendapat akhir yang sama.</span>
          </p>
        </Reveal>
        <ul className="mt-10 flex flex-col gap-3">
          {ENDINGS.map((ending, index) => (
            <Reveal key={ending} delay={index * 100}>
              <li className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-5 py-4">
                <Lock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-serif text-lg text-muted-foreground">{ending}</span>
              </li>
            </Reveal>
          ))}
        </ul>
        <Reveal className="mt-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Beberapa akhir hanya terbuka karena keputusan yang kamu buat jauh sebelumnya.
          </p>
        </Reveal>
      </section>

      {/* 7. Custom story — jalan utama tetap /mulai, /brainstorm sebagai mode lanjutan */}
      <section className="mx-auto w-full max-w-md px-6 py-20 sm:py-24">
        <Reveal className="flex flex-col gap-4">
          <h2 className="font-serif text-3xl leading-tight text-foreground text-balance">
            Sudah punya cerita di kepalamu?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Mulai dari idemu sendiri&mdash;tokoh, konflik, suasana, atau bahkan hanya satu
            kalimat.
          </p>
        </Reveal>
        <Reveal className="mt-8" delay={120}>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="font-serif text-base italic leading-relaxed text-foreground/90">
              &ldquo;Aku ingin cerita tentang perempuan yang kembali ke kota kecil setelah 10 tahun
              dan menemukan mantan tunangannya sudah menikah dengan sahabatnya.&rdquo;
              <span
                aria-hidden="true"
                className="lk-pulse-soft ml-1 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] bg-primary"
              />
            </p>
          </div>
        </Reveal>
        <Reveal className="mt-6 flex flex-col items-start gap-4" delay={200}>
          <Link href="/mulai" className={SECONDARY_BTN}>
            Bentuk dari idemu sendiri
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <p className="text-xs text-muted-foreground">
            Ingin mengatur ceritamu lebih dalam?{' '}
            <Link
              href="/brainstorm"
              className="font-semibold text-foreground underline-offset-4 hover:underline"
            >
              Gunakan mode lanjutan.
            </Link>
          </p>
        </Reveal>
      </section>

      {/* 8. Final CTA */}
      <section className="mx-auto w-full max-w-md px-6 py-28 text-center sm:py-36">
        <Reveal className="flex flex-col items-center gap-8">
          <h2 className="font-serif text-4xl leading-tight text-foreground text-balance">
            Satu pilihan. Lalu lihat seberapa jauh ceritamu berubah.
          </h2>
          <div className="flex w-full flex-col gap-3">
            <Link href="/mulai" className={PRIMARY_BTN}>
              Mulai Ceritaku
            </Link>
            <p className="text-xs text-muted-foreground">3 bab pertama gratis · tidak perlu kartu</p>
          </div>
          <Link
            href="/auth/login"
            className="text-sm font-semibold text-foreground/90 underline-offset-4 hover:underline"
          >
            Sudah punya cerita? Masuk
          </Link>
        </Reveal>
      </section>

      {/* Footer + disclosure aplikasi (dipertahankan untuk verifikasi OAuth Google) */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-10 text-xs leading-relaxed text-muted-foreground">
          <h2 className="text-sm font-semibold text-foreground">Tentang aplikasi ini</h2>
          <p>
            <strong className="text-foreground">Purpose of this application:</strong> Lakoku
            provides interactive novels on the web. You create or pick a story, read chapters, and
            choose branches that change relationships, mysteries, and endings. Some story text is
            generated with AI models based on your inputs and choices.
          </p>
          <p>
            <strong className="text-foreground">Tujuan aplikasi:</strong> Lakoku menampilkan novel
            interaktif di web&mdash;membuat atau memilih cerita, membaca bab, dan memilih cabang
            yang mengubah hubungan, misteri, dan akhir. Sebagian konten disusun dengan bantuan model
            AI sesuai input dan pilihanmu.
          </p>
          <p>
            <strong className="text-foreground">Google Sign-In:</strong> optional login via Google
            shares your Google name, email, and profile photo so Lakoku can create or link your
            account and save progress. See the{' '}
            <Link href="/privacy" className="font-semibold text-primary">
              Privacy Policy
            </Link>{' '}
            /{' '}
            <Link href="/privacy" className="font-semibold text-primary">
              Kebijakan Privasi
            </Link>
            .
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
        </div>
      </footer>
    </main>
  )
}
