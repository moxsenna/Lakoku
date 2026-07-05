'use client'

import { useState } from 'react'
import { X, Flag, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  submitContentReport,
  REPORT_REASONS,
  type ReportReason,
} from '@/lib/api'

/**
 * T7.3 — Bottom sheet laporan pembaca (PRD §10.7).
 * Referensi bab dilampirkan otomatis — pembaca tidak perlu screenshot.
 */
export function ReportSheet({
  storyId,
  chapterNumber,
  open,
  onClose,
}: {
  storyId: string
  chapterNumber: number
  open: boolean
  onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (!open) return null

  function handleClose() {
    onClose()
    // Reset lembut setelah animasi tutup.
    setTimeout(() => {
      setReason(null)
      setNote('')
      setSent(false)
    }, 300)
  }

  async function handleSubmit() {
    if (!reason || sending) return
    setSending(true)
    await submitContentReport(storyId, chapterNumber, reason, note || undefined)
    setSending(false)
    setSent(true)
    toast('Laporan terkirim. Terima kasih sudah membantu.')
  }

  return (
    <div
      className="fixed inset-0 z-50 mx-auto flex w-full max-w-md items-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-sheet-title"
    >
      <button
        type="button"
        aria-label="Tutup laporan"
        onClick={handleClose}
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
      />
      <div className="lk-fade-up relative z-10 flex w-full flex-col gap-5 rounded-t-3xl border-t border-border bg-card px-6 pb-8 pt-5">
        <div className="mx-auto h-1 w-10 rounded-full bg-muted" aria-hidden="true" />

        {sent ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Check className="size-6" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 id="report-sheet-title" className="font-serif text-xl text-card-foreground">
                Laporan terkirim
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                Terima kasih. Laporanmu membantu penulis merapikan cerita ini.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Kembali Membaca
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2
                  id="report-sheet-title"
                  className="flex items-center gap-2 font-serif text-xl text-card-foreground"
                >
                  <Flag className="size-4 text-primary" aria-hidden="true" />
                  Laporkan Masalah Cerita
                </h2>
                <p className="text-xs text-muted-foreground">
                  Bab {chapterNumber} dilampirkan otomatis — tidak perlu screenshot.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Tutup"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Alasan laporan</legend>
              {REPORT_REASONS.map((r) => (
                <label
                  key={r.value}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors',
                    reason === r.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50',
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                      reason === r.value ? 'border-primary' : 'border-muted-foreground',
                    )}
                  >
                    {reason === r.value && (
                      <span className="size-2 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="text-sm font-medium text-card-foreground">
                    {r.label}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="report-note"
                className="text-xs font-medium text-muted-foreground"
              >
                Ceritakan lebih detail (opsional)
              </label>
              <textarea
                id="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Apa yang terasa tidak pas?"
                className="w-full resize-none rounded-2xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="self-end text-[11px] text-muted-foreground">
                {note.length}/500
              </span>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!reason || sending}
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? 'Mengirim…' : 'Kirim Laporan'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
