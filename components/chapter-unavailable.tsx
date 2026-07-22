'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { StoryDetail } from '@/lib/api'
import { getChapterGenerationStatus, startChapter } from '@/lib/api/client'
import {
  decideAfterNetworkError,
  decideAfterStatus,
  noteForStartStatus,
  readerCopy,
  type ReaderChapterUiState,
} from '@/lib/reader/chapter-status-poller'

/**
 * Layar reader-safe saat sebuah bab belum bisa disajikan.
 *
 * - PREPARING: poll exact status endpoint (not blind router.refresh only)
 * - UNAVAILABLE: terminal failure — offer honest retry
 *
 * Never shows provider / LLM / validator / HTTP / correlation internals.
 */
export function ChapterUnavailable({
  story,
  chapterNumber,
  state: initialState,
}: {
  story: StoryDetail
  chapterNumber: number
  state: ReaderChapterUiState
}) {
  const router = useRouter()
  const [uiState, setUiState] = useState<ReaderChapterUiState>(initialState)
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [queueHint, setQueueHint] = useState<{
    position: number | null
    estimatedWaitSeconds: number
    phase: 'queued' | 'active'
  } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const pollOnceRef = useRef<() => Promise<void>>(async () => {})

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const schedule = useCallback(
    (delayMs: number, fn: () => void) => {
      clearTimer()
      timerRef.current = setTimeout(fn, delayMs)
    },
    [clearTimer],
  )

  const pollOnce = useCallback(async () => {
    if (!mountedRef.current || inFlightRef.current) return
    inFlightRef.current = true
    setChecking(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await getChapterGenerationStatus(
        story.id,
        chapterNumber,
        controller.signal,
      )
      if (!mountedRef.current) return

      setQueueHint(res.queue ?? null)

      const decision = decideAfterStatus(res.status)
      if (decision.action === 'refresh') {
        clearTimer()
        router.refresh()
        return
      }
      if (decision.action === 'failed') {
        clearTimer()
        setQueueHint(null)
        setUiState('UNAVAILABLE')
        return
      }
      // queued | generating
      setUiState('PREPARING')
      if (decision.action === 'continue') {
        schedule(decision.nextDelayMs, () => {
          void pollOnceRef.current()
        })
      }
    } catch {
      if (!mountedRef.current || controller.signal.aborted) return
      // Network/transient: keep reader-safe state, retry later — do NOT flip to failed.
      const decision = decideAfterNetworkError()
      schedule(decision.nextDelayMs, () => {
        void pollOnceRef.current()
      })
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setChecking(false)
    }
  }, [story.id, chapterNumber, router, clearTimer, schedule])

  useEffect(() => {
    pollOnceRef.current = pollOnce
  }, [pollOnce])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      abortRef.current?.abort()
    }
  }, [clearTimer])

  // When parent initialState changes, adopt via deferred update (avoid sync setState-in-effect).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (mountedRef.current) setUiState(initialState)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialState])

  // Immediate check + recursive polling while PREPARING.
  useEffect(() => {
    if (uiState !== 'PREPARING') {
      clearTimer()
      return
    }
    void pollOnceRef.current()
    return () => {
      clearTimer()
      abortRef.current?.abort()
    }
  }, [uiState, clearTimer])

  async function retry() {
    setRetrying(true)
    setRetryNote(null)
    try {
      const kicked = await startChapter(story.id, chapterNumber)
      if (!kicked.ok) {
        setRetryNote(kicked.error || 'Belum bisa memulai ulang penulisan.')
      } else if (kicked.status === 'ALREADY_READY') {
        setRetryNote(noteForStartStatus('ALREADY_READY'))
        router.refresh()
      } else if (kicked.status === 'ALREADY_RUNNING') {
        setRetryNote(noteForStartStatus('ALREADY_RUNNING'))
        setUiState('PREPARING')
      } else {
        setRetryNote(noteForStartStatus(kicked.status ?? 'STARTED'))
        setUiState('PREPARING')
      }
    } catch {
      setRetryNote('Belum bisa memulai ulang. Coba beberapa saat lagi.')
    }
    setTimeout(() => {
      if (mountedRef.current) setRetrying(false)
    }, 1500)
  }

  async function checkNow() {
    await pollOnce()
  }

  const preparing = uiState === 'PREPARING'
  const copy = readerCopy(uiState, chapterNumber, queueHint)

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link
          href={`/cerita/${story.id}`}
          aria-label="Kembali ke detail cerita"
          className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <span className="truncate text-xs font-medium text-foreground">{story.title}</span>
      </header>

      <div
        className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-16 text-center"
        role="status"
        aria-live="polite"
      >
        <span
          className={
            preparing
              ? 'lk-pulse-soft font-serif text-2xl text-foreground'
              : 'font-serif text-2xl text-foreground'
          }
        >
          lakoku
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            {copy.title}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            {copy.description}
          </p>
          {copy.queueLine ? (
            <p className="text-sm font-medium text-foreground/80 text-pretty">
              {copy.queueLine}
            </p>
          ) : null}
        </div>

        {retryNote ? (
          <p className="text-xs text-muted-foreground text-pretty">{retryNote}</p>
        ) : null}

        {preparing ? (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
              <div className="lk-pulse-soft h-full w-1/2 bg-primary" />
            </div>
            <button
              type="button"
              onClick={() => void checkNow()}
              disabled={checking || retrying}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-60"
            >
              <RefreshCw
                className={`size-4 ${checking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {checking ? 'Memeriksa…' : copy.primaryCta}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw
              className={retrying ? 'lk-pulse-soft size-4' : 'size-4'}
              aria-hidden="true"
            />
            {retrying ? 'Memulai…' : copy.primaryCta}
          </button>
        )}

        <Link
          href={`/cerita/${story.id}`}
          className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
        >
          Kembali ke detail cerita
        </Link>
      </div>
    </main>
  )
}
