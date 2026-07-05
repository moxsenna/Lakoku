import { cn } from '@/lib/utils'
import type { ChapterCriticalPoint } from '@/lib/observability'

/**
 * Bar chart per-bab untuk continuity_critical_rate (T8.1). Sengaja bebas
 * dependensi (div berskala) agar aman dirender sepenuhnya di server tanpa
 * hydration chart. Tren menaik terhadap nomor bab = sinyal yang dipantau alert
 * kompaksi (T8.2).
 */
export function CriticalRateChart({
  data,
  trendUp,
}: {
  data: ChapterCriticalPoint[]
  trendUp: boolean
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Belum ada data generasi. Metrik akan muncul setelah bab dihasilkan.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex items-end gap-1.5 overflow-x-auto pb-1"
        role="img"
        aria-label={`Tingkat continuity critical per bab untuk ${data.length} bab`}
      >
        {data.map((p) => {
          const pct = Math.round(p.rate * 100)
          const tone =
            p.rate >= 0.5 ? 'bg-destructive' : p.rate > 0 ? 'bg-accent' : 'bg-primary/30'
          return (
            <div key={p.chapter} className="flex min-w-6 flex-1 flex-col items-center gap-1">
              <div className="flex h-28 w-full items-end">
                <div
                  className={cn('w-full rounded-t-sm transition-all', tone)}
                  style={{ height: `${Math.max(pct, p.rate > 0 ? 6 : 2)}%` }}
                  title={`Bab ${p.chapter}: ${pct}% (${p.criticalAttempts}/${p.attempts})`}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{p.chapter}</span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {trendUp
          ? 'Tren NAIK terhadap nomor bab — perlu ditinjau (indikasi regresi kompaksi).'
          : 'Tidak ada tren naik monoton terhadap nomor bab.'}
      </p>
    </div>
  )
}
