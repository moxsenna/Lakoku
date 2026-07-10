'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, Check, Loader2, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listChapters, getLocalProgress, type JejakItem } from '@/lib/api'

/**
 * Dialog daftar bab yang sudah dijangkau pembaca.
 *
 * - Hanya menampilkan bab 1..maxReachedChapter (spoiler gate).
 * - Bab yang sudah selesai (ada jejak) diberi indikator ✓.
 * - Bab saat ini di-highlight.
 * - Klik bab → navigasi ke /baca/[id]?bab=N lalu tutup dialog.
 */
export function ChapterListDialog({
  open,
  onClose,
  storyId,
  currentChapter,
  jejak,
}: {
  open: boolean
  onClose: () => void
  storyId: string
  currentChapter: number
  jejak: JejakItem[]
}) {
  if (!open) return null
  return (
    <ChapterListDialogInner
      onClose={onClose}
      storyId={storyId}
      currentChapter={currentChapter}
      jejak={jejak}
    />
  )
}

function ChapterListDialogInner({
  onClose,
  storyId,
  currentChapter,
  jejak,
}: {
  onClose: () => void
  storyId: string
  currentChapter: number
  jejak: JejakItem[]
}) {
  const router = useRouter()
  const [chapters, setChapters] = useState<{ number: number; title: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Tutup dengan tombol Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fetchChapters = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const data = await listChapters(storyId)
      // Rekonsiliasi dengan progres lokal supaya UI terasa lebih responsif
      // di detik pertama sebelum server sempat mencatat progres terbaru.
      const localProgress = getLocalProgress(storyId)
      const effectiveMax = localProgress
        ? Math.max(data.maxReachedChapter, localProgress + 1)
        : data.maxReachedChapter

      // Filter: hanya tampilkan bab <= effectiveMax
      const filtered = data.chapters.filter((c) => c.number <= effectiveMax)
      setChapters(filtered)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [storyId])

  useEffect(() => {
    fetchChapters()
  }, [fetchChapters])

  const completedChapterNumbers = new Set(jejak.map((j) => j.chapter))

  function handleChapterClick(chapterNumber: number) {
    router.push(`/baca/${storyId}?bab=${chapterNumber}`)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chapter-list-title"
      onClick={onClose}
    >
      <div
        className="lk-fade-up flex h-[85svh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-xl sm:rounded-3xl sm:h-auto sm:max-h-[80svh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" aria-hidden="true" />
            <h2 id="chapter-list-title" className="font-serif text-lg text-foreground">
              Daftar Bab
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

        {/* Body — scrollable chapter list */}
        <div className="flex-1 overflow-y-auto px-1 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="ml-2 text-sm text-muted-foreground">Memuat daftar bab…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <p className="text-sm text-muted-foreground">Gagal memuat daftar bab.</p>
              <button
                type="button"
                onClick={fetchChapters}
                className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Coba lagi
              </button>
            </div>
          ) : chapters.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              Belum ada bab yang tersedia.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {chapters.map((ch) => {
                const isCompleted = completedChapterNumbers.has(ch.number)
                const isCurrent = ch.number === currentChapter

                return (
                  <li key={ch.number}>
                    <button
                      type="button"
                      onClick={() => handleChapterClick(ch.number)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-muted/60',
                        isCurrent && 'border-2 border-primary bg-primary/5',
                        !isCurrent && 'border-2 border-transparent',
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                          isCurrent
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground',
                        )}
                        aria-label={`Bab ${ch.number}`}
                      >
                        {ch.number}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={cn(
                            'truncate text-sm font-medium',
                            isCurrent ? 'text-foreground' : 'text-foreground',
                          )}
                        >
                          {ch.title}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Bab {ch.number}
                        </span>
                      </div>
                      {isCompleted && (
                        <Check
                          className="size-4 shrink-0 text-primary"
                          aria-label="Sudah dipilih"
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
