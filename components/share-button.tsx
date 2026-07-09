'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'

export function ShareButton({
  title,
  endingName,
}: {
  title: string
  endingName?: string
}) {
  const [message, setMessage] = useState<string | null>(null)

  async function share() {
    const text = `Aku mencapai akhir "${endingName ?? 'Akhir Cerita'}" di ${title}.`
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        setMessage('Dibagikan.')
        return
      }
      await navigator.clipboard.writeText(`${text} ${url}`)
      setMessage('Link disalin.')
    } catch {
      setMessage('Belum bisa dibagikan.')
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-1">
      <button
        type="button"
        onClick={share}
        className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card"
      >
        <Share2 className="size-4" aria-hidden="true" />
        Bagikan
      </button>
      {message && (
        <span className="text-center text-[11px] text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  )
}
