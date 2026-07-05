/**
 * Smoke test M8/T8.1 — engine metrik konsistensi (LOGIKA MURNI).
 *
 * Memverifikasi definisi rate dashboard (G3-METRICS): continuity critical,
 * repair success, review required, thread staleness, laporan pembaca/bab, plus
 * agregasi per-bab & deteksi tren (fondasi alert T8.2).
 *
 * Jalankan: npx tsx scripts/m8-metrics-smoke.ts
 */
import {
  aggregateConsistencyMetrics,
  hasCriticalSignal,
  type ConsistencyInputs,
  type GenerationAttemptTelemetry,
} from '../lib/observability/metrics'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  PASS ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}`)
  }
}
function approx(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps
}

function attempt(over: Partial<GenerationAttemptTelemetry>): GenerationAttemptTelemetry {
  return {
    storyId: 's1',
    chapter: 1,
    outcome: 'PUBLISHED',
    repairAttempts: 0,
    criticalRemaining: 0,
    majorRemaining: 0,
    minorRemaining: 0,
    at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

// ── hasCriticalSignal ────────────────────────────────────────────────
console.log('hasCriticalSignal:')
check('review-required = critical signal', hasCriticalSignal(attempt({ outcome: 'REVIEW_REQUIRED' })))
check('critical remaining = critical signal', hasCriticalSignal(attempt({ criticalRemaining: 1 })))
check('published bersih ≠ critical signal', !hasCriticalSignal(attempt({})))
check(
  'published dengan minor ≠ critical signal',
  !hasCriticalSignal(attempt({ minorRemaining: 3, majorRemaining: 2 })),
)

// ── Rate dasar ───────────────────────────────────────────────────────
console.log('\nRate dasar:')
{
  const inputs: ConsistencyInputs = {
    attempts: [
      attempt({ chapter: 1, outcome: 'PUBLISHED', repairAttempts: 0 }),
      attempt({ chapter: 2, outcome: 'PUBLISHED', repairAttempts: 2 }), // repaired -> success
      attempt({ chapter: 3, outcome: 'REVIEW_REQUIRED', repairAttempts: 3 }), // repaired -> fail + critical
      attempt({ chapter: 4, outcome: 'PUBLISHED', repairAttempts: 0, criticalRemaining: 1 }), // critical remaining
    ],
    threads: [],
    reports: [],
    published: [],
  }
  const m = aggregateConsistencyMetrics(inputs)
  check('total attempts = 4', m.totalAttempts === 4)
  // critical signals: ch3 (review) + ch4 (criticalRemaining) = 2/4
  check('continuity critical rate = 2/4', approx(m.continuityCriticalRate.rate, 0.5))
  // repaired attempts: ch2, ch3 => 1 published => 1/2
  check('repair success rate = 1/2', approx(m.repairSuccessRate.rate, 0.5))
  check('repair denom hanya yang direpair = 2', m.repairSuccessRate.denominator === 2)
  // review required: ch3 => 1/4
  check('review required rate = 1/4', approx(m.reviewRequiredRate.rate, 0.25))
}

// ── Guard pembagian nol ──────────────────────────────────────────────
console.log('\nGuard nol:')
{
  const m = aggregateConsistencyMetrics({ attempts: [], threads: [], reports: [], published: [] })
  check('critical rate 0 saat kosong (bukan NaN)', m.continuityCriticalRate.rate === 0)
  check('repair rate 0 saat tak ada repair', m.repairSuccessRate.rate === 0)
  check('reader report rate 0 saat tak ada bab', m.readerInconsistencyReportRate.rate === 0)
  check('staleness rate 0 saat tak ada thread', m.threadStaleness.rate === 0)
}

// ── Per-bab & tren ───────────────────────────────────────────────────
console.log('\nPer-bab & tren (monoton naik):')
{
  // rate per bab: 0, 0.5, 1.0 -> naik ketat monoton
  const inputs: ConsistencyInputs = {
    attempts: [
      attempt({ chapter: 1, outcome: 'PUBLISHED' }),
      attempt({ chapter: 2, outcome: 'PUBLISHED' }),
      attempt({ chapter: 2, outcome: 'REVIEW_REQUIRED' }),
      attempt({ chapter: 3, outcome: 'REVIEW_REQUIRED' }),
    ],
    threads: [],
    reports: [],
    published: [],
  }
  const m = aggregateConsistencyMetrics(inputs)
  check('3 titik bab', m.continuityCriticalByChapter.length === 3)
  check('bab urut menaik', m.continuityCriticalByChapter.map((p) => p.chapter).join(',') === '1,2,3')
  check('bab1 rate 0', approx(m.continuityCriticalByChapter[0].rate, 0))
  check('bab2 rate 0.5', approx(m.continuityCriticalByChapter[1].rate, 0.5))
  check('bab3 rate 1.0', approx(m.continuityCriticalByChapter[2].rate, 1))
  check('tren terdeteksi NAIK monoton', m.criticalTrend.monotonicIncreasing === true)
  check('longest increasing run = 3', m.criticalTrend.longestIncreasingRun === 3)
}

console.log('\nTren TIDAK naik (turun/rata):')
{
  const inputs: ConsistencyInputs = {
    attempts: [
      attempt({ chapter: 1, outcome: 'REVIEW_REQUIRED' }), // 1.0
      attempt({ chapter: 2, outcome: 'PUBLISHED' }), // 0
    ],
    threads: [],
    reports: [],
    published: [],
  }
  const m = aggregateConsistencyMetrics(inputs)
  check('tren tidak dianggap naik', m.criticalTrend.monotonicIncreasing === false)
}

// ── Thread staleness ─────────────────────────────────────────────────
console.log('\nThread staleness:')
{
  const inputs: ConsistencyInputs = {
    attempts: [],
    threads: [
      { storyId: 's1', threadId: 't1', title: 'Utas A', status: 'OPEN', stale: true, staleSinceChapter: 3, isMainMystery: false },
      { storyId: 's1', threadId: 't2', title: 'Misteri', status: 'PAYOFF_DUE', stale: true, staleSinceChapter: 2, isMainMystery: true },
      { storyId: 's1', threadId: 't3', title: 'Utas C', status: 'OPEN', stale: false, staleSinceChapter: null, isMainMystery: false },
      { storyId: 's1', threadId: 't4', title: 'Selesai', status: 'RESOLVED', stale: true, staleSinceChapter: 1, isMainMystery: false },
    ],
    reports: [],
    published: [],
  }
  const m = aggregateConsistencyMetrics(inputs)
  // RESOLVED dikecualikan dari denom & dari daftar stale
  check('thread aktif = 3 (RESOLVED dikecualikan)', m.threadStaleness.total === 3)
  check('stale = 2', m.threadStaleness.stale === 2)
  check('staleness rate = 2/3', approx(m.threadStaleness.rate, 2 / 3))
  check('daftar stale tak memuat RESOLVED', !m.threadStaleness.staleThreads.some((t) => t.threadId === 't4'))
  check('daftar stale urut sejak bab (t2 sblm t1)', m.threadStaleness.staleThreads[0].threadId === 't2')
}

// ── Reader inconsistency report rate ─────────────────────────────────
console.log('\nLaporan pembaca / bab:')
{
  const inputs: ConsistencyInputs = {
    attempts: [],
    threads: [],
    reports: [
      { storyId: 's1', chapter: 1, at: '2026-01-01T00:00:00Z' },
      { storyId: 's1', chapter: 1, at: '2026-01-02T00:00:00Z' },
      { storyId: 's1', chapter: 2, at: '2026-01-03T00:00:00Z' },
    ],
    published: [
      { storyId: 's1', chapter: 1 },
      { storyId: 's1', chapter: 2 },
    ],
  }
  const m = aggregateConsistencyMetrics(inputs)
  check('reader report rate = 3/2', approx(m.readerInconsistencyReportRate.rate, 1.5))
  check('reader report numerator = 3', m.readerInconsistencyReportRate.numerator === 3)
  check('reader report denom (bab published) = 2', m.readerInconsistencyReportRate.denominator === 2)
}

console.log(`\n${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
