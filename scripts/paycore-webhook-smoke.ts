/**
 * Smoke test M-PAY inbound — webhook PayCore → kredit (LOGIKA MURNI + orkestrasi
 * dengan store in-memory, tanpa jaringan/DB).
 *
 * Invarian keamanan (integration-guide §8, payment-events.md):
 *  - HANYA event bertanda tangan HMAC valid & segar yang menerbitkan kredit.
 *  - Tanda tangan hilang/rusak/salah/tampered → DITOLAK (fail-closed).
 *  - Stempel waktu kedaluwarsa → DITOLAK.
 *  - Replay event (event_id sama) → idempoten, TANPA kredit ganda.
 *  - Order sama (ref ledger) walau event_id beda → tak grant ganda (defense-in-depth).
 *  - event_type tak dikenal / payload tak lengkap → DITOLAK.
 *
 * Jalankan: node scripts/run-smoke.cjs scripts/paycore-webhook-smoke.ts
 */
import { hmacSha256Hex } from '../lib/paycore/crypto'
import { processPayCoreWebhook, InMemoryEntitlementStore } from '../lib/entitlement'

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

const SECRET = 'whsec_paycore_test'
const TS = '2026-06-24T10:05:00.000Z'
const NOW_MS = Date.parse(TS)

function paymentSucceeded(overrides: {
  eventId?: string
  orderId?: string
  userId?: string
  credits?: number
  productKey?: string
  eventType?: string
} = {}): Record<string, unknown> {
  return {
    event_id: overrides.eventId ?? 'evt_1',
    event_type: overrides.eventType ?? 'payment.succeeded',
    occurred_at: TS,
    data: {
      order_id: overrides.orderId ?? 'LAK-20260624-AAA',
      external_order_id: 'lakoku-abc',
      app_id: 'lakoku',
      provider: 'duitku',
      amount: 30000,
      currency: 'IDR',
      product_key: overrides.productKey ?? 'credits_basic',
      fulfillment_data: {
        user_id: overrides.userId ?? 'user-1',
        package_id: 'credits_basic',
        credits: overrides.credits ?? 70,
      },
      paid_at: TS,
    },
  }
}

async function signed(
  payload: Record<string, unknown>,
  opts: { secret?: string; ts?: string } = {},
): Promise<{ body: string; timestamp: string; signature: string }> {
  const body = JSON.stringify(payload)
  const timestamp = opts.ts ?? TS
  const hex = await hmacSha256Hex(opts.secret ?? SECRET, `${timestamp}.${body}`)
  return { body, timestamp, signature: `sha256=${hex}` }
}

const deps = (store: InMemoryEntitlementStore) => ({ store, secret: SECRET, nowMs: NOW_MS })

async function run() {
  // 1) Valid → applied, kredit di-grant sekali.
  {
    const store = new InMemoryEntitlementStore()
    const { body, timestamp, signature } = await signed(paymentSucceeded())
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('valid → applied', out.status === 'applied')
    check('valid → saldo 70', store.creditBalance('user-1') === 70)
    check('valid → tepat 1 grant', store.grantCreditsCount === 1)
  }

  // 2) Tanda tangan hilang → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const { body, timestamp } = await signed(paymentSucceeded({ eventId: 'evt_2' }))
    const out = await processPayCoreWebhook(body, { timestamp, signature: null }, deps(store))
    check('no signature → rejected', out.status === 'rejected' && out.reason === 'MISSING_SIGNATURE')
    check('no signature → saldo 0', store.creditBalance('user-1') === 0)
  }

  // 3) Timestamp hilang → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const { body, signature } = await signed(paymentSucceeded({ eventId: 'evt_3' }))
    const out = await processPayCoreWebhook(body, { timestamp: null, signature }, deps(store))
    check('no timestamp → rejected', out.status === 'rejected' && out.reason === 'MALFORMED_SIGNATURE')
  }

  // 4) Rahasia salah → BAD_SIGNATURE, tak ada kredit.
  {
    const store = new InMemoryEntitlementStore()
    const { body, timestamp, signature } = await signed(paymentSucceeded({ eventId: 'evt_4' }), {
      secret: 'rahasia-penyerang',
    })
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('wrong secret → BAD_SIGNATURE', out.status === 'rejected' && out.reason === 'BAD_SIGNATURE')
    check('wrong secret → saldo 0', store.creditBalance('user-1') === 0)
  }

  // 5) Body di-tamper setelah ditandatangani → BAD_SIGNATURE.
  {
    const store = new InMemoryEntitlementStore()
    const { timestamp, signature } = await signed(paymentSucceeded({ eventId: 'evt_5', credits: 70 }))
    // Penyerang menaikkan kredit setelah tanda tangan dibuat.
    const tampered = JSON.stringify(paymentSucceeded({ eventId: 'evt_5', credits: 999999 }))
    const out = await processPayCoreWebhook(tampered, { timestamp, signature }, deps(store))
    check('tampered → BAD_SIGNATURE', out.status === 'rejected' && out.reason === 'BAD_SIGNATURE')
    check('tampered → saldo 0', store.creditBalance('user-1') === 0)
  }

  // 6) Stempel waktu kedaluwarsa → STALE_TIMESTAMP.
  {
    const store = new InMemoryEntitlementStore()
    const staleTs = new Date(NOW_MS - 3_600_000).toISOString() // 1 jam lalu
    const { body, timestamp, signature } = await signed(paymentSucceeded({ eventId: 'evt_6' }), { ts: staleTs })
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('stale → STALE_TIMESTAMP', out.status === 'rejected' && out.reason === 'STALE_TIMESTAMP')
  }

  // 7) Replay event_id sama → duplicate, tanpa kredit ganda.
  {
    const store = new InMemoryEntitlementStore()
    const { body, timestamp, signature } = await signed(paymentSucceeded({ eventId: 'evt_7' }))
    const first = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    const second = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('replay → pertama applied', first.status === 'applied')
    check('replay → kedua duplicate', second.status === 'duplicate')
    check('replay → saldo tetap 70', store.creditBalance('user-1') === 70)
    check('replay → hanya 1 grant', store.grantCreditsCount === 1)
  }

  // 8) event_type tak dikenal → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const { body, timestamp, signature } = await signed(
      paymentSucceeded({ eventId: 'evt_8', eventType: 'payment.refunded' }),
    )
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('unknown type → UNKNOWN_EVENT_TYPE', out.status === 'rejected' && out.reason === 'UNKNOWN_EVENT_TYPE')
  }

  // 9) Payload tak lengkap (tanpa user_id) → MALFORMED_PAYLOAD.
  {
    const store = new InMemoryEntitlementStore()
    const payload = paymentSucceeded({ eventId: 'evt_9' })
    delete ((payload.data as Record<string, unknown>).fulfillment_data as Record<string, unknown>).user_id
    const { body, timestamp, signature } = await signed(payload)
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('no user_id → MALFORMED_PAYLOAD', out.status === 'rejected' && out.reason === 'MALFORMED_PAYLOAD')
  }

  // 10) Kredit non-positif → MALFORMED_PAYLOAD (tak boleh grant 0/negatif).
  {
    const store = new InMemoryEntitlementStore()
    const { body, timestamp, signature } = await signed(paymentSucceeded({ eventId: 'evt_10', credits: 0 }))
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('credits<=0 → MALFORMED_PAYLOAD', out.status === 'rejected' && out.reason === 'MALFORMED_PAYLOAD')
  }

  // 11) Order sama (ref ledger) walau event_id beda → tak grant ganda.
  {
    const store = new InMemoryEntitlementStore()
    const a = await signed(paymentSucceeded({ eventId: 'evt_11a', orderId: 'LAK-DUP' }))
    const b = await signed(paymentSucceeded({ eventId: 'evt_11b', orderId: 'LAK-DUP' }))
    await processPayCoreWebhook(a.body, { timestamp: a.timestamp, signature: a.signature }, deps(store))
    await processPayCoreWebhook(b.body, { timestamp: b.timestamp, signature: b.signature }, deps(store))
    check('order dedup → saldo tetap 70', store.creditBalance('user-1') === 70)
    check('order dedup → hanya 1 grant', store.grantCreditsCount === 1)
  }

  // 12) Tepat di batas toleransi (300s) → applied.
  {
    const store = new InMemoryEntitlementStore()
    const edgeTs = new Date(NOW_MS - 300_000).toISOString()
    const { body, timestamp, signature } = await signed(paymentSucceeded({ eventId: 'evt_12' }), { ts: edgeTs })
    const out = await processPayCoreWebhook(body, { timestamp, signature }, deps(store))
    check('edge tolerance (=300s) → applied', out.status === 'applied')
  }

  console.log(`\npaycore-webhook-smoke: ${pass}/${pass + fail} PASS`)
  if (fail > 0) process.exit(1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
