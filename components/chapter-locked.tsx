'use client'

import { useEffect, useState } from 'react'
import { trackEvent } from '@/lib/analytics/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Coins, Lock, Sparkles } from 'lucide-react'
import type { StoryDetail } from '@/lib/api'

/**
 * Layar reader-safe saat sebuah bab berbayar belum dibuka pembaca.
 * Menawarkan buka-dengan-kredit (bila saldo cukup) atau beli kredit.
 * Untuk novel katalog, menawarkan opsi buka per bab atau paket seluruh novel.
 */
export function ChapterLocked({
  story,
  chapterNumber,
  cost,
  balance,
  bundleQuote,
}: {
  story: StoryDetail
  chapterNumber: number
  cost: number
  balance: number
  bundleQuote?: {
    price: number
    savings: number
  } | null
}) {
  const router = useRouter()
  const [loadingChapter, setLoadingChapter] = useState(false)
  const [loadingBundle, setLoadingBundle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insufficient, setInsufficient] = useState(balance < cost)

  useEffect(() => {
    trackEvent('paywall_viewed', {
      story_id: story.id,
      chapter_number: chapterNumber,
      placement: 'locked_chapter',
    })
  }, [story.id, chapterNumber])

  async function unlockChapter() {
    if (loadingChapter || loadingBundle) return
    setLoadingChapter(true)
    setError(null)
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter: chapterNumber }),
      })
      if (res.ok) {
        router.refresh()
        return
      }
      if (res.status === 402) {
        setInsufficient(true)
        setError('Lakoinmu belum cukup.')
      } else {
        setError('Gagal membuka bab. Coba lagi.')
      }
    } catch {
      setError('Gagal terhubung. Coba lagi.')
    }
    setLoadingChapter(false)
  }

  async function unlockBundle() {
    if (loadingChapter || loadingBundle || !bundleQuote) return
    if (balance < bundleQuote.price) {
      router.push(`/kredit?kembali=${encodeURIComponent(`/baca/${story.id}?bab=${chapterNumber}`)}`)
      return
    }
    setLoadingBundle(true)
    setError(null)
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}/bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        router.refresh()
        return
      }
      if (res.status === 402) {
        setError('Lakoinmu belum cukup untuk paket novel.')
      } else {
        setError('Gagal membeli paket novel. Coba lagi.')
      }
    } catch {
      setError('Gagal terhubung. Coba lagi.')
    }
    setLoadingBundle(false)
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link
          href={`/cerita/${story.id}`}
          aria-label="Kembali ke detail cerita"
          className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <span className="truncate text-xs font-medium text-foreground">{story.title}</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-secondary text-primary">
          <Lock className="size-7" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Bab {chapterNumber} terkunci
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            {bundleQuote
              ? `Buka bab ini dengan ${cost} Lakoin atau miliki seluruh bab novel ini sekali bayar.`
              : `Buka bab ini dengan ${cost} Lakoin untuk melanjutkan kisahmu.`}
          </p>
        </div>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Coins className="size-4 text-gold" aria-hidden="true" />
          Saldo Lakoinmu: <strong className="text-foreground">{balance}</strong>
        </span>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex w-full flex-col gap-3">
          {bundleQuote && (
            <button
              type="button"
              onClick={unlockBundle}
              disabled={loadingChapter || loadingBundle}
              className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-amber-600 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {loadingBundle
                ? 'Membeli paket…'
                : `Buka semua bab (${bundleQuote.price} Lakoin${bundleQuote.savings > 0 ? `, hemat ${bundleQuote.savings}` : ''})`}
            </button>
          )}

          {insufficient ? (
            <Link
              href={`/kredit?kembali=${encodeURIComponent(`/baca/${story.id}?bab=${chapterNumber}`)}`}
              className="flex min-h-13 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Beli Lakoin
            </Link>
          ) : (
            <button
              type="button"
              onClick={unlockChapter}
              disabled={loadingChapter || loadingBundle}
              className={
                bundleQuote
                  ? 'flex min-h-13 w-full items-center justify-center rounded-2xl border border-primary bg-primary/10 px-6 text-sm font-semibold text-primary transition-opacity hover:opacity-90 disabled:opacity-60'
                  : 'flex min-h-13 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60'
              }
            >
              {loadingChapter ? 'Membuka…' : `Buka bab ini (${cost} Lakoin)`}
            </button>
          )}
        </div>

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
