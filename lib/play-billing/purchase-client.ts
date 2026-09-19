/**
 * Orkestrasi purchase Play Billing sisi klien — murni & testable.
 *
 * Lapisan ini TIDAK menyentuh `window`/CdvPurchase langsung: store diinjeksikan
 * lewat `PurchaseStore` sehingga unit test memakai mock. Komponen
 * (`AndroidBuySection`) yang menyuntikkan store nyata dari WebView.
 * Klien tidak dipercaya: server (`POST /api/play-billing/verify`) yang
 * memvalidasi ke Google dan menghitung kredit.
 */

export interface ApprovedPurchaseInfo {
  productId: string
  purchaseToken: string
  orderId: string | null
}

export interface VerifyRequestBody {
  productId: string
  purchaseToken: string
  orderId?: string
}

export type VerifyOutcome =
  | { ok: true; totalCredits: number; alreadyGranted: boolean }
  | { ok: false; error: string }

export type PurchaseResult =
  | { ok: true; totalCredits: number; alreadyGranted: boolean }
  | { ok: false; error: 'cancelled' | 'failed' | 'verification_failed' | 'network_error' }

/** Bangun body verify dari transaksi approved (tanpa field liar). */
export function buildVerifyBody(info: ApprovedPurchaseInfo): VerifyRequestBody {
  const body: VerifyRequestBody = {
    productId: info.productId.trim(),
    purchaseToken: info.purchaseToken,
  }
  if (info.orderId) body.orderId = info.orderId
  return body
}

/** Petakan respons route verify menjadi outcome purchase. */
export function interpretVerifyResponse(json: unknown): VerifyOutcome {
  if (!json || typeof json !== 'object') return { ok: false, error: 'invalid_response' }
  const r = json as Record<string, unknown>
  if (r.ok === true && typeof r.totalCredits === 'number') {
    return {
      ok: true,
      totalCredits: r.totalCredits,
      alreadyGranted: r.alreadyGranted === true,
    }
  }
  return { ok: false, error: typeof r.error === 'string' ? r.error : 'verification_failed' }
}

/** Petakan kode error order plugin menjadi hasil ramah-pembaca. */
export function interpretOrderError(code: string | number | null | undefined): PurchaseResult {
  const normalized = typeof code === 'string' ? code : String(code ?? '')
  if (/cancel/i.test(normalized)) return { ok: false, error: 'cancelled' }
  return { ok: false, error: 'failed' }
}

/** Pesan reader-safe per hasil (tanpa jargon platform). */
export function purchaseResultMessage(result: PurchaseResult): string | null {
  if (result.ok) {
    return result.alreadyGranted
      ? `Kredit sudah masuk sebelumnya (+${result.totalCredits}).`
      : `Pembayaran berhasil! +${result.totalCredits} kredit masuk.`
  }
  switch (result.error) {
    case 'cancelled':
      return null // Batal = diam, jangan tampilkan error.
    case 'verification_failed':
      return 'Pembayaran belum terverifikasi. Coba lagi nanti.'
    case 'network_error':
      return 'Gagal terhubung. Coba lagi.'
    case 'failed':
    default:
      return 'Pembayaran gagal. Coba lagi.'
  }
}
