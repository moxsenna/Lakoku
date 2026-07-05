/**
 * Engine ALERT konsistensi (M8/T8.2 — NCS §3.3, ARCH §17.4) — LOGIKA MURNI.
 *
 * Aturan alert utama (spec, kata demi kata):
 *   "Alert bila `continuity_critical_rate` naik monoton terhadap nomor bab
 *    (indikasi kompaksi gagal)."
 *
 * Modul ini TAK menyentuh DB/jaringan/env — hanya menerjemahkan metrik hasil
 * `aggregateConsistencyMetrics` menjadi keputusan alert deterministik. Pengiriman
 * ke sink eksternal ditangani `./alert-dispatch` (server-only). Dipisah begini
 * agar keputusan alert bisa diuji penuh via fixture regresi kompaksi.
 *
 * Severity memakai target beta NCS §3.3:
 *   - Bab 1–20  : continuity_critical_rate sehat < 2%
 *   - Bab 21–50 : continuity_critical_rate sehat < 5%
 * Tren naik-monoton yang MELAMPAUI target band bab terakhir → CRITICAL; tren
 * naik-monoton yang masih di bawah target → WARNING (early-warning kompaksi).
 */

import type { ConsistencyMetrics, ChapterCriticalPoint } from './metrics'

export type AlertSeverity = 'WARNING' | 'CRITICAL'

export const CONTINUITY_MONOTONIC_ALERT = 'CONTINUITY_CRITICAL_MONOTONIC' as const

/** Target beta continuity_critical_rate per band bab (NCS §3.3). */
export function betaTargetForChapter(chapter: number): number {
  return chapter <= 20 ? 0.02 : 0.05
}

/** Bab yang rate-nya melampaui target beta band-nya. */
export interface ThresholdBreach {
  chapter: number
  rate: number
  target: number
}

export interface ConsistencyAlert {
  kind: typeof CONTINUITY_MONOTONIC_ALERT
  severity: AlertSeverity
  /** id stabil untuk dedup lintas evaluasi (rentang bab + severity). */
  fingerprint: string
  /** cakupan: id story tertentu, atau null untuk agregat global ops. */
  storyId: string | null
  firstChapter: number
  lastChapter: number
  startRate: number
  endRate: number
  /** panjang rentetan naik-ketat terpanjang (dari CriticalTrend). */
  longestIncreasingRun: number
  series: { chapter: number; rate: number }[]
  breaches: ThresholdBreach[]
  /** pesan ops-facing (private engineering) — TANPA istilah reader-facing. */
  message: string
}

export interface AlertOptions {
  /** cakupan alert untuk pelabelan & dedup. */
  storyId?: string | null
  /**
   * minimum titik bab pada seri sebelum tren dianggap sinyal (bukan noise).
   * Default 3: dua titik saja terlalu mudah "naik monoton" secara kebetulan.
   */
  minChapters?: number
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/**
 * Evaluasi alert continuity-critical-monotonic dari metrik konsistensi.
 * Mengembalikan `null` bila tak ada sinyal (jalur sehat / seri terlalu pendek).
 * Deterministik & bebas efek samping.
 */
export function evaluateCriticalRateAlert(
  metrics: ConsistencyMetrics,
  options: AlertOptions = {},
): ConsistencyAlert | null {
  const { storyId = null, minChapters = 3 } = options
  const { criticalTrend, continuityCriticalByChapter } = metrics

  // Sinyal utama spec: rate naik monoton terhadap nomor bab.
  if (!criticalTrend.monotonicIncreasing) return null
  // Guard noise: butuh cukup banyak bab agar tren bermakna.
  if (criticalTrend.series.length < minChapters) return null

  const series = criticalTrend.series
  const first = series[0]
  const last = series[series.length - 1]

  const breaches = computeBreaches(continuityCriticalByChapter)
  // CRITICAL bila titik akhir sudah melampaui target beta band bab-nya
  // (kompaksi tak sekadar melemah — sudah melewati ambang sehat).
  const severity: AlertSeverity =
    last.rate > betaTargetForChapter(last.chapter) ? 'CRITICAL' : 'WARNING'

  const fingerprint = `${CONTINUITY_MONOTONIC_ALERT}:${storyId ?? 'global'}:${first.chapter}-${last.chapter}:${severity}`

  const message =
    `continuity_critical_rate naik monoton Bab ${first.chapter}→${last.chapter} ` +
    `(${fmtPct(first.rate)} → ${fmtPct(last.rate)}; run naik terpanjang ${criticalTrend.longestIncreasingRun}). ` +
    `Indikasi kompaksi memori gagal (NCS §3.3).` +
    (breaches.length
      ? ` Melampaui target beta di ${breaches.length} bab (mis. Bab ${breaches[breaches.length - 1].chapter} ${fmtPct(breaches[breaches.length - 1].rate)} > ${fmtPct(breaches[breaches.length - 1].target)}).`
      : '')

  return {
    kind: CONTINUITY_MONOTONIC_ALERT,
    severity,
    fingerprint,
    storyId,
    firstChapter: first.chapter,
    lastChapter: last.chapter,
    startRate: first.rate,
    endRate: last.rate,
    longestIncreasingRun: criticalTrend.longestIncreasingRun,
    series,
    breaches,
    message,
  }
}

function computeBreaches(byChapter: ChapterCriticalPoint[]): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = []
  for (const p of byChapter) {
    const target = betaTargetForChapter(p.chapter)
    if (p.rate > target) breaches.push({ chapter: p.chapter, rate: p.rate, target })
  }
  return breaches
}
