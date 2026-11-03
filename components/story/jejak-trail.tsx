'use client'

import { useEffect, useState } from 'react'
import { Footprints, X } from 'lucide-react'
import type { JejakItem } from '@/lib/api'
import { cn } from '@/lib/utils'

const PREVIEW_COUNT = 3

/**
 * Ringkasan jejak pilihan + panel untuk melihat semuanya.
 *
 * Jejak bisa berisi puluhan entri (satu per bab). Merendernya penuh di halaman
 * mendorong tombol aksi jauh ke bawah, jadi halaman hanya menampilkan beberapa
 * entri terakhir dan sisanya dibuka di sheet.
 */
export function JejakTrail({
  items,
  title = 'Jejak Pilihan',
  accent = 'primary',
}: {
  items: JejakItem[]
  title?: string
  accent?: 'primary' | 'gold'
}) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  const preview = items.slice(-PREVIEW_COUNT)
  const hasMore = items.length > preview.length
  const lineClass = accent === 'gold' ? 'border-gold/50' : 'border-primary/40'
  const iconClass = accent === 'gold' ? 'text-gold' : 'text-primary'

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card p-4">
      <div className="flex items-center gap-2">
        <Footprints className={cn('size-4', iconClass)} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>

      <ol className="flex flex-col gap-3">
        {preview.map((item) => (
          <li key={item.chapter} className={cn('flex flex-col gap-1 border-l-2 pl-4', lineClass)}>
            <span className="text-[11px] font-medium text-lavender">Bab {item.chapter}</span>
            <p className="text-sm font-medium text-foreground">{item.decision}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{item.consequence}</p>
          </li>
        ))}
      </ol>

      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-10 rounded-xl border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/60"
        >
          Lihat semua pilihan ({items.length})
        </button>
      )}

      {open && (
        <JejakSheet
          items={items}
          title={title}
          lineClass={lineClass}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}

function JejakSheet({
  items,
  title,
  lineClass,
  onClose,
}: {
  items: JejakItem[]
  title: string
  lineClass: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="jejak-sheet-title"
      onClick={onClose}
    >
      <div
        className="lk-fade-up flex h-[85svh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-xl sm:h-auto sm:max-h-[80svh] sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Footprints className="size-4 text-primary" aria-hidden="true" />
            <h2 id="jejak-sheet-title" className="font-serif text-lg text-foreground">
              {title}
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ol className="flex flex-col gap-4">
            {items.map((item) => (
              <li key={item.chapter} className={cn('flex flex-col gap-1 border-l-2 pl-4', lineClass)}>
                <span className="text-[11px] font-medium text-lavender">Bab {item.chapter}</span>
                <p className="text-sm font-medium text-foreground">{item.decision}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{item.consequence}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
