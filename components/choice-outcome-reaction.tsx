import type { JejakItem } from '@/packages/contracts/src/reader'

export function ChoiceOutcomeReaction({ item }: { item: JejakItem }) {
  const paragraphs = item.consequence
    .split('\n\n')
    .map((s) => s.trim())
    .filter(Boolean)
  return (
    <div className="lk-fade-up rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-lavender">
        Pilihanmu sebelumnya
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">
        &ldquo;{item.decision}&rdquo;
      </p>
      <div className="mt-2 flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
        {paragraphs.map((paragraph, idx) => (
          <p key={idx}>{paragraph}</p>
        ))}
      </div>
      {item.directionHint && (
        <p className="mt-2 text-[11px] italic text-muted-foreground/90">
          {item.directionHint}
        </p>
      )}
    </div>
  )
}
