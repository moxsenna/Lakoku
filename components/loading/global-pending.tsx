'use client'

/**
 * Bar pending global di tepi atas layar — "app sedang bekerja, bukan ngefreeze".
 *
 * Sinyalnya eksplisit dari `lib/loading/pending.ts` (begin/end di titik cekung
 * data). Visual: segmen rose dengan kepala emas meluncur (`.lk-pending-bar` di
 * globals.css), diam saat idle, hormati prefers-reduced-motion.
 */
import { useGlobalPending } from '@/lib/loading/pending'

export function GlobalPendingIndicator() {
  const visible = useGlobalPending()

  return (
    <>
      {visible && (
        <div
          data-testid="lk-global-pending"
          role="status"
          aria-label="Sedang memuat"
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-start"
        >
          <span className="lk-pending-bar" />
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {visible ? 'Sedang memuat…' : ''}
      </span>
    </>
  )
}
