'use client'

import { useState } from 'react'
import { Copy, Check, Share2 } from 'lucide-react'

interface Props {
  code: string
}

export function CopyReferralLink({ code }: Props) {
  const [copiedLink, setCopiedLink] = useState(false)

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/r/${code}`
    : `https://lakoku.biz.id/r/${code}`

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      /* no-op */
    }
  }

  async function handleShareNative() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: 'Baca Cerita Interaktif di Lakoku',
          text: 'Pilih alur ceritamu sendiri dan jadilah tokoh utama di Lakoku!',
          url: shareUrl,
        })
      } catch {
        /* no-op */
      }
    } else {
      await handleCopyLink()
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 border border-border">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Tautan Referral Kamu</span>
        <button
          onClick={handleShareNative}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Share2 className="size-3.5" />
          Bagikan
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3.5 py-2.5">
        <span className="truncate font-mono text-xs text-foreground">{shareUrl}</span>
        <button
          onClick={handleCopyLink}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted"
        >
          {copiedLink ? (
            <>
              <Check className="size-3.5 text-emerald-500" />
              <span>Tersalin!</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5 text-muted-foreground" />
              <span>Salin Tautan</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

