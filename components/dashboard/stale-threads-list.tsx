import { Badge } from '@/components/ui/badge'
import type { StaleThreadRef } from '@/lib/observability'

/**
 * Daftar thread stale (T8.1). Thread aktif yang tak disentuh melewati ambang
 * (lihat lib/narrative/threads.ts) — wajib di-callback. Ops-facing.
 */
export function StaleThreadsList({ threads }: { threads: StaleThreadRef[] }) {
  if (threads.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tidak ada thread stale. Semua utas aktif masih dalam jendela callback.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {threads.map((t) => (
        <li
          key={t.threadId}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-foreground">{t.title}</span>
            <span className="text-xs text-muted-foreground">
              Stale sejak Bab {t.staleSinceChapter ?? '—'}
            </span>
          </div>
          {t.isMainMystery ? (
            <Badge variant="destructive" className="shrink-0">
              Misteri Utama
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">
              Utas
            </Badge>
          )}
        </li>
      ))}
    </ul>
  )
}
