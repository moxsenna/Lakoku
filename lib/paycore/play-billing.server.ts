import 'server-only'
import { createSign, createPrivateKey } from 'node:crypto'

/**
 * Verifikasi pembelian Google Play Billing — server-side, fail-closed.
 *
 * Pola sama dengan webhook PayCore: klien tidak pernah jadi sumber kebenaran.
 * Route pemanggil (app/api/play-billing/verify) memanggil fetchPurchaseState
 * lalu grant idempoten via play_billing_grant_v1 (credit_ledger.ref unik).
 *
 * Env (server-only, di VPS/docker-compose, TIDAK pernah ke klien):
 *  - GOOGLE_PLAY_BILLING_ENABLED=1      (kill switch; tanpa ini → 503)
 *  - GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL
 *  - GOOGLE_PLAY_PRIVATE_KEY            (PEM, newline di-escape \n)
 *  - GOOGLE_PLAY_PACKAGE_NAME           (default biz.lakoku.app)
 */

export interface PlayBillingConfig {
  serviceAccountEmail: string
  packageName: string
  privateKeyPem: string
}

/** Muat konfigurasi Play Billing. `null` bila nonaktif/kredensial kurang. */
export function loadPlayBillingConfig(): PlayBillingConfig | null {
  if (process.env.GOOGLE_PLAY_BILLING_ENABLED !== '1') return null
  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = process.env.GOOGLE_PLAY_PRIVATE_KEY?.trim()
  if (!email || !key) return null
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || 'biz.lakoku.app'
  return { serviceAccountEmail: email, packageName, privateKeyPem: key }
}

export interface PlayPurchaseState {
  purchaseState: number // 0 = purchased, 1 = canceled, 2 = pending payment
  consumptionState: number // 0 = belum dikonsumsi
  acknowledgementState: number // 0 pending, 1 acknowledged
  orderId: string | null
  kind: number // 1 = one-time product
}

export type PurchaseStateOutcome =
  | { ok: true; purchase: PlayPurchaseState }
  | { ok: false; reason: 'google_error'; status: number; detail: string }

/** Panggil purchases.products.get (Google Play Developer API v3). */
export async function fetchPurchaseState(
  config: PlayBillingConfig,
  productId: string,
  purchaseToken: string,
): Promise<PurchaseStateOutcome> {
  const assertion = await createGoogleJwtAssertion(
    config,
    'https://www.googleapis.com/auth/androidpublisher',
  )
  const url =
    'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    `${encodeURIComponent(config.packageName)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`

  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${assertion}` } })
  } catch (err) {
    return { ok: false, reason: 'google_error', status: 0, detail: (err as Error).message }
  }
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, reason: 'google_error', status: res.status, detail: text.slice(0, 300) }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'google_error', status: res.status, detail: 'invalid JSON' }
  }
  return {
    ok: true,
    purchase: {
      purchaseState: Number(parsed.purchaseState ?? -1),
      consumptionState: Number(parsed.consumptionState ?? -1),
      acknowledgementState: Number(parsed.acknowledgementState ?? -1),
      orderId: typeof parsed.orderId === 'string' ? parsed.orderId : null,
      kind: Number(parsed.kind ?? -1),
    },
  }
}

/** Keputusan pembelian boleh di-grant (fail-closed). */
export function isGrantablePurchase(p: PlayPurchaseState): boolean {
  return p.purchaseState === 0 && p.consumptionState === 0 && p.kind === 1
}

/** JWT bearer assertion (RS256) service account → access token Google. */
async function createGoogleJwtAssertion(config: PlayBillingConfig, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: config.serviceAccountEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3000,
    iat: now,
  }
  const b64u = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64u(header)}.${b64u(claims)}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const signed = signer.sign(createPrivateKey(config.privateKeyPem)).toString('base64url')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signed}`,
    }),
  })
  if (!tokenRes.ok) {
    throw new Error(`google token endpoint: ${tokenRes.status} ${(await tokenRes.text()).slice(0, 200)}`)
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string }
  return tokenJson.access_token
}
