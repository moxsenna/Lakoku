import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConsistencyAlert } from '@/lib/observability'

/**
 * Banner alert konsistensi (T8.2) di dashboard ops. Hanya render bila ada sinyal
 * continuity-critical-monotonic. Ops-facing: boleh menyebut "kompaksi" & angka
 * teknis (bukan permukaan pembaca). Warna hanya bumbu — makna ada di teks.
 */
export function AlertBanner({ alert }: { alert: ConsistencyAlert | null }) {
  if (!alert) return null

  const critical = alert.severity === 'CRITICAL'

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-4',
        critical
          ? 'border-destructive/50 bg-destructive/10'
          : 'border-accent/50 bg-accent/10',
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle
          className={cn('h-4 w-4 shrink-0', critical ? 'text-destructive' : 'text-accent')}
          aria-hidden="true"
        />
        <span
          className={cn(
            'text-sm font-semibold',
            critical ? 'text-destructive' : 'text-accent-foreground',
          )}
        >
          Alert {alert.severity}: continuity critical rate naik monoton
        </span>
      </div>
      <p className="text-sm text-muted-foreground text-pretty">{alert.message}</p>
      <p className="text-xs text-muted-foreground">
        Rentang Bab {alert.firstChapter}–{alert.lastChapter} · run naik terpanjang{' '}
        {alert.longestIncreasingRun} · {alert.storyId ? `cerita ${alert.storyId}` : 'semua cerita'}
      </p>
    </div>
  )
}
