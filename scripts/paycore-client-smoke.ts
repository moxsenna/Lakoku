/**
 * Smoke M-PAY outbound — penandatanganan request app PayCore (integration-guide §6).
 * Murni & tanpa jaringan: memverifikasi canonical string & determinisme HMAC.
 *
 * Canonical: `{timestamp}.{METHOD}.{path}.{sha256hex(rawBody)}`
 *
 * Jalankan: node scripts/run-smoke.cjs scripts/paycore-client-smoke.ts
 */
import { buildAppRequestSignature } from '../lib/paycore/client'
import { hmacSha256Hex, sha256Hex } from '../lib/paycore/crypto'

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

const SECRET = 'app_secret_test'
const TS = '2026-06-24T10:00:00.000Z'
const PATH = '/v1/orders'
const BODY = JSON.stringify({ external_order_id: 'lakoku-1', amount: 30000 })

async function run() {
  const sig = await buildAppRequestSignature({
    appSecret: SECRET,
    timestamp: TS,
    method: 'POST',
    path: PATH,
    rawBody: BODY,
  })

  // Cocok dengan canonical yang dihitung independen.
  const bodyHash = await sha256Hex(BODY)
  const expected = await hmacSha256Hex(SECRET, `${TS}.POST.${PATH}.${bodyHash}`)
  check('canonical string sesuai spec §6', sig === expected)
  check('signature 64 hex chars', /^[0-9a-f]{64}$/.test(sig))

  // Deterministik.
  const sig2 = await buildAppRequestSignature({
    appSecret: SECRET,
    timestamp: TS,
    method: 'POST',
    path: PATH,
    rawBody: BODY,
  })
  check('deterministik antar-panggilan', sig === sig2)

  // METHOD di-uppercase (post === POST).
  const sigLower = await buildAppRequestSignature({
    appSecret: SECRET,
    timestamp: TS,
    method: 'post',
    path: PATH,
    rawBody: BODY,
  })
  check('method di-normalisasi uppercase', sig === sigLower)

  // Body beda → signature beda.
  const sigOther = await buildAppRequestSignature({
    appSecret: SECRET,
    timestamp: TS,
    method: 'POST',
    path: PATH,
    rawBody: JSON.stringify({ external_order_id: 'lakoku-2', amount: 999999 }),
  })
  check('body berbeda → signature berbeda', sig !== sigOther)

  // Secret beda → signature beda.
  const sigSecret = await buildAppRequestSignature({
    appSecret: 'app_secret_lain',
    timestamp: TS,
    method: 'POST',
    path: PATH,
    rawBody: BODY,
  })
  check('secret berbeda → signature berbeda', sig !== sigSecret)

  console.log(`\npaycore-client-smoke: ${pass}/${pass + fail} PASS`)
  if (fail > 0) process.exit(1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
