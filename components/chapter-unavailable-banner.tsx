import { Clock3 } from 'lucide-react'

export function ChapterUnavailableBanner({
  requestedChapter,
  currentChapter,
}: {
  requestedChapter: number
  currentChapter: number
}) {
  return (
    <div className="border-b border-border bg-secondary/60 px-5 py-3">
      <div className="mx-auto flex max-w-md items-start gap-3 text-left">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-primary">
          <Clock3 className="size-4" aria-hidden="true" />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Bab {requestedChapter} sedang disiapkan.</span>{' '}
          Kamu dibawa ke Bab {currentChapter} yang sudah tersedia.
        </p>
      </div>
    </div>
  )
}
