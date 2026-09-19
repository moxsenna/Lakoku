/**
 * Callback Server-Side Verification (SSV) Google AdMob.
 *
 * Google melakukan HTTP GET ke endpoint ini saat pengguna selesai menonton
 * iklan rewarded. Endpoint ini:
 *  1. Memotong querystring asli persis sebelum `&signature=`
 *  2. Mengambil kunci publik Google berdasarkan `key_id`
 *  3. Memverifikasi tanda tangan ECDSA SHA-256
 *  4. Memeriksa kesegaran stempel waktu (anti-replay callback dicuri)
 *  5. Memanggil RPC atomik untuk mencatat tayangan sah dan menegakkan cap harian
 *
 * Status respons mengikuti protokol AdMob:
 *  - 200 OK: callback diterima (baik sah maupun replay yang sudah pernah diproses)
 *  - 400 Bad Request: format salah atau tanda tangan tidak valid
 */

import { getVerifierKey, parseSsvQuery, verifySignature } from '@/lib/missions/admob-ssv'
import { getMissionPolicy, recordAdMobRejection, recordAdMobSsv } from '@/lib/missions/server'
import { isSsvTimestampFresh } from '@/lib/missions/policy'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search

  if (!rawQuery) {
    return new Response('missing query', { status: 400 })
  }

  const parsed = parseSsvQuery(rawQuery)
  if (!parsed.ok) {
    return new Response(`bad request: ${parsed.reason}`, { status: 400 })
  }

  const { callback, signedMessage } = parsed

  // Google key fetch
  const key = await getVerifierKey(callback.keyId)
  if (!key) {
    await recordAdMobRejection({
      transactionId: callback.transactionId,
      userId: UUID_RE.test(callback.userId) ? callback.userId : null,
      status: 'invalid_signature',
    })
    return new Response('unknown key_id', { status: 400 })
  }

  // ECDSA SHA-256 verification
  const valid = verifySignature({
    message: signedMessage,
    signatureBase64Url: callback.signature,
    publicKeyPem: key.pem,
  })

  if (!valid) {
    await recordAdMobRejection({
      transactionId: callback.transactionId,
      userId: UUID_RE.test(callback.userId) ? callback.userId : null,
      status: 'invalid_signature',
    })
    return new Response('invalid signature', { status: 400 })
  }

  // Freshness check
  const policy = await getMissionPolicy()
  const fresh = isSsvTimestampFresh(callback.timestampMs, policy)
  if (!fresh) {
    await recordAdMobRejection({
      transactionId: callback.transactionId,
      userId: UUID_RE.test(callback.userId) ? callback.userId : null,
      status: 'stale',
    })
    return new Response('stale callback', { status: 400 })
  }

  // User id validation
  if (!UUID_RE.test(callback.userId)) {
    await recordAdMobRejection({
      transactionId: callback.transactionId,
      userId: null,
      status: 'unknown_user',
    })
    return new Response('invalid user_id format', { status: 400 })
  }

  // Record via atomic RPC (handles replay + cap)
  const recorded = await recordAdMobSsv({
    userId: callback.userId,
    transactionId: callback.transactionId,
    adUnit: callback.adUnit,
    rewardAmount: callback.rewardAmount,
  })

  if (!recorded.ok && recorded.status === 'error') {
    return new Response('internal error', { status: 500 })
  }

  // Google expects 200 on successful processing (even duplicates, to stop retry loop)
  return new Response('OK', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export const dynamic = 'force-dynamic'
