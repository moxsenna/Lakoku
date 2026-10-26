'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { trackEvent } from '@/lib/analytics/client'

/**
 * Tombol bagikan di reader — membagikan halaman cerita (bukan ending card),
 * karena bab yang sedang dibaca belum tentu tamat. Tamu ikut: Web Share API
 * dan clipboard tidak butuh akun.
 */
export function ShareStoryButton({ storyId, title }: { storyId: string; title: string }) {
  const [message, setMessage] = useState<string | null>(null)

  async function onShare() {
    const path = `/cerita/${encodeURIComponent(storyId)}`
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
    const text = `${title} — novel interaktif: kamu tokoh utamanya. Akan kamu pilih jalan yang sama?`
    const channel = typeof navigator.share === 'function' ? 'native' : 'copy'
    trackEvent('share_clicked', { story_id: storyId, placement: 'reader_header', share_channel: channel })

    try {
      if (channel === 'native') {
        await navigator.share({ title, text, url })
        setMessage('Dibagikan.')
        return
      }
      await navigator.clipboard.writeText(`${text}\n${url}`)
      setMessage('Tautan cerita disalin.')
    } catch {
      // User membatalkan share sheet: bukan kegagalan.
    }
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => void onShare()}
        aria-label={`Bagikan cerita ${title}`}
        className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
      >
        <Share2 className="size-5" aria-hidden="true" />
      </button>
      {message && (
        <span className="text-center text-[11px] text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  )
}
