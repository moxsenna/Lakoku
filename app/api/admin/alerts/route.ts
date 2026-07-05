import { NextResponse } from 'next/server'
import { loadConsistencyMetrics, dispatchConsistencyAlert } from '@/lib/observability/server'

/**
 * Alert konsistensi (T8.2 / NCS §3.3, ARCH §17.4).
 *
 * GET  → evaluasi alert continuity-critical-monotonic dari metrik live (read-only,
 *        TAK mengirim ke sink) — dipakai dashboard untuk banner.
 * POST → evaluasi + KIRIM ke sink eksternal (webhook) best-effort — dipakai oleh
 *        cron/scheduler ops atau tombol "kirim uji". Dedup di-cache proses.
 *
 * `?storyId=` mempersempit ke satu story; tanpa itu → agregat global ops.
 * Selalu dinamis: membaca event log & thread live via service-role (server-only).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const storyId = searchParams.get('storyId') ?? undefined
  try {
    const metrics = await loadConsistencyMetrics(storyId)
    const { evaluateCriticalRateAlert } = await import('@/lib/observability')
    const alert = evaluateCriticalRateAlert(metrics, { storyId: storyId ?? null })
    return NextResponse.json({ ok: true, storyId: storyId ?? null, alert })
  } catch (err) {
    console.log('[v0] GET /api/admin/alerts gagal:', (err as Error)?.message)
    return NextResponse.json({ ok: false, error: 'Gagal mengevaluasi alert.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const storyId = searchParams.get('storyId') ?? undefined
  try {
    const metrics = await loadConsistencyMetrics(storyId)
    const result = await dispatchConsistencyAlert(metrics, { storyId: storyId ?? null })
    return NextResponse.json({ ok: true, storyId: storyId ?? null, ...result })
  } catch (err) {
    // dispatch sendiri tak melempar; ini jaga-jaga untuk load metrik.
    console.log('[v0] POST /api/admin/alerts gagal:', (err as Error)?.message)
    return NextResponse.json({ ok: false, error: 'Gagal mengirim alert.' }, { status: 500 })
  }
}


export const runtime = 'edge';
