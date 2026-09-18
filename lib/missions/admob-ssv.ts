/**
 * Verifikasi Server-Side Verification (SSV) AdMob.
 *
 * Google menandatangani querystring callback dengan ECDSA SHA-256. Pesan yang
 * ditandatangani adalah querystring MENTAH dari karakter pertama sampai tepat
 * sebelum `&signature=`. Membangun ulang querystring lewat URLSearchParams akan
 * mengubah encoding dan MERUSAK verifikasi, jadi kita selalu memotong string asli.
 *
 * Referensi format: ad_network, ad_unit, custom_data, key_id, reward_amount,
 * reward_item, signature, timestamp, transaction_id, user_id.
 */

import { createVerify } from 'node:crypto'

const VERIFIER_KEYS_URL = 'https://gstatic.com/admob/reward/verifier-keys.json'
const KEY_CACHE_TTL_MS = 6 * 60 * 60 * 1000

export interface AdMobVerifierKey {
  keyId: string
  pem: string
  base64: string
}

interface KeyCache {
  keys: Map<string, AdMobVerifierKey>
  fetchedAt: number
}

let cache: KeyCache | null = null

/** Hanya untuk pengujian: kosongkan cache kunci di memori. */
export function resetVerifierKeyCache(): void {
  cache = null
}

interface RawVerifierKey {
  keyId: number | string
  pem: string
  base64: string
}

async function fetchVerifierKeys(): Promise<Map<string, AdMobVerifierKey>> {
  const res = await fetch(VERIFIER_KEYS_URL, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`fetchVerifierKeys: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { keys?: RawVerifierKey[] }
  const keys = new Map<string, AdMobVerifierKey>()
  for (const key of body.keys ?? []) {
    keys.set(String(key.keyId), {
      keyId: String(key.keyId),
      pem: key.pem,
      base64: key.base64,
    })
  }
  if (keys.size === 0) {
    throw new Error('fetchVerifierKeys: daftar kunci kosong')
  }
  return keys
}

/**
 * Ambil kunci publik untuk `keyId`. Cache 6 jam, tetapi bila `keyId` tidak
 * dikenal kita memaksa pengambilan ulang — Google merotasi kunci tanpa
 * pemberitahuan dan cache basi akan menolak callback yang sah.
 */
export async function getVerifierKey(keyId: string): Promise<AdMobVerifierKey | null> {
  const fresh = cache && Date.now() - cache.fetchedAt < KEY_CACHE_TTL_MS
  if (fresh && cache) {
    const hit = cache.keys.get(keyId)
    if (hit) return hit
  }

  const keys = await fetchVerifierKeys()
  cache = { keys, fetchedAt: Date.now() }
  return keys.get(keyId) ?? null
}

/**
 * Potong bagian querystring yang ditandatangani: semua karakter sebelum
 * `&signature=`. Mengembalikan null bila penanda tidak ditemukan.
 */
export function extractSignedMessage(rawQuery: string): string | null {
  const marker = '&signature='
  const idx = rawQuery.indexOf(marker)
  if (idx <= 0) return null
  return rawQuery.slice(0, idx)
}

/** Ambil satu nilai parameter dari querystring mentah tanpa mengubah encoding. */
export function readRawParam(rawQuery: string, name: string): string | null {
  for (const pair of rawQuery.split('&')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    if (pair.slice(0, eq) !== name) continue
    return decodeURIComponent(pair.slice(eq + 1))
  }
  return null
}

/** Verifikasi tanda tangan ECDSA SHA-256 atas pesan yang sudah dipotong. */
export function verifySignature(args: {
  message: string
  signatureBase64Url: string
  publicKeyPem: string
}): boolean {
  try {
    const verifier = createVerify('SHA256')
    verifier.update(args.message)
    verifier.end()
    return verifier.verify(
      { key: args.publicKeyPem, format: 'pem', type: 'spki' },
      Buffer.from(args.signatureBase64Url, 'base64url'),
    )
  } catch {
    return false
  }
}

export interface SsvCallback {
  transactionId: string
  userId: string
  adUnit: string
  rewardAmount: number
  timestampMs: number
  keyId: string
  signature: string
}

export type SsvParseResult =
  | { ok: true; callback: SsvCallback; signedMessage: string }
  | { ok: false; reason: 'malformed' | 'missing_fields' }

/** Urai querystring callback menjadi bentuk terstruktur tanpa memverifikasi. */
export function parseSsvQuery(rawQuery: string): SsvParseResult {
  const signedMessage = extractSignedMessage(rawQuery)
  if (!signedMessage) return { ok: false, reason: 'malformed' }

  const transactionId = readRawParam(rawQuery, 'transaction_id')
  const userId = readRawParam(rawQuery, 'user_id')
  const keyId = readRawParam(rawQuery, 'key_id')
  const signature = readRawParam(rawQuery, 'signature')
  const timestamp = readRawParam(rawQuery, 'timestamp')

  if (!transactionId || !userId || !keyId || !signature || !timestamp) {
    return { ok: false, reason: 'missing_fields' }
  }

  const timestampMs = Number(timestamp)
  const rewardAmount = Number(readRawParam(rawQuery, 'reward_amount') ?? '0')

  return {
    ok: true,
    signedMessage,
    callback: {
      transactionId,
      userId,
      adUnit: readRawParam(rawQuery, 'ad_unit') ?? '',
      rewardAmount: Number.isFinite(rewardAmount) ? rewardAmount : 0,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
      keyId,
      signature,
    },
  }
}
