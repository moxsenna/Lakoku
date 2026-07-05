import type { Metadata } from 'next'
import { loadConsistencyMetrics } from '@/lib/observability/server'
import { evaluateCriticalRateAlert, type ConsistencyAlert } from '@/lib/observability'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard, type MetricTone } from '@/components/dashboard/metric-card'
import { CriticalRateChart } from '@/components/dashboard/critical-rate-chart'
import { StaleThreadsList } from '@/components/dashboard/stale-threads-list'
import { AlertBanner } from '@/components/dashboard/alert-banner'

export const metadata: Metadata = {
  title: 'Konsistensi — Dashboard Ops',
  description:
    'Metrik konsistensi naratif: continuity critical rate, repair success, review required, thread staleness, dan laporan pembaca.',
}

// Selalu segar — ini panel observability, bukan konten yang boleh basi.
export const dynamic = 'force-dynamic'

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/** Ambang tone dashboard (rate rendah = sehat untuk metrik "buruk"). */
function badWhenHigh(rate: number, warn = 0.1, bad = 0.25): MetricTone {
  if (rate >= bad) return 'bad'
  if (rate >= warn) return 'warn'
  return 'good'
}

/** repair success: tinggi = sehat. */
function goodWhenHigh(rate: number, warn = 0.75, bad = 0.5): MetricTone {
  if (rate <= bad) return 'bad'
  if (rate <= warn) return 'warn'
  return 'good'
}

export default async function ConsistencyDashboardPage() {
  let metrics: Awaited<ReturnType<typeof loadConsistencyMetrics>> | null = null
  let alert: ConsistencyAlert | null = null
  let loadError = false
  try {
    metrics = await loadConsistencyMetrics()
    alert = evaluateCriticalRateAlert(metrics)
  } catch (err) {
    console.log('[v0] dashboard konsistensi gagal memuat:', (err as Error)?.message)
    loadError = true
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl text-foreground text-balance">Konsistensi Naratif</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Panel observability lintas-cerita (G3-METRICS). Semua angka dihitung dari event log
          generasi, thread aktif, dan laporan pembaca.
        </p>
      </header>

      {loadError || !metrics ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Gagal memuat metrik</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground text-pretty">
              Data observability sementara tak tersedia. Coba muat ulang halaman; jalur pembaca dan
              generasi tidak terpengaruh.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <AlertBanner alert={alert} />
          <section
            aria-label="Ringkasan metrik"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <MetricCard
              label="Continuity Critical Rate"
              value={pct(metrics.continuityCriticalRate.rate)}
              detail={`${metrics.continuityCriticalRate.numerator}/${metrics.continuityCriticalRate.denominator} attempt`}
              tone={badWhenHigh(metrics.continuityCriticalRate.rate)}
            />
            <MetricCard
              label="Repair Success Rate"
              value={pct(metrics.repairSuccessRate.rate)}
              detail={`${metrics.repairSuccessRate.numerator}/${metrics.repairSuccessRate.denominator} perlu repair`}
              tone={goodWhenHigh(metrics.repairSuccessRate.rate)}
            />
            <MetricCard
              label="Review Required Rate"
              value={pct(metrics.reviewRequiredRate.rate)}
              detail={`${metrics.reviewRequiredRate.numerator}/${metrics.reviewRequiredRate.denominator} attempt`}
              tone={badWhenHigh(metrics.reviewRequiredRate.rate)}
            />
            <MetricCard
              label="Laporan Pembaca / Bab"
              value={metrics.readerInconsistencyReportRate.rate.toFixed(2)}
              detail={`${metrics.readerInconsistencyReportRate.numerator} laporan / ${metrics.readerInconsistencyReportRate.denominator} bab`}
              tone={badWhenHigh(metrics.readerInconsistencyReportRate.rate, 0.15, 0.4)}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Continuity Critical Rate per Bab</CardTitle>
            </CardHeader>
            <CardContent>
              <CriticalRateChart
                data={metrics.continuityCriticalByChapter}
                trendUp={metrics.criticalTrend.monotonicIncreasing}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Thread Staleness{' '}
                <span className="font-normal text-muted-foreground">
                  ({metrics.threadStaleness.stale}/{metrics.threadStaleness.total} aktif ·{' '}
                  {pct(metrics.threadStaleness.rate)})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StaleThreadsList threads={metrics.threadStaleness.staleThreads} />
            </CardContent>
          </Card>
        </>
      )}
    </main>
  )
}


export const runtime = 'edge';
