/**
 * Kalkulasi bonus topup — LOGIKA MURNI, tanpa server-only atau I/O.
 *
 * Dibaca dari `lib/paycore/products.ts` (server-side) maupun dari unit test
 * tanpa perlu mock `server-only`.
 *
 * Interface `CreditProductMinimal` sengaja minimal (subset dari CreditProduct)
 * agar file ini bebas impor server-only.
 */

/** Subset minimal CreditProduct — cukup untuk hitung bonus. */
export interface CreditProductMinimal {
  credits: number
  normalBonusCredits: number
  firstTopupBonusCredits: number
  bonusActive: boolean
}

export type BonusKind = 'first_topup' | 'normal' | 'none'

export interface TopupCreditCalculation {
  baseCredits: number
  bonusCredits: number
  totalCredits: number
  bonusKind: BonusKind
}

/**
 * Hitung kredit topup server-side: base + bonus (first topup atau normal).
 * Bonus hanya berlaku bila `product.bonusActive` = true.
 * Semua angka berasal dari DB credit_products, bukan dari client.
 */
export function calculateTopupCredits(
  product: CreditProductMinimal,
  isFirstTopup: boolean,
): TopupCreditCalculation {
  const bonusCredits = product.bonusActive
    ? isFirstTopup
      ? product.firstTopupBonusCredits
      : product.normalBonusCredits
    : 0

  const bonusKind: BonusKind =
    bonusCredits <= 0 ? 'none' : isFirstTopup ? 'first_topup' : 'normal'

  return {
    baseCredits: product.credits,
    bonusCredits,
    totalCredits: product.credits + bonusCredits,
    bonusKind,
  }
}
