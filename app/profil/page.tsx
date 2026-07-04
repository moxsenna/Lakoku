import Link from 'next/link'
import {
  BookOpenText,
  ChevronRight,
  Footprints,
  KeyRound,
  Palette,
  ShieldCheck,
  Ticket,
  Trophy,
} from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { listStories, getStory } from '@/lib/api'

const settings = [
  { icon: Palette, label: 'Tema dan Ukuran Teks', desc: 'Atur kenyamanan membacamu' },
  { icon: Ticket, label: 'Akses Cerita', desc: 'Kelola akses ceritamu' },
  { icon: ShieldCheck, label: 'Batas Konten', desc: 'Tentukan batas cerita yang nyaman untukmu' },
  { icon: KeyRound, label: 'Akun dan Privasi', desc: 'Email, kata sandi, dan datamu' },
]

export default async function ProfilPage() {
  const stories = await listStories()
  const details = await Promise.all(stories.map((s) => getStory(s.id)))
  const totalBerjalan = stories.filter((s) => s.status === 'BERJALAN').length
  const totalSelesai = stories.filter((s) => s.status === 'SELESAI').length
  const totalPilihan = details.reduce((n, s) => n + (s?.jejak.length ?? 0), 0)

  return (
    <AppShell>
      <main className="flex flex-col gap-8 px-5 pt-8">
        <header className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-secondary font-serif text-xl text-secondary-foreground"
          >
            R
          </span>
          <div className="flex flex-col">
            <h1 className="font-serif text-2xl text-foreground">Rani</h1>
            <p className="text-xs text-muted-foreground">Tokoh utama sejak Maret 2026</p>
          </div>
        </header>

        <section aria-label="Perjalananmu" className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-card p-4 text-center">
            <BookOpenText className="size-5 text-primary" aria-hidden="true" />
            <span className="font-serif text-2xl text-foreground">{totalBerjalan}</span>
            <span className="text-[11px] text-muted-foreground">Cerita Berjalan</span>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-card p-4 text-center">
            <Trophy className="size-5 text-gold" aria-hidden="true" />
            <span className="font-serif text-2xl text-foreground">{totalSelesai}</span>
            <span className="text-[11px] text-muted-foreground">Akhir Dicapai</span>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-card p-4 text-center">
            <Footprints className="size-5 text-mauve" aria-hidden="true" />
            <span className="font-serif text-2xl text-foreground">{totalPilihan}</span>
            <span className="text-[11px] text-muted-foreground">Pilihan Penting</span>
          </div>
        </section>

        <section aria-labelledby="pengaturan-heading" className="flex flex-col gap-3">
          <h2 id="pengaturan-heading" className="text-sm font-semibold tracking-wide text-lavender">
            PENGATURAN
          </h2>
          <ul className="flex flex-col overflow-hidden rounded-2xl bg-card">
            {settings.map(({ icon: Icon, label, desc }, i) => (
              <li key={label} className={i > 0 ? 'border-t border-border' : ''}>
                <button
                  type="button"
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/50"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className="truncate text-xs text-muted-foreground">{desc}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-4 flex flex-col gap-3">
          <Link
            href="/"
            className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
          >
            Keluar
          </Link>
          <p className="text-center text-[11px] text-muted-foreground">
            lakoku — Novel Interaktif · Versi 0.2 (Prototype)
          </p>
        </section>
      </main>
    </AppShell>
  )
}
