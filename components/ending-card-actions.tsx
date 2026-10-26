'use client'

import { useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { trackEvent } from '@/lib/analytics/client'

/**
 * Aksi kartu akhir di halaman ending: unduh gambar 9:16 untuk status sosial,
 * atau bagikan lewat sheet bawaan perangkat (fallback: salin teks + tautan).
 */
export function EndingCardActions({
  sharePath,
  shareSlug,
  title,
  endingName,
}: {
  sharePath: string
  shareSlug: string
  title: string
  endingName?: string
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)

  async function download() {
    setBusy('download')
    setMessage(null)
    trackEvent('share_clicked', { placement: 'ending_page', share_channel: 'download' })
    try {
      const res = await fetch(`/api/ending-card/${encodeURIComponent(shareSlug)}`)
      if (!res.ok) throw new Error('kartu gagal dirender')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `lakoku-akhir-${shareSlug}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage('Kartu akhir tersimpan di galeri/unduhan.')
    } catch {
      setMessage('Kartu belum bisa diunduh. Coba lagi nanti.')
    } finally {
      setBusy(null)
    }
  }

  async function share() {
    setBusy('share')
    setMessage(null)
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}${sharePath}` : sharePath
    const text = `Aku menyelesaikan "${title}" dan sampai di akhir: ${endingName ?? 'rahasia'}. Akan kamu pilih jalan yang sama?`
    trackEvent('share_clicked', { placement: 'ending_page', share_channel: typeof navigator.share === 'function' ? 'native' : 'copy' })
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text, url })
        setMessage('Dibagikan.')
        return
      }
      await navigator.clipboard.writeText(`${text}\n${url}`)
      setMessage('Teks & tautan share disalin.')
    } catch {
      // Pembatal share sheet bukan kegagalan.
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy !== null}
          className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Download className="size-4" aria-hidden="true" />
          {busy === 'download' ? 'Menyiapkan…' : 'Kartu Akhir 9:16'}
        </button>
        <button
          type="button"
          onClick={() => void share()}
          disabled={busy !== null}
          className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-60"
        >
          <Share2 className="size-4" aria-hidden="true" />
          {busy === 'share' ? 'Menyiapkan…' : 'Bagikan'}
        </button>
      </div>
      {message && (
        <span className="text-center text-[11px] text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  )
}
