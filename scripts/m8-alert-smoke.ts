/**
 * Smoke test M8/T8.2 — engine ALERT konsistensi (LOGIKA MURNI) + fixture regresi
 * kompaksi.
 *
 * Aturan yang diverifikasi (NCS §3.3 / ARCH §17.4):
 *   Alert bila `continuity_critical_rate` naik monoton terhadap nomor bab
 *   (indikasi kompaksi memori gagal).
 *
 * Fixture regresi kompaksi: seri per-bab yang MENAIK monoton (kompaksi gagal →
 * fakta load-bearing hilang → makin banyak sinyal CRITICAL per bab) HARUS
 * memicu alert; seri sehat (rate rendah rata / turun) TIDAK boleh.
 *
 * Jalankan: npx tsx scripts/m8-alert-smoke.ts
 */
import {
  aggregateConsistencyMetrics,
  evaluateCriticalRateAlert,
  betaTargetForChapter,
  CONTINUITY_MONOTONIC_ALERT,
  type ConsistencyInputs,
  type GenerationAttemptTelemetry,
} from '../lib/observability'

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

/**
 * Fixture regresi kompaksi: menghasilkan attempts di sejumlah bab dengan rate
 * critical yang mengikuti `rates` (porsi attempt CRITICAL per bab). `perChapter`
 * attempt per bab agar rate bisa presisi (mis. 4 → langkah 0.25).
 */
function compactionFixture(rates: { chapter: number; rate: number }[], perChapter = 4): ConsistencyInputs {
  const attempts: GenerationAttemptTelemetry[] = []
  for (const { chapter, rate } of rates) {
    const criticalCount = Math.round(rate * perChapter)
    for (let i = 0; i < perChapter; i++) {
      attempts.push(
        attempt({
          chapter,
          outcome: i < criticalCount ? 'REVIEW_REQUIRED' : 'PUBLISHED',
        }),
      )
    }
  }
  return { attempts, threads: [], reports: [], published: [] }
}

function metricsOf(inputs: ConsistencyInputs) {
  return aggregateConsistencyMetrics(inputs)
}

// ── Target beta band bab (NCS §3.3) ─────────────────────────────────
console.log('betaTargetForChapter:')
check('Bab 1–20 target 2%', betaTargetForChapter(1) === 0.02 && betaTargetForChapter(20) === 0.02)
check('Bab 21–50 target 5%', betaTargetForChapter(21) === 0.05 && betaTargetForChapter(50) === 0.05)

// ── FIXTURE REGRESI KOMPAKSI: tren naik monoton → ALERT ──────────────
console.log('\nFixture kompaksi gagal (naik monoton) → ALERT:')
{
  // Rate per bab: 0 → 0.25 → 0.5 → 0.75 (naik ketat monoton).
  const m = metricsOf(
    compactionFixture([
      { chapter: 1, rate: 0 },
      { chapter: 2, rate: 0.25 },
      { chapter: 3, rate: 0.5 },
      { chapter: 4, rate: 0.75 },
    ]),
  )
  check('metrik: tren terdeteksi naik monoton', m.criticalTrend.monotonicIncreasing === true)
  const alert = evaluateCriticalRateAlert(m, { storyId: 's1' })
  check('alert TER-TRIGGER', alert !== null)
  check('kind = CONTINUITY_CRITICAL_MONOTONIC', alert?.kind === CONTINUITY_MONOTONIC_ALERT)
  check('severity CRITICAL (akhir 75% > target)', alert?.severity === 'CRITICAL')
  check('rentang bab 1→4', alert?.firstChapter === 1 && alert?.lastChapter === 4)
  check('endRate 0.75', Math.abs((alert?.endRate ?? 0) - 0.75) < 1e-9)
  check('ada breach target beta', (alert?.breaches.length ?? 0) > 0)
  check('fingerprint memuat cakupan story', alert?.fingerprint.includes('s1') === true)
  check('pesan menyebut kompaksi', /kompaksi/i.test(alert?.message ?? ''))
  check('pesan bebas brand internal', !/narraza/i.test(alert?.message ?? ''))
}

// ── Early-warning: naik monoton TAPI masih di bawah target → WARNING ──
console.log('\nNaik monoton di bawah target beta → WARNING:')
{
  // perChapter 100 agar rate halus di bawah 2% band bab 1–20.
  const m = metricsOf(
    compactionFixture(
      [
        { chapter: 1, rate: 0 },
        { chapter: 2, rate: 0.005 },
        { chapter: 3, rate: 0.01 },
      ],
      1000,
    ),
  )
  const alert = evaluateCriticalRateAlert(m)
  check('alert ter-trigger (tren naik)', alert !== null)
  check('severity WARNING (masih < 2%)', alert?.severity === 'WARNING')
  check('cakupan global (storyId null)', alert?.storyId === null)
}

// ── Jalur SEHAT: rate rata/rendah → TANPA alert ──────────────────────
console.log('\nJalur sehat (rate rata) → TANPA alert:')
{
  const m = metricsOf(
    compactionFixture([
      { chapter: 1, rate: 0 },
      { chapter: 2, rate: 0 },
      { chapter: 3, rate: 0 },
    ]),
  )
  check('tren tidak naik', m.criticalTrend.monotonicIncreasing === false)
  check('TANPA alert', evaluateCriticalRateAlert(m) === null)
}

// ── Tren NAIK lalu TURUN (bukan monoton) → TANPA alert ───────────────
console.log('\nNaik lalu turun (bukan monoton) → TANPA alert:')
{
  const m = metricsOf(
    compactionFixture([
      { chapter: 1, rate: 0.25 },
      { chapter: 2, rate: 0.75 },
      { chapter: 3, rate: 0.25 },
    ]),
  )
  check('tren tidak dianggap naik monoton', m.criticalTrend.monotonicIncreasing === false)
  check('TANPA alert', evaluateCriticalRateAlert(m) === null)
}

// ── Guard noise: seri terlalu pendek → TANPA alert ───────────────────
console.log('\nSeri terlalu pendek (< minChapters) → TANPA alert:')
{
  // 2 bab naik: 0 → 0.5; secara teknis monoton, tapi < minChapters default (3).
  const m = metricsOf(
    compactionFixture([
      { chapter: 1, rate: 0 },
      { chapter: 2, rate: 0.5 },
    ]),
  )
  check('metrik menandai monoton (2 titik)', m.criticalTrend.monotonicIncreasing === true)
  check('alert diredam oleh minChapters', evaluateCriticalRateAlert(m) === null)
  check('minChapters=2 override → alert muncul', evaluateCriticalRateAlert(m, { minChapters: 2 }) !== null)
}

// ── Determinisme: evaluasi ulang identik ─────────────────────────────
console.log('\nDeterminisme:')
{
  const m = metricsOf(
    compactionFixture([
      { chapter: 1, rate: 0 },
      { chapter: 2, rate: 0.25 },
      { chapter: 3, rate: 0.5 },
    ]),
  )
  const a = evaluateCriticalRateAlert(m, { storyId: 's1' })
  const b = evaluateCriticalRateAlert(m, { storyId: 's1' })
  check('fingerprint stabil antar-evaluasi', a?.fingerprint === b?.fingerprint)
  check('pesan stabil antar-evaluasi', a?.message === b?.message)
}

console.log(`\n${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
