'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Share2 } from 'lucide-react'
import { trackEvent } from '@/lib/analytics/client'
import { buildReferralInvite } from '@/lib/share/invite'

interface Props {
  code: string
  /** Origin publik dari server, supaya SSR dan klien tidak berbeda. */
  origin: string
}

type Busy = 'idle' | 'sharing' | 'copying'

export function CopyReferralLink({ code, origin }: Props) {
  const invite = buildReferralInvite(code, origin)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [waHref, setWaHref] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>('idle')
  const [cardState, setCardState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const fileRef = useRef<File | null>(null)

  // Kartu diambil saat komponen dimuat, BUKAN setelah tombol ditekan:
  // aktivasi pengguna untuk share hanya sekitar 5 detik, dan render kartu
  // di server bisa lebih lama dari itu.
  useEffect(() => {
    let cancelled = false

    async function loadCard() {
      try {
        const res = await fetch(`/api/referral-card/${encodeURIComponent(code)}`)
        if (!res.ok) throw new Error('kartu gagal dirender')
        const blob = await res.blob()
        if (cancelled) return
        fileRef.current = new File([blob], `lakoku-undangan-${code}.png`, {
          type: blob.type || 'image/png',
        })
        setCardState('ready')
      } catch {
        if (!cancelled) setCardState('unavailable')
      }
    }

    void loadCard()
    return () => {
      cancelled = true
    }
  }, [code])

  async function handleCopyLink() {
    setBusy('copying')
    setMessage(null)
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      setMessage('Tautan disalin.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setMessage('Tautan belum bisa disalin. Salin manual dari kotak di atas.')
    } finally {
      setBusy('idle')
    }
  }

  async function handleShareNative() {
    setBusy('sharing')
    setMessage(null)
    setWaHref(null)

    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    const file = fileRef.current

    if (!nav || typeof nav.share !== 'function') {
      await fallbackCopy()
      return
    }

    // Tiga tingkat: berkas (gambar + teks), teks + tautan, lalu salin.
    let canSendFile = false
    if (file) {
      try {
        canSendFile =
          typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
      } catch {
        canSendFile = false
      }
    }

    const payload: ShareData = {
      title: invite.title,
      text: invite.text,
      url: invite.url,
      ...(canSendFile && file ? { files: [file] } : {}),
    }

    trackEvent('share_clicked', {
      placement: 'rewards_page',
      share_channel: 'native',
    })

    try {
      await nav.share(payload)
      trackEvent('share_completed', {
        placement: 'rewards_page',
        share_channel: 'native',
        share_result: 'completed',
      })
      setMessage(
        canSendFile
          ? 'Undangan terkirim.'
          : 'Undangan terkirim tanpa gambar (perangkat ini belum mendukung kirim berkas).',
      )
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      trackEvent('share_completed', {
        placement: 'rewards_page',
        share_channel: 'native',
        share_result: aborted ? 'cancelled' : 'failed',
      })
      if (aborted) {
        setMessage(null)
      } else {
        await fallbackCopy()
      }
    } finally {
      setBusy('idle')
    }
  }

  async function fallbackCopy() {
    const combined = `${invite.text}`
    try {
      await navigator.clipboard.writeText(combined)
      trackEvent('share_completed', {
        placement: 'rewards_page',
        share_channel: 'copy',
        share_result: 'fallback',
      })
      setMessage('Ajakan & tautan disalin. Tempel di WhatsApp atau aplikasi lain.')
      setWaHref(`https://wa.me/?text=${encodeURIComponent(combined)}`)
    } catch {
      trackEvent('share_completed', {
        placement: 'rewards_page',
        share_channel: 'copy',
        share_result: 'failed',
      })
      setMessage('Bagikan belum berhasil. Salin tautan lewat tombol di atas.')
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Tautan Referral Kamu</span>
        <span className="text-[11px] text-muted-foreground">
          Ajak teman membaca. Mereka masuk lewat tautan ini.
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3.5 py-2.5">
        <span className="truncate font-mono text-xs text-foreground">{invite.url}</span>
        <button
          type="button"
          onClick={() => void handleCopyLink()}
          disabled={busy !== 'idle'}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted disabled:opacity-60"
        >
          {copied ? (
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

      <button
        type="button"
        onClick={() => void handleShareNative()}
        disabled={busy !== 'idle'}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy === 'sharing' ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Menyiapkan…
          </>
        ) : (
          <>
            <Share2 className="size-4" aria-hidden="true" />
            Bagikan Undangan
          </>
        )}
      </button>

      {cardState === 'unavailable' && (
        <p className="text-[11px] text-muted-foreground">
          Gambar undangan belum bisa disiapkan — tautan tetap ikut terkirim.
        </p>
      )}

      {message && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {message}
        </p>
      )}

      {waHref && (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-10 items-center justify-center rounded-xl border border-border text-xs font-semibold text-foreground transition-colors hover:bg-secondary/60"
        >
          Buka WhatsApp
        </a>
      )}
    </div>
  )
}
