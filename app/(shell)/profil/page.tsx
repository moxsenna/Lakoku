import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  BookOpenText,
  ChevronRight,
  Coins,
  Footprints,
  Trophy,
} from 'lucide-react'
import { listStories } from '@/lib/api/server'
import { getReaderStates, getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance, getReadingPolicy } from '@/lib/credits/server'

const ThemeToggle = dynamic(
  () => import('@/components/theme-toggle').then((mod) => mod.ThemeToggle),
)
const ProfileSettings = dynamic(
  () => import('@/components/profile-settings').then((mod) => mod.ProfileSettings),
)
const LogoutButton = dynamic(
  () => import('@/components/logout-button').then((mod) => mod.LogoutButton),
)

export default async function ProfilPage() {
  const user = await getSessionUser()
  const displayName = user?.email ? user.email.split('@')[0] : 'Tamu'
  const initial = displayName.charAt(0).toUpperCase()
  const [stories, readerStates] = await Promise.all([listStories(), getReaderStates()])
  const [creditBalance, policy] = await Promise.all([
    user ? getCreditBalance(user.id) : Promise.resolve(0),
    getReadingPolicy(),
  ])
  const totalBerjalan = stories.filter((s) => s.status === 'BERJALAN').length
  const totalSelesai = stories.filter((s) => s.status === 'SELESAI').length
  const totalPilihan = [...readerStates.values()].reduce((n, state) => n + state.jejak.length, 0)
  const hour = new Date().getHours()
  const greeting = hour < 11
    ? 'Selamat pagi'
    : hour < 15
      ? 'Selamat siang'
      : hour < 18
        ? 'Selamat sore'
        : 'Selamat malam'
  const activeStory = stories.find((s) => s.status === 'BERJALAN')
  const freeLeft = activeStory
    ? Math.max(0, policy.freeChapters - activeStory.currentChapter)
    : policy.freeChapters
  const freeChapterText = activeStory
    ? `${freeLeft} dari ${policy.freeChapters} bab gratis tersisa di ${activeStory.title}`
    : `${policy.freeChapters} bab pertama gratis di setiap cerita`

  return (
    <main className="flex flex-col gap-8 px-5 pt-8">
        <header className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-secondary font-serif text-xl text-secondary-foreground"
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="font-serif text-2xl text-foreground">{greeting}, {displayName}</h1>
            <p className="text-xs text-muted-foreground">
              {user
                ? 'Tokoh utama — jejakmu tersimpan di akun ini'
                : 'Mode tamu — masuk agar jejakmu tersimpan'}
            </p>
          </div>
          <ThemeToggle />
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

        {user && (
          <Link
            href="/kredit"
            className="flex items-center gap-4 rounded-2xl bg-card p-4 transition-colors hover:bg-secondary/50"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-gold">
              <Coins className="size-5" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">Kredit</span>
              <span className="text-xs text-muted-foreground">{freeChapterText}</span>
              <span className="text-xs text-muted-foreground">
                Saldo {creditBalance} · beli paket untuk buka bab
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        )}

        <ProfileSettings />

        <section className="mb-4 flex flex-col gap-3">
          {user ? (
            <LogoutButton />
          ) : (
            <div className="flex flex-col gap-3">
              <Link
                href="/auth/login"
                className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Masuk
              </Link>
              <Link
                href="/auth/sign-up"
                className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
              >
                Daftar
              </Link>
            </div>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            lakoku — Novel Interaktif · Versi 0.2 (Prototype)
          </p>
        </section>
    </main>
  )
}

