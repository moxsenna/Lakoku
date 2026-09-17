/**
 * Logika murni domain Dompet Imbalan & Referral (bebas I/O dan server-only).
 * Spec: docs/superpowers/specs/2026-09-17-dompet-imbalan-referral-design.md
 */

export interface RewardPolicy {
  commissionPercent: number
  windowDays: number
  attributionCookieDays: number
  redeemRateIdrPerCredit: number
  redeemMinIdr: number
  commissionEnabled: boolean
  redeemEnabled: boolean
  payoutEnabled: boolean
  payoutMinIdr: number
}

export const DEFAULT_REWARD_POLICY: RewardPolicy = {
  commissionPercent: 10,
  windowDays: 30,
  attributionCookieDays: 30,
  redeemRateIdrPerCredit: 250,
  redeemMinIdr: 1000,
  commissionEnabled: false, // default mati per spec §7
  redeemEnabled: true,
  payoutEnabled: false,
  payoutMinIdr: 50000,
}

export const REFERRAL_COOKIE_NAME = 'lakoku_ref'

// Karakter tanpa ambigu: hilangkan 0, O, 1, I, L
const SAFE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Hitung komisi rupiah dari harga bayar (priceIdr). */
export function calculateCommission(
  priceIdr: number,
  policy: RewardPolicy = DEFAULT_REWARD_POLICY,
): number {
  if (!policy.commissionEnabled) return 0
  if (priceIdr <= 0) return 0
  return Math.floor((priceIdr * policy.commissionPercent) / 100)
}

/** Periksa apakah waktu transaksi masih dalam batas jendela referral. */
export function isWithinWindow(
  attributedAt: Date | string,
  windowDays: number,
  now: Date = new Date(),
): boolean {
  const start = new Date(attributedAt).getTime()
  const current = now.getTime()
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  return current >= start && current <= start + windowMs
}

export interface RedeemResult {
  creditsToGrant: number
  costIdr: number
  remainderIdr: number
}

/** Hitung kredit yang didapat dari penukaran saldo imbalan rupiah. */
export function calculateRedeemCredits(
  amountIdr: number,
  policy: RewardPolicy = DEFAULT_REWARD_POLICY,
): RedeemResult {
  if (!policy.redeemEnabled) {
    throw new Error('Penukaran kredit sedang dinonaktifkan')
  }
  if (amountIdr < policy.redeemMinIdr) {
    throw new Error(`Penukaran minimal Rp${policy.redeemMinIdr.toLocaleString('id-ID')}`)
  }
  if (policy.redeemRateIdrPerCredit <= 0) {
    throw new Error('Kurs penukaran tidak valid')
  }

  const creditsToGrant = Math.floor(amountIdr / policy.redeemRateIdrPerCredit)
  const costIdr = creditsToGrant * policy.redeemRateIdrPerCredit
  const remainderIdr = amountIdr - costIdr

  return { creditsToGrant, costIdr, remainderIdr }
}

/** Validasi format kode referral (8 karakter, hanya alfabet aman). */
export function isValidReferralCode(code: string): boolean {
  if (!code || typeof code !== 'string' || code.length !== 8) return false
  const regex = new RegExp(`^[${SAFE_ALPHABET}]{8}$`)
  return regex.test(code.toUpperCase())
}

/** Hasilkan kode referral acak 8 karakter. */
export function generateReferralCode(): string {
  let result = ''
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor(Math.random() * SAFE_ALPHABET.length)
    result += SAFE_ALPHABET[idx]
  }
  return result
}
