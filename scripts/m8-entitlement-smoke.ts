/**
 * Smoke test M8/T8.3 — entitlement + webhook checkout (LOGIKA MURNI + orkestrasi
 * dengan store in-memory, tanpa jaringan/DB).
 *
 * Invarian keamanan yang diverifikasi (ARCH §8.4, §26.8 poin 8, §29):
 *  - HANYA event dengan tanda tangan HMAC valid & segar yang menerbitkan akses.
 *  - Tanda tangan hilang/rusak/salah/tampered → DITOLAK (fail-closed).
 *  - Stempel waktu kedaluwarsa (replay window) → DITOLAK.
 *  - Replay event (eventId sama) → idempoten, TANPA grant ganda.
 *  - Payload dari klien tanpa tanda tangan valid TIDAK pernah otoritatif.
 *  - Event revoke mencabut entitlement; jenis event tak dikenal → DITOLAK.
 *
 * Jalankan: npx tsx scripts/m8-entitlement-smoke.ts
 */
import {
  computeSignature,
  processCheckoutWebhook,
  InMemoryEntitlementStore,
} from '../lib/entitlement'

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

const SECRET = 'whsec_test_secret_lakoku'
const NOW = 1_800_000_000 // unix detik tetap → deterministik

/** Bangun body + header tanda tangan valid untuk sebuah event. */
function signed(
  event: Record<string, unknown>,
  opts: { secret?: string; t?: number } = {},
): { body: string; header: string } {
  const body = JSON.stringify(event)
  const t = opts.t ?? NOW
  const v1 = computeSignature(body, t, opts.secret ?? SECRET)
  return { body, header: `t=${t},v1=${v1}` }
}

function grantEvent(id: string, userId = 'user-1', code = 'story_create') {
  return {
    id,
    type: 'checkout.completed',
    data: { user_id: userId, entitlement_code: code },
  }
}

const verify = { secret: SECRET, nowSeconds: NOW }

async function run() {
  // 1) Tanda tangan valid & segar → grant diterapkan.
  {
    const store = new InMemoryEntitlementStore()
    const { body, header } = signed(grantEvent('evt_1'))
    const out = await processCheckoutWebhook(body, header, { store, verify })
    check('valid → applied grant', out.status === 'applied' && out.action === 'grant')
    check('valid → entitlement aktif', store.hasEntitlement('user-1', 'story_create'))
    check('valid → tepat 1 apply', store.applyCount === 1)
  }

  // 2) Tanda tangan hilang → ditolak, tak ada akses.
  {
    const store = new InMemoryEntitlementStore()
    const { body } = signed(grantEvent('evt_2'))
    const out = await processCheckoutWebhook(body, null, { store, verify })
    check('no signature → rejected', out.status === 'rejected' && out.reason === 'MISSING_SIGNATURE')
    check('no signature → tak ada apply', store.applyCount === 0)
  }

  // 3) Header rusak → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const { body } = signed(grantEvent('evt_3'))
    const out = await processCheckoutWebhook(body, 'garbage', { store, verify })
    check('malformed header → rejected', out.status === 'rejected' && out.reason === 'MALFORMED_SIGNATURE')
  }

  // 4) Tanda tangan salah (rahasia beda) → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const { body, header } = signed(grantEvent('evt_4'), { secret: 'rahasia-penyerang' })
    const out = await processCheckoutWebhook(body, header, { store, verify })
    check('wrong secret → rejected (BAD_SIGNATURE)', out.status === 'rejected' && out.reason === 'BAD_SIGNATURE')
    check('wrong secret → tak ada akses', store.applyCount === 0)
  }

  // 5) Body di-tamper setelah ditandatangani → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const { header } = signed(grantEvent('evt_5', 'user-1', 'story_create'))
    // Penyerang menaikkan hak ke paket lebih mahal setelah tanda tangan dibuat.
    const tampered = JSON.stringify(grantEvent('evt_5', 'user-1', 'premium_unlimited'))
    const out = await processCheckoutWebhook(tampered, header, { store, verify })
    check('tampered body → rejected', out.status === 'rejected' && out.reason === 'BAD_SIGNATURE')
    check('tampered body → tak ada grant premium', !store.hasEntitlement('user-1', 'premium_unlimited'))
  }

  // 6) Stempel waktu kedaluwarsa (di luar toleransi) → ditolak.
  {
    const store = new InMemoryEntitlementStore()
    const stale = signed(grantEvent('evt_6'), { t: NOW - 3600 }) // 1 jam lalu
    const out = await processCheckoutWebhook(stale.body, stale.header, { store, verify })
    check('stale timestamp → rejected', out.status === 'rejected' && out.reason === 'STALE_TIMESTAMP')
    check('stale timestamp → tak ada akses', store.applyCount === 0)
  }

  // 7) Replay event yang sama → idempoten, tanpa grant ganda.
  {
    const store = new InMemoryEntitlementStore()
    const { body, header } = signed(grantEvent('evt_7'))
    const first = await processCheckoutWebhook(body, header, { store, verify })
    const second = await processCheckoutWebhook(body, header, { store, verify })
    check('replay → pertama applied', first.status === 'applied')
    check('replay → kedua duplicate', second.status === 'duplicate')
    check('replay → hanya 1 apply (tak ganda)', store.applyCount === 1)
  }

  // 8) Payload dari klien tanpa tanda tangan valid TIDAK pernah otoritatif.
  {
    const store = new InMemoryEntitlementStore()
    const forged = JSON.stringify(grantEvent('evt_8', 'attacker', 'premium_unlimited'))
    // Klien mengaku sudah bayar, tapi tak punya HMAC valid.
    const out = await processCheckoutWebhook(forged, 't=' + NOW + ',v1=deadbeef', { store, verify })
    check('client-forged → rejected', out.status === 'rejected')
    check('client-forged → tak ada akses', store.applyCount === 0)
  }

  // 9) Event revoke mencabut entitlement yang aktif.
  {
    const store = new InMemoryEntitlementStore()
    const g = signed(grantEvent('evt_9a'))
    await processCheckoutWebhook(g.body, g.header, { store, verify })
    const r = signed({
      id: 'evt_9b',
      type: 'charge.refunded',
      data: { user_id: 'user-1', entitlement_code: 'story_create' },
    })
    const out = await processCheckoutWebhook(r.body, r.header, { store, verify })
    check('revoke → applied revoke', out.status === 'applied' && out.action === 'revoke')
    check('revoke → entitlement dicabut', !store.hasEntitlement('user-1', 'story_create'))
  }

  // 10) Jenis event tak dikenal → ditolak (tak fail-open).
  {
    const store = new InMemoryEntitlementStore()
    const u = signed({
      id: 'evt_10',
      type: 'invoice.weird_unknown',
      data: { user_id: 'user-1', entitlement_code: 'story_create' },
    })
    const out = await processCheckoutWebhook(u.body, u.header, { store, verify })
    check('unknown type → rejected', out.status === 'rejected' && out.reason === 'UNKNOWN_EVENT_TYPE')
  }

  // 11) Payload tak lengkap (tanpa user_id) → ditolak sebagai MALFORMED_PAYLOAD.
  {
    const store = new InMemoryEntitlementStore()
    const m = signed({ id: 'evt_11', type: 'checkout.completed', data: { entitlement_code: 'story_create' } })
    const out = await processCheckoutWebhook(m.body, m.header, { store, verify })
    check('missing user_id → rejected (MALFORMED_PAYLOAD)', out.status === 'rejected' && out.reason === 'MALFORMED_PAYLOAD')
  }

  // 12) Tanda tangan tepat di batas toleransi (300s) → diterima.
  {
    const store = new InMemoryEntitlementStore()
    const edge = signed(grantEvent('evt_12'), { t: NOW - 300 })
    const out = await processCheckoutWebhook(edge.body, edge.header, { store, verify })
    check('edge tolerance (=300s) → applied', out.status === 'applied')
  }

  console.log(`\nm8-entitlement-smoke: ${pass}/${pass + fail} PASS`)
  if (fail > 0) process.exit(1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
