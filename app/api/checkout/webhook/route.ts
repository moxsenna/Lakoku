import { NextResponse } from 'next/server'
import { processCheckoutWebhook } from '@/lib/entitlement'
import { SupabaseEntitlementStore } from '@/lib/entitlement/store.server'

/**
 * Webhook checkout provider (M8/T8.3).
 *
 * Satu-satunya jalur yang boleh menerbitkan entitlement (ARCH §26.8 poin 8,
 * §29): tak ada callback klien/mobile yang cukup untuk memberi akses. Handler
 * membaca body MENTAH (agar HMAC cocok byte-per-byte), memverifikasi tanda
 * tangan + anti-replay, lalu menerapkan grant/revoke idempoten.
 *
 * Pemetaan status → HTTP:
 *  - rejected  → 400 (jangan retry: tanda tangan/payload tak valid)
 *  - duplicate → 200 (replay yang sudah diproses; idempoten)
 *  - applied   → 200
 *  - error DB  → 500 (biar provider retry; TIDAK fail-open ke grant)
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CHECKOUT_WEBHOOK_SECRET
  if (!secret) {
    console.log('[v0] checkout webhook: CHECKOUT_WEBHOOK_SECRET belum diset')
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const signature =
    request.headers.get('x-checkout-signature') ??
    request.headers.get('x-signature')

  try {
    const outcome = await processCheckoutWebhook(rawBody, signature, {
      store: new SupabaseEntitlementStore(),
      verify: { secret },
    })

    if (outcome.status === 'rejected') {
      return NextResponse.json({ error: outcome.reason }, { status: 400 })
    }
    return NextResponse.json(outcome, { status: 200 })
  } catch (err) {
    console.log('[v0] checkout webhook gagal proses:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}


export const runtime = 'edge';
