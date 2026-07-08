'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Coins, Lock } from 'lucide-react'
import type { StoryDetail } from '@/lib/api'

/**
 * Layar reader-safe saat sebuah bab berbayar belum dibuka pembaca.
 * Menawarkan buka-dengan-kredit (bila saldo cukup) atau beli kredit.
 */
export function ChapterLocked({
  story,
  chapterNumber,
  cost,
  balance,
}: {
  story: StoryDetail
  chapterNumber: number
  cost: number
  balance: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insufficient, setInsufficient] = useState(balance < cost)

  async function unlock() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/stories/${story.id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter: chapterNumber }),
      })
      if (res.ok) {
        router.refresh() // bab kini terbuka → server component menampilkannya
        return
      }
      if (res.status === 402) {
        setInsufficient(true)
        setError('Kreditmu belum cukup.')
      } else {
        setError('Gagal membuka bab. Coba lagi.')
      }
    } catch {
      setError('Gagal terhubung. Coba lagi.')
    }
    setLoading(false)
  }

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

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-secondary text-primary">
          <Lock className="size-7" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Bab {chapterNumber} terkunci
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Buka bab ini dengan {cost} kredit untuk melanjutkan kisahmu.
          </p>
        </div>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Coins className="size-4 text-gold" aria-hidden="true" />
          Saldo kreditmu: <strong className="text-foreground">{balance}</strong>
        </span>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {insufficient ? (
          <Link
            href="/kredit"
            className="flex min-h-13 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Beli kredit
          </Link>
        ) : (
          <button
            type="button"
            onClick={unlock}
            disabled={loading}
            className="flex min-h-13 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Membuka…' : `Buka bab (${cost} kredit)`}
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
