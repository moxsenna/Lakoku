'use client'

import { useState, useTransition } from 'react'
import { Share2 } from 'lucide-react'
import { actCreateEndingShare } from '@/app/share/actions'
import type { JejakItem } from '@/lib/api/types'

export function ShareButton({
  storyId,
  title,
  tagline,
  endingName,
  tropes = [],
  cover,
  jejak = [],
  bigChoices = [],
}: {
  storyId: string
  title: string
  tagline?: string
  endingName?: string
  tropes?: string[]
  cover?: string
  jejak?: JejakItem[]
  /** Prefetched labels for offline copy before link exists. */
  bigChoices?: string[]
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function buildShareText(path?: string): string {
    const ending = endingName ?? 'Akhir Cerita'
    const lines = [
      `Aku menyelesaikan cerita ini dan mendapatkan Akhir: ${ending}.`,
    ]
    if (bigChoices.length > 0) {
      lines.push(`Jejak pilihanku: ${bigChoices.slice(0, 3).join('; ')}.`)
    }
    if (tropes.length > 0) {
      lines.push(`Trope: ${tropes.slice(0, 4).join(', ')}.`)
    }
    lines.push('Kamu akan memilih jalan yang sama? Coba jalurmu sendiri di Lakoku.')
    lines.push(`Cerita: ${title}`)
    if (path && typeof window !== 'undefined') {
      lines.push(`${window.location.origin}${path}`)
    }
    return lines.join('\n')
  }

  function onShare() {
    setMessage(null)
    startTransition(async () => {
      const created = await actCreateEndingShare({
        storyId,
        title,
        tagline,
        tropes,
        cover,
        endingName,
        jejak,
        visibility: 'unlisted',
      })
      if (!created.ok) {
        setMessage(created.error)
        return
      }

      const url =
        typeof window !== 'undefined'
          ? `${window.location.origin}${created.path}`
          : created.path
      const text = buildShareText(created.path)

      try {
        if (navigator.share) {
          await navigator.share({ title, text, url })
          setMessage('Dibagikan.')
          return
        }
        await navigator.clipboard.writeText(text)
        setMessage('Teks & tautan share disalin.')
      } catch {
        try {
          await navigator.clipboard.writeText(url)
          setMessage('Tautan disalin.')
        } catch {
          setMessage('Tautan: ' + created.path)
        }
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-1">
      <button
        type="button"
        onClick={onShare}
        disabled={pending}
        className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-60"
      >
        <Share2 className="size-4" aria-hidden="true" />
        {pending ? 'Menyiapkan…' : 'Bagikan'}
      </button>
      {message && (
        <span className="text-center text-[11px] text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  )
}
