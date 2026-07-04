'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Settings2, Flag, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { submitChoice, recordChapterReached, type StoryDetail, type Chapter } from '@/lib/api'

type ReaderTheme = 'ink' | 'cream'
type Phase = 'reading' | 'processing' | 'consequence'

export function ReaderView({ story, chapter }: { story: StoryDetail; chapter: Chapter }) {
  const [theme, setTheme] = useState<ReaderTheme>('ink')
  const [fontSize, setFontSize] = useState(17)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('reading')
  const [consequence, setConsequence] = useState<string[]>([])
  const [nextChapterNumber, setNextChapterNumber] = useState<number | null>(null)
  const [isEnding, setIsEnding] = useState(false)
  // Guard anti double-advance: cegah pilihan terkirim lebih dari sekali
  // (mis. tap ganda) sebelum state processing sempat merender ulang.
  const submittingRef = useRef(false)

  const isCream = theme === 'cream'

  // Catat bahwa bab ini telah dibuka (progres lokal, monotonic).
  useEffect(() => {
    recordChapterReached(story.id, chapter.number)
  }, [story.id, chapter.number])

  async function chooseOption(id: string) {
    if (submittingRef.current) return
    submittingRef.current = true
    setPhase('processing')
    const outcome = await submitChoice(story.id, chapter.number, id)
    // Bila cerita berlanjut, tandai bab berikutnya sudah terbuka (monotonic).
    if (!outcome.isEnding && outcome.nextChapterNumber != null) {
      recordChapterReached(story.id, outcome.nextChapterNumber)
    }
    // Beri jeda naratif singkat sebelum menampilkan konsekuensi.
    setTimeout(() => {
      setConsequence(outcome.consequence)
      setNextChapterNumber(outcome.nextChapterNumber)
      setIsEnding(outcome.isEnding)
      setPhase('consequence')
    }, 2800)
  }

  if (phase === 'processing') {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <span className="lk-pulse-soft font-serif text-2xl text-foreground">lakoku</span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl leading-snug text-foreground text-balance">
            Keputusanmu sedang mengubah cerita.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Malam itu belum selesai. Apa yang terjadi selanjutnya sedang ditentukan oleh pilihanmu.
          </p>
        </div>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
          <div className="lk-pulse-soft h-full w-1/2 bg-primary" />
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

      {settingsOpen && (
        <div className="lk-fade-up border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Ukuran teks</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFontSize((s) => Math.max(15, s - 1))}
                  aria-label="Perkecil teks"
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground"
                >
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <span className="w-6 text-center text-sm text-foreground">{fontSize}</span>
                <button
                  type="button"
                  onClick={() => setFontSize((s) => Math.min(22, s + 1))}
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
            className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Flag className="size-3.5" aria-hidden="true" />
            Laporkan Masalah Cerita
          </button>
        </div>
      )}

      <article className="flex flex-col gap-6 px-6 pb-16 pt-8">
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

          {phase === 'consequence' && consequence.length > 0 && (
            <div className="lk-fade-up flex flex-col gap-5 border-l-2 border-primary/50 pl-4">
              {consequence.map((p, i) => (
                <p key={i} className="text-pretty">
                  {p}
                </p>
              ))}
            </div>
          )}
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
              {chapter.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => chooseOption(c.id)}
                  className="flex min-h-14 flex-col gap-1 rounded-2xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-primary/60"
                >
                  <span className="text-sm font-semibold text-foreground">{c.label}</span>
                  {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {phase === 'consequence' && (
          <div className="lk-fade-up mt-6 flex flex-col gap-3 border-t border-border pt-6">
            <p className="text-center text-xs text-muted-foreground">
              Akhir Bab {chapter.number}. Pilihanmu telah mengubah hubungan ini.
            </p>
            <Link
              href={
                isEnding
                  ? `/akhir/${story.id}`
                  : `/baca/${story.id}?bab=${nextChapterNumber ?? chapter.number + 1}`
              }
              className="flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {isEnding
                ? 'Lihat Akhir Cerita'
                : `Lanjut ke Bab ${nextChapterNumber ?? chapter.number + 1}`}
            </Link>
            <Link
              href="/beranda"
              className="flex min-h-13 items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
            >
              <X className="mr-2 size-4" aria-hidden="true" />
              Kembali ke Beranda
            </Link>
          </div>
        )}
      </article>
    </main>
  )
}
