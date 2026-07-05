'use client'

import { useEffect, useState } from 'react'
import { X, Flag, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { submitReport, REPORT_CATEGORIES, type ReportCategory } from '@/lib/api'
import { toast } from 'sonner'

/**
 * Lembar laporan masalah cerita (T7.3). Pembaca hanya memilih KATEGORI
 * (bahasa ramah pembaca) + catatan opsional; server yang menautkan referensi
 * kanonik bab. Tak ada permintaan screenshot, tak ada istilah teknis.
 */
export function ReportDialog({
  open,
  onClose,
  storyId,
  chapterNumber,
}: {
  open: boolean
  onClose: () => void
  storyId: string
  chapterNumber: number
}) {
  // Mount ulang tiap kali dibuka → state selalu bersih tanpa reset di effect.
  if (!open) return null
  return (
    <ReportDialogInner
      onClose={onClose}
      storyId={storyId}
      chapterNumber={chapterNumber}
    />
  )
}

function ReportDialogInner({
  onClose,
  storyId,
  chapterNumber,
}: {
  onClose: () => void
  storyId: string
  chapterNumber: number
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  // Tutup dengan tombol Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit() {
    if (!category || submitting) return
    setSubmitting(true)
    const result = await submitReport(storyId, chapterNumber, category, note)
    setSubmitting(false)
    if (result.ok) {
      setDone(true)
      toast.success('Terima kasih. Laporanmu sudah kami terima.')
      setTimeout(onClose, 1200)
    } else {
      toast.error('Laporan gagal dikirim. Coba lagi sebentar lagi.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 px-4 pb-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onClick={onClose}
    >
      <div
        className="lk-fade-up w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Flag className="size-4 text-primary" aria-hidden="true" />
            <h2 id="report-title" className="font-serif text-lg text-foreground">
              Laporkan Masalah Cerita
            </h2>
          </div>
          <button
            autoFocus
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Bantu kami merapikan Bab {chapterNumber}. Pilih yang paling sesuai —
          kami akan menelusuri detailnya sendiri.
        </p>

        <fieldset className="mt-4 flex flex-col gap-2" disabled={submitting || done}>
          <legend className="sr-only">Jenis masalah</legend>
          {REPORT_CATEGORIES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCategory(opt.value)}
              aria-pressed={category === opt.value}
              className={cn(
                'flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition-colors',
                category === opt.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background text-foreground hover:border-primary/50',
              )}
            >
              <span>{opt.label}</span>
              {category === opt.value && (
                <Check className="size-4 text-primary" aria-hidden="true" />
              )}
            </button>
          ))}
        </fieldset>

        <label htmlFor="report-note" className="mt-4 block text-xs font-medium text-muted-foreground">
          Catatan (opsional)
        </label>
        <textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={submitting || done}
          rows={3}
          maxLength={2000}
          placeholder="Ceritakan singkat apa yang terasa janggal…"
          className="mt-1 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!category || submitting || done}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity enabled:hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Mengirim…
            </>
          ) : done ? (
            <>
              <Check className="size-4" aria-hidden="true" />
              Terkirim
            </>
          ) : (
            'Kirim Laporan'
          )}
        </button>
      </div>
    </div>
  )
}
