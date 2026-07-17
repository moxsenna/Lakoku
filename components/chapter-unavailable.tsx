'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { StoryDetail } from '@/lib/api'
import { startChapter } from '@/lib/api/client'

/**
 * Layar reader-safe saat sebuah bab belum bisa disajikan.
 *
 * Dua keadaan (tanpa membocorkan detail teknis apa pun):
 *  - `PREPARING`  : bab sedang ditulis → bahasa menenangkan + auto-refresh
 *                   berkala agar bab muncul begitu siap.
 *  - `UNAVAILABLE`: bab belum tersedia / cerita sedang dirapikan penulisnya →
 *                   tawarkan "coba lagi" dan jalan kembali yang jelas.
 *
 * Sesuai T7.3: bahasa aman, bab rusak tak pernah dipaksa tampil, dan pembaca
 * tak pernah menemui jalan buntu.
 */
export function ChapterUnavailable({
  story,
  chapterNumber,
  state,
}: {
  story: StoryDetail
  chapterNumber: number
  state: 'PREPARING' | 'UNAVAILABLE'
}) {
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)

  // Saat bab sedang disiapkan, periksa ulang berkala (server component akan
  // mengambil bab bila sudah terbit). Berhenti saat komponen dilepas.
  useEffect(() => {
    if (state !== 'PREPARING') return
    const timer = setInterval(() => router.refresh(), 6000)
    return () => clearInterval(timer)
  }, [state, router])

  async function retry() {
    setRetrying(true)
    setRetryNote(null)
    try {
      // Kick generation again (idempotent if lease held / chapter exists).
      const kicked = await startChapter(story.id, chapterNumber)
      if (!kicked.ok) {
        setRetryNote(kicked.error || 'Belum bisa memulai ulang penulisan.')
      } else {
        setRetryNote('Menulis ulang bab… halaman akan terbuka bila siap.')
      }
    } catch {
      setRetryNote('Belum bisa memulai ulang. Coba beberapa saat lagi.')
    }
    router.refresh()
    setTimeout(() => setRetrying(false), 2000)
  }

  const preparing = state === 'PREPARING'

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link
          href={`/cerita/${story.id}`}
          aria-label="Kembali ke detail cerita"
          className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <span className="truncate text-xs font-medium text-foreground">{story.title}</span>
      </header>

      <div
        className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-16 text-center"
        role="status"
        aria-live="polite"
      >
        <span
          className={
            preparing
              ? 'lk-pulse-soft font-serif text-2xl text-foreground'
              : 'font-serif text-2xl text-foreground'
          }
        >
          lakoku
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            {preparing
              ? 'Bab ini sedang ditulis.'
              : 'Cerita ini sedang dirapikan penulisnya.'}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            {preparing
              ? `Bab ${chapterNumber} sedang disusun dengan cermat agar tetap setia pada kisahmu. Halaman ini akan terbuka sendiri begitu babnya siap.`
              : `Bab ${chapterNumber} belum bisa ditampilkan sekarang. Kami menahannya sebentar demi menjaga cerita tetap utuh — coba lagi beberapa saat lagi.`}
          </p>
        </div>

        {retryNote ? (
          <p className="text-xs text-muted-foreground text-pretty">{retryNote}</p>
        ) : null}

        {preparing ? (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
              <div className="lk-pulse-soft h-full w-1/2 bg-primary" />
            </div>
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
              {retrying ? 'Memeriksa…' : 'Coba tulis ulang'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw
              className={retrying ? 'lk-pulse-soft size-4' : 'size-4'}
              aria-hidden="true"
            />
            {retrying ? 'Memeriksa…' : 'Coba lagi'}
          </button>
        )}

        <Link
          href={`/cerita/${story.id}`}
          className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
        >
          Kembali ke detail cerita
        </Link>
      </div>
    </main>
  )
}
