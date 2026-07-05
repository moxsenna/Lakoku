/**
 * Engine metrik konsistensi (M8/T8.1 — NTM G3-METRICS) — LOGIKA MURNI.
 *
 * Semua rate dashboard dihitung deterministik dari input ternormalisasi
 * (telemetri generasi + thread + laporan pembaca + bab published). Modul ini
 * TAK menyentuh DB/jaringan agar bisa diuji penuh via smoke test — pemuatan
 * data hidup di `./telemetry` (server-only).
 *
 * Definisi metrik (dipakai konsisten oleh dashboard & alert T8.2):
 *  - continuity_critical_rate  : porsi attempt dengan sinyal continuity CRITICAL
 *                                (outcome REVIEW_REQUIRED, atau CRITICAL tersisa),
 *                                dilaporkan total & PER BAB.
 *  - repair_success_rate       : dari attempt yang butuh repair (repairAttempts>0),
 *                                porsi yang akhirnya PUBLISHED.
 *  - review_required_rate      : porsi attempt yang berakhir REVIEW_REQUIRED.
 *  - thread_staleness          : porsi thread aktif (non-RESOLVED) yang stale.
 *  - reader_inconsistency_report_rate : laporan pembaca per bab published.
 */

export type GenerationOutcome = 'PUBLISHED' | 'REVIEW_REQUIRED'

/** Satu attempt generasi bab (dipancarkan ke story_events: GENERATION_ATTEMPT). */
export interface GenerationAttemptTelemetry {
  storyId: string
  chapter: number
  outcome: GenerationOutcome
  /** total repair attempt (Lapis A + B). */
  repairAttempts: number
  /** findings TERSISA di akhir pipeline, per severity. */
  criticalRemaining: number
  majorRemaining: number
  minorRemaining: number
  /** ISO timestamp (urutan waktu). */
  at: string
}

export interface ThreadStalenessInput {
  storyId: string
  threadId: string
  title: string
  /** OPEN | PAYOFF_DUE | RESOLVED | ... */
  status: string
  stale: boolean
  staleSinceChapter: number | null
  isMainMystery: boolean
}

export interface ReaderReportInput {
  storyId: string
  chapter: number
  at: string
}

export interface PublishedChapterInput {
  storyId: string
  chapter: number
}

export interface ConsistencyInputs {
  attempts: GenerationAttemptTelemetry[]
  threads: ThreadStalenessInput[]
  reports: ReaderReportInput[]
  published: PublishedChapterInput[]
}

export interface Rate {
  numerator: number
  denominator: number
  /** numerator/denominator; 0 bila denominator 0 (hindari NaN). */
  rate: number
}

export interface ChapterCriticalPoint {
  chapter: number
  attempts: number
  criticalAttempts: number
  rate: number
}

export interface StaleThreadRef {
  threadId: string
  title: string
  staleSinceChapter: number | null
  isMainMystery: boolean
}

export interface CriticalTrend {
  /** rate per bab (urut menaik) yang dipakai untuk deteksi tren. */
  series: { chapter: number; rate: number }[]
  /** true bila seluruh seri non-menurun DAN titik akhir > titik awal. */
  monotonicIncreasing: boolean
  /** panjang rentetan naik-ketat terpanjang (fondasi alert T8.2). */
  longestIncreasingRun: number
}

export interface ConsistencyMetrics {
  totalAttempts: number
  continuityCriticalRate: Rate
  continuityCriticalByChapter: ChapterCriticalPoint[]
  repairSuccessRate: Rate
  reviewRequiredRate: Rate
  threadStaleness: {
    total: number
    stale: number
    rate: number
    staleThreads: StaleThreadRef[]
  }
  readerInconsistencyReportRate: Rate
  criticalTrend: CriticalTrend
}

function rate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : 0,
  }
}

/** Attempt dianggap membawa sinyal continuity CRITICAL bila gagal review atau menyisakan CRITICAL. */
export function hasCriticalSignal(a: GenerationAttemptTelemetry): boolean {
  return a.outcome === 'REVIEW_REQUIRED' || a.criticalRemaining > 0
}

function computeByChapter(attempts: GenerationAttemptTelemetry[]): ChapterCriticalPoint[] {
  const byChapter = new Map<number, { attempts: number; critical: number }>()
  for (const a of attempts) {
    const bucket = byChapter.get(a.chapter) ?? { attempts: 0, critical: 0 }
    bucket.attempts += 1
    if (hasCriticalSignal(a)) bucket.critical += 1
    byChapter.set(a.chapter, bucket)
  }
  return [...byChapter.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([chapter, b]) => ({
      chapter,
      attempts: b.attempts,
      criticalAttempts: b.critical,
      rate: b.attempts > 0 ? b.critical / b.attempts : 0,
    }))
}

function computeTrend(byChapter: ChapterCriticalPoint[]): CriticalTrend {
  const series = byChapter.map((p) => ({ chapter: p.chapter, rate: p.rate }))

  let longestIncreasingRun = series.length ? 1 : 0
  let currentRun = series.length ? 1 : 0
  let nonDecreasing = true
  for (let i = 1; i < series.length; i++) {
    if (series[i].rate > series[i - 1].rate) {
      currentRun += 1
      longestIncreasingRun = Math.max(longestIncreasingRun, currentRun)
    } else {
      currentRun = 1
      if (series[i].rate < series[i - 1].rate) nonDecreasing = false
    }
  }

  const monotonicIncreasing =
    series.length >= 2 && nonDecreasing && series[series.length - 1].rate > series[0].rate

  return { series, monotonicIncreasing, longestIncreasingRun }
}

/**
 * Agregasi seluruh metrik konsistensi dari input ternormalisasi. Deterministik &
 * bebas efek samping — aman dipanggil di server component, API, atau test.
 */
export function aggregateConsistencyMetrics(input: ConsistencyInputs): ConsistencyMetrics {
  const { attempts, threads, reports, published } = input

  const totalAttempts = attempts.length
  const criticalAttempts = attempts.filter(hasCriticalSignal).length
  const reviewRequired = attempts.filter((a) => a.outcome === 'REVIEW_REQUIRED').length

  const repaired = attempts.filter((a) => a.repairAttempts > 0)
  const repairedPublished = repaired.filter((a) => a.outcome === 'PUBLISHED').length

  const byChapter = computeByChapter(attempts)

  const activeThreads = threads.filter((t) => t.status !== 'RESOLVED')
  const staleThreads = activeThreads.filter((t) => t.stale)

  const publishedCount = published.length

  return {
    totalAttempts,
    continuityCriticalRate: rate(criticalAttempts, totalAttempts),
    continuityCriticalByChapter: byChapter,
    repairSuccessRate: rate(repairedPublished, repaired.length),
    reviewRequiredRate: rate(reviewRequired, totalAttempts),
    threadStaleness: {
      total: activeThreads.length,
      stale: staleThreads.length,
      rate: activeThreads.length > 0 ? staleThreads.length / activeThreads.length : 0,
      staleThreads: staleThreads
        .sort((a, b) => (a.staleSinceChapter ?? 0) - (b.staleSinceChapter ?? 0))
        .map((t) => ({
          threadId: t.threadId,
          title: t.title,
          staleSinceChapter: t.staleSinceChapter,
          isMainMystery: t.isMainMystery,
        })),
    },
    readerInconsistencyReportRate: rate(reports.length, publishedCount),
    criticalTrend: computeTrend(byChapter),
  }
}
