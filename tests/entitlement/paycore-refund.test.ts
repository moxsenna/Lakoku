import { describe, expect, it, vi } from 'vitest'
import { processPayCoreWebhook, verifyPayCoreEvent } from '@/lib/entitlement/paycore'
import { InMemoryEntitlementStore } from '@/lib/entitlement/store'

const SECRET = 'test-secret-payout'
const NOW = 1_800_000_000_000

function signedBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

// Helper HMAC — sama kontrak dgn lib/paycore/crypto (sha256 hex).
async function sign(body: string, tsIso: string): Promise<string> {
  const { hmacSha256Hex } = await import('@/lib/paycore/crypto')
  return `sha256=${await hmacSha256Hex(SECRET, `${tsIso}.${body}`)}`
}

describe('PayCore refund event (audit M3)', () => {
  const tsIso = new Date(NOW).toISOString()

  it('verify: payment.refunded diterima tanpa fulfillment_data', async () => {
    const body = signedBody({ event_id: 'e1', event_type: 'payment.refunded', data: { order_id: 'ord-1' } })
    const sig = await sign(body, tsIso)
    const res = await verifyPayCoreEvent(body, tsIso, sig, { secret: SECRET, nowMs: NOW })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.event.eventType).toBe('payment.refunded')
      expect(res.event.orderId).toBe('ord-1')
    }
  })

  it('verify: event type tak dikenal tetap ditolak', async () => {
    const body = signedBody({ event_id: 'e2', event_type: 'payment.payout', data: { order_id: 'ord-1' } })
    const sig = await sign(body, tsIso)
    const res = await verifyPayCoreEvent(body, tsIso, sig, { secret: SECRET, nowMs: NOW })
    expect(res).toEqual({ ok: false, reason: 'UNKNOWN_EVENT_TYPE' })
  })

  it('process: refund menarik kredit grant asli (clawback idempoten)', async () => {
    const store = new InMemoryEntitlementStore()
    // Simulasi grant asli: order ord-9 memberi 100 kredit ke user-1.
    await store.grantCredits('user-1', 'paycore:ord-9', 100, 'topup:x:first_topup')

    const body = signedBody({ event_id: 'e3', event_type: 'payment.refunded', data: { order_id: 'ord-9' } })
    const sig = await sign(body, tsIso)

    const outcome = await processPayCoreWebhook(
      body,
      { timestamp: tsIso, signature: sig },
      { store, secret: SECRET, nowMs: NOW },
    )
    expect(outcome.status).toBe('refunded')
    if (outcome.status === 'refunded') {
      expect(outcome.credits).toBe(100)
      expect(outcome.orderId).toBe('ord-9')
    }
    expect(store.creditBalance('user-1')).toBe(0)

    // Replay refund → duplicate (tidak menarik dua kali)
    const replay = await processPayCoreWebhook(
      body,
      { timestamp: tsIso, signature: sig },
      { store, secret: SECRET, nowMs: NOW },
    )
    expect(replay.status).toBe('duplicate')
    expect(store.creditBalance('user-1')).toBe(0)
  })

  it('process: refund untuk grant tak dikenal → ignored (200, tanpa clawback)', async () => {
    const store = new InMemoryEntitlementStore()
    const body = signedBody({ event_id: 'e4', event_type: 'payment.refunded', data: { order_id: 'ord-tidak-ada' } })
    const sig = await sign(body, tsIso)

    const outcome = await processPayCoreWebhook(
      body,
      { timestamp: tsIso, signature: sig },
      { store, secret: SECRET, nowMs: NOW },
    )
    expect(outcome.status).toBe('ignored')
  })

  it('process: refund dgn user_id mismatch → ditolak (fail-closed)', async () => {
    const store = new InMemoryEntitlementStore()
    await store.grantCredits('user-1', 'paycore:ord-7', 50, 'topup:x:none')

    const body = signedBody({
      event_id: 'e5',
      event_type: 'payment.refunded',
      data: { order_id: 'ord-7', fulfillment_data: { user_id: 'user-lain' } },
    })
    const sig = await sign(body, tsIso)

    const outcome = await processPayCoreWebhook(
      body,
      { timestamp: tsIso, signature: sig },
      { store, secret: SECRET, nowMs: NOW },
    )
    expect(outcome.status).toBe('rejected')
    expect(store.creditBalance('user-1')).toBe(50) // tidak tercabut
  })

  it('process: alur succeeded lama tidak berubah', async () => {
    const store = new InMemoryEntitlementStore()
    store.setOrderSnapshot('ord-2', { totalCredits: 80, bonusKind: 'none', productKey: 'pk-60', status: 'created' })
    const spyRevoke = vi.spyOn(store, 'revokeCredits')

    const body = signedBody({
      event_id: 'e6',
      event_type: 'payment.succeeded',
      data: {
        order_id: 'ord-2',
        fulfillment_data: { user_id: 'user-2', credits: 999 },
      },
    })
    const sig = await sign(body, tsIso)

    const outcome = await processPayCoreWebhook(
      body,
      { timestamp: tsIso, signature: sig },
      { store, secret: SECRET, nowMs: NOW },
    )
    expect(outcome.status).toBe('applied')
    if (outcome.status === 'applied') expect(outcome.credits).toBe(80) // snapshot menang
    expect(spyRevoke).not.toHaveBeenCalled()
  })
})
