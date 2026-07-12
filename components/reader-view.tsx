'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Settings2, Flag, Minus, Plus, RefreshCw, List, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  clearPendingChoice,
  getPendingChoice,
  recordChapterReached,
  recordLastChoiceSummary,
  getLastChoiceSummary,
  recordPendingChoice,
  retryPendingChoice,
  submitChoice,
  type Chapter,
  type ChoiceOutcome,
  type JejakItem,
  type PendingChoice,
  type StoryDetail,
} from '@/lib/api'
import { ReportDialog } from '@/components/report-dialog'
import { ChapterUnavailableBanner } from '@/components/chapter-unavailable-banner'
import { ChapterListDialog } from '@/components/chapter-list-dialog'
import { useReaderFontSize } from '@/components/font-size-provider'
import { PoetryLottie } from '@/components/mulai/poetry-lottie'

type ReaderTheme = 'ink' | 'cream'
type Phase = 'reading' | 'processing' | 'pending'
const SELECTED_FEEDBACK_MS = 180
const MIN_PROCESSING_MS = 1200

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function ReaderView({
  story,
  chapter,
  fallbackFromChapter,
  isReRead = false,
  previousChoice = null,
  previousChapterJejak = null,
}: {
  story: StoryDetail
  chapter: Chapter
  fallbackFromChapter?: number
  isReRead?: boolean
  previousChoice?: JejakItem | null
  previousChapterJejak?: JejakItem | null
}) {
  const router = useRouter()
  const [theme, setTheme] = useState<ReaderTheme>('ink')
  const { fontSize, decreaseFontSize, increaseFontSize } = useReaderFontSize()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [chapterListOpen, setChapterListOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('reading')
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null)
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null)
  // Fallback guest: ringkasan pilihan dari localStorage (dibaca setelah mount).
  const [localPreviousChoice, setLocalPreviousChoice] = useState<JejakItem | null>(null)
  // Guard anti double-advance: cegah pilihan terkirim lebih dari sekali
  // (mis. tap ganda) sebelum state processing sempat merender ulang.
  const submittingRef = useRef(false)

  const isCream = theme === 'cream'

  // Catat bahwa bab ini telah dibuka (progres lokal, monotonic).
  useEffect(() => {
    recordChapterReached(story.id, chapter.number)
    const pending = getPendingChoice()
    if (pending?.storyId === story.id && pending.chapterNumber === chapter.number) {
      const timer = window.setTimeout(() => {
        setPendingChoice(pending)
        setPhase('pending')
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [story.id, chapter.number])

  // Fallback tamu: baca ringkasan pilihan dari localStorage setelah mount
  // (hindari hydration mismatch — jangan baca localStorage langsung di render).
  useEffect(() => {
    if (previousChapterJejak || isReRead) return
    setLocalPreviousChoice(getLastChoiceSummary(story.id, chapter.number))
  }, [story.id, chapter.number, previousChapterJejak, isReRead])

  // Resolve previous choice untuk card: server jejak utama, localStorage fallback.
  const effectivePreviousChoice = previousChapterJejak ?? localPreviousChoice

  function showOutcome(outcome: ChoiceOutcome, choiceId?: string) {
    clearPendingChoice()
    setPendingChoice(null)

    // Ending: tidak perlu simpan summary — redirect langsung ke halaman akhir.
    if (outcome.isEnding) {
      submittingRef.current = false
      setSelectedChoiceId(null)
      router.push(`/akhir/${story.id}`)
      return
    }

    const nextBab = outcome.nextChapterNumber ?? chapter.number + 1
    recordChapterReached(story.id, nextBab)

    // Simpan ringkasan untuk fallback tamu (server jejak tidak tersedia tanpa login).
    const chosenLabel =
      chapter.choices?.find((c) => c.id === choiceId)?.label ?? ''
    if (chosenLabel) {
      recordLastChoiceSummary({
        storyId: story.id,
        fromChapter: chapter.number,
        toChapter: nextBab,
        decision: chosenLabel,
        consequence: outcome.consequence[0] ?? '',
      })
    }

    submittingRef.current = false
    setSelectedChoiceId(null)
    router.push(`/baca/${story.id}?bab=${nextBab}`)
  }

  async function chooseOption(id: string) {
    if (submittingRef.current) return
    submittingRef.current = true
    setSelectedChoiceId(id)
    const outcomePromise = submitChoice(story.id, chapter.number, id).then(
      (outcome) => ({ ok: true as const, outcome }),
      (error) => ({ ok: false as const, error }),
    )
    try {
      await wait(SELECTED_FEEDBACK_MS)
      setPhase('processing')
      const [result] = await Promise.all([outcomePromise, wait(MIN_PROCESSING_MS)])
      if (!result.ok) throw result.error
      showOutcome(result.outcome, id)
    } catch {
      const pending = recordPendingChoice({
        storyId: story.id,
        chapterNumber: chapter.number,
        choiceId: id,
      })
      setPendingChoice(pending)
      setSelectedChoiceId(null)
      submittingRef.current = false
      setPhase('pending')
    }
  }

  async function retryChoice() {
    if (submittingRef.current) return
    submittingRef.current = true
    setPhase('processing')
    try {
      const [outcome] = await Promise.all([retryPendingChoice(), wait(MIN_PROCESSING_MS)])
      if (!outcome) {
        setPendingChoice(null)
        submittingRef.current = false
        setPhase('reading')
        return
      }
      showOutcome(outcome, pendingChoice?.choiceId)
    } catch {
      setPendingChoice(getPendingChoice())
      submittingRef.current = false
      setPhase('pending')
    }
  }

  if (phase === 'processing') {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <span className="lk-pulse-soft font-serif text-2xl text-foreground">lakoku</span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Pilihanmu sedang mengubah jalan cerita...
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Kami sedang menulis bab berikutnya berdasarkan keputusanmu.
          </p>
        </div>
        <PoetryLottie className="h-32 w-32" />
      </main>
    )
  }

  if (phase === 'pending') {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <span className="lk-pulse-soft font-serif text-2xl text-foreground">lakoku</span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Pilihanmu belum terkirim.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Simpan halaman ini. Saat koneksi siap, kirim lagi pilihan yang sama.
          </p>
          {pendingChoice && (
            <p className="text-xs text-muted-foreground">
              Bab {pendingChoice.chapterNumber}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={retryChoice}
            className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            Coba kirim lagi
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
          >
            Muat ulang bab
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      className={cn(
        'mx-auto flex min-h-svh w-full max-w-md flex-col transition-colors',
        isCream ? 'reader-cream bg-background' : 'bg-background',
      )}
    >
      <header
        className={cn(
          'sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border px-4 py-3 backdrop-blur',
          isCream ? 'bg-background/95' : 'bg-background/95',
        )}
      >
        <Link
          href={`/cerita/${story.id}`}
          aria-label="Kembali ke detail cerita"
          className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <span className="truncate text-xs font-medium text-foreground">{story.title}</span>
          <span className="text-[11px] text-muted-foreground">
            Bab {chapter.number} dari {story.totalChapters}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Pengaturan baca"
          aria-expanded={settingsOpen}
          className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <Settings2 className="size-5" aria-hidden="true" />
        </button>
      </header>

      <div className="h-0.5 w-full bg-muted" aria-hidden="true">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.round((chapter.number / story.totalChapters) * 100)}%` }}
        />
      </div>

      {fallbackFromChapter && fallbackFromChapter !== chapter.number && (
        <ChapterUnavailableBanner
          requestedChapter={fallbackFromChapter}
          currentChapter={chapter.number}
        />
      )}

      {settingsOpen && (
        <div className="lk-fade-up border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Ukuran teks</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={decreaseFontSize}
                  aria-label="Perkecil teks"
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground"
                >
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <span className="w-6 text-center text-sm text-foreground">{fontSize}</span>
                <button
                  type="button"
                  onClick={increaseFontSize}
                  aria-label="Perbesar teks"
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2" role="group" aria-label="Tema baca">
              <button
                type="button"
                onClick={() => setTheme('ink')}
                aria-pressed={theme === 'ink'}
                className={cn(
                  'size-9 rounded-full border-2 bg-ink',
                  theme === 'ink' ? 'border-primary' : 'border-border',
                )}
              >
                <span className="sr-only">Tema gelap</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('cream')}
                aria-pressed={theme === 'cream'}
                className={cn(
                  'size-9 rounded-full border-2 bg-cream',
                  theme === 'cream' ? 'border-primary' : 'border-border',
                )}
              >
                <span className="sr-only">Tema terang</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false)
              setChapterListOpen(true)
            }}
            className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <List className="size-3.5" aria-hidden="true" />
            Daftar Bab
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false)
              setReportOpen(true)
            }}
            className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Flag className="size-3.5" aria-hidden="true" />
            Laporkan Masalah Cerita
          </button>
        </div>
      )}

      <article className="flex flex-col gap-6 px-6 pb-16 pt-8">
        {/* Card ringkasan pilihan sebelumnya (dari server jejak atau localStorage fallback tamu). */}
        {effectivePreviousChoice && !isReRead && (
          <div className="lk-fade-up rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-lavender">
              Pilihanmu sebelumnya
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              "{effectivePreviousChoice.decision}"
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {effectivePreviousChoice.consequence}
            </p>
          </div>
        )}

        <h1 className="font-serif text-3xl leading-tight text-foreground text-balance">
          {chapter.title}
        </h1>

        <div
          className="flex flex-col gap-5 text-foreground"
          style={{ fontSize: `${fontSize}px`, lineHeight: 1.75 }}
        >
          {chapter.paragraphs.map((p, i) => (
            <p key={i} className="text-pretty">
              {p}
            </p>
          ))}
        </div>

        {phase === 'reading' && chapter.choices && (
          <section aria-labelledby="pilihan-heading" className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1 border-t border-border pt-6">
              <span className="text-[11px] font-semibold tracking-wide text-lavender">
                PILIHANMU
              </span>
              <h2 id="pilihan-heading" className="font-serif text-xl leading-snug text-foreground">
                {chapter.choicePrompt}
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              {chapter.choices.map((c) => {
                const selected = selectedChoiceId === c.id
                // Mode baca-ulang: cocokkan pilihan lama lewat label (fallback hingga JejakItem punya choiceId).
                const wasChosen = isReRead && previousChoice?.decision === c.label
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => chooseOption(c.id)}
                    disabled={isReRead}
                    className={cn(
                      'flex min-h-14 flex-col gap-1 rounded-2xl border px-5 py-4 text-left transition-colors',
                      isReRead
                        ? 'cursor-default'
                        : 'hover:border-primary/60',
                      wasChosen
                        ? 'border-primary bg-primary/10'
                        : selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {c.label}
                      {wasChosen && (
                        <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      )}
                    </span>
                    {isReRead && wasChosen && (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Pilihanmu waktu itu
                      </span>
                    )}
                    {!isReRead && c.hint && (
                      <span className="text-xs text-muted-foreground">{c.hint}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Navigasi kembali ke bab terbaru dalam mode baca-ulang */}
            {isReRead && (
              <Link
                href={`/baca/${story.id}?bab=${story.currentChapter}`}
                className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Kembali ke Bab Terbaru
              </Link>
            )}
          </section>
        )}
      </article>

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        storyId={story.id}
        chapterNumber={chapter.number}
      />

      <ChapterListDialog
        open={chapterListOpen}
        onClose={() => setChapterListOpen(false)}
        storyId={story.id}
        currentChapter={chapter.number}
        jejak={story.jejak}
      />
    </main>
  )
}
