import { NextResponse } from 'next/server'
import { loadConsistencyMetrics } from '@/lib/observability/server'

/**
 * Metrik konsistensi (T8.1 / G3-METRICS) untuk dashboard & konsumen alert (T8.2).
 * Selalu dinamis: membaca event log & thread live via service-role (server-only).
 * `?storyId=` mempersempit ke satu story; tanpa itu → agregat global ops.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const storyId = searchParams.get('storyId') ?? undefined
  try {
    const metrics = await loadConsistencyMetrics(storyId)
    return NextResponse.json({ ok: true, storyId: storyId ?? null, metrics })
  } catch (err) {
    console.log('[v0] /api/admin/metrics gagal:', (err as Error)?.message)
    return NextResponse.json(
      { ok: false, error: 'Gagal memuat metrik konsistensi.' },
      { status: 500 },
    )
  }
}


export const runtime = 'edge';
