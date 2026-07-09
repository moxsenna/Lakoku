'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { actStartFromShare } from '@/app/share/actions'

export function StartFromShareButton({ shareSlug }: { shareSlug: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const result = await actStartFromShare(shareSlug)
      if (!result.ok) {
        setError(result.error)
        return
      }
      try {
        sessionStorage.setItem(
          'lakoku:share-start:v1',
          JSON.stringify({ shareSlug, startId: result.startId }),
        )
      } catch {
        // ignore
      }
      router.push(result.next)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Menyiapkan…' : 'Coba jalurmu sendiri'}
      </button>
      {error && (
        <p className="text-center text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
