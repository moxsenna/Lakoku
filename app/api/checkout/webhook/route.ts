import { NextResponse } from 'next/server'
import { processPayCoreWebhook } from '@/lib/entitlement'
import { SupabaseEntitlementStore } from '@/lib/entitlement/store.server'
import { getPayCoreWebhookSecret } from '@/lib/paycore/config'

/**
 * Webhook pembayaran PayCore (M-PAY, inbound).
 *
 * Satu-satunya jalur yang boleh menerbitkan kredit (ARCH §26.8 poin 8, §29):
 * tak ada callback klien/return URL yang otoritatif. Handler membaca body MENTAH
 * (agar HMAC cocok byte-per-byte), memverifikasi tanda tangan + anti-replay
 * (docs/external/integration-guide §8), lalu grant kredit idempoten.
 *
 * Pemetaan hasil → HTTP (kontrak retry PayCore, payment-events.md):
 *  - rejected  → 400 (tanda tangan/payload tak valid; JANGAN retry)
 *  - duplicate → 200 (replay yang sudah diproses; idempoten)
 *  - applied   → 200
 *  - error DB  → 500 (biar PayCore retry dgn event_id sama; TIDAK fail-open ke grant)
 */
export async function POST(request: Request): Promise<Response> {
  const secret = getPayCoreWebhookSecret()
  if (!secret) {
    console.log('[v0] paycore webhook: PAYCORE_WEBHOOK_SECRET belum diset')
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const timestamp = request.headers.get('x-paycore-event-timestamp')
  const signature = request.headers.get('x-paycore-event-signature')

  try {
    const outcome = await processPayCoreWebhook(
      rawBody,
      { timestamp, signature },
      { store: new SupabaseEntitlementStore(), secret },
    )

    if (outcome.status === 'rejected') {
      return NextResponse.json({ error: outcome.reason }, { status: 400 })
    }
    return NextResponse.json(outcome, { status: 200 })
  } catch (err) {
    console.log('[v0] paycore webhook gagal proses:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
