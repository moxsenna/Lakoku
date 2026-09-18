/**
 * Logika murni domain kebijakan Tinta & penukaran Lakoin (bebas I/O dan server-only).
 * Spec: docs/superpowers/plans/2026-09-19-lakoin-tinta-economy.md (§7.4, §8, §9)
 */

import { jakartaDay } from '@/lib/missions/policy'

export { jakartaDay }

export interface TintaPolicy {
  tintaPerRead: number
  authorDailyCap: number
  tintaCheckin: number
  tintaChoice: number
  tintaAdBatch: number
  tintaPerLakoin: number
  exchangeMinLakoin: number
  pendingHours: number
  authorRewardsEnabled: boolean
  exchangeEnabled: boolean
  missionsPayTinta: boolean
}

export const DEFAULT_TINTA_POLICY: TintaPolicy = {
  tintaPerRead: 10,
  authorDailyCap: 300,
  tintaCheckin: 5,
  tintaChoice: 10,
  tintaAdBatch: 10,
  tintaPerLakoin: 100,
  exchangeMinLakoin: 1,
  pendingHours: 24,
  authorRewardsEnabled: false,
  exchangeEnabled: false,
  missionsPayTinta: false,
}

export type TintaSource =
  | 'mission_checkin'
  | 'mission_choice'
  | 'mission_ad_batch'
  | 'author_read_reward'

export const TINTA_SOURCES: readonly TintaSource[] = [
  'mission_checkin',
  'mission_choice',
  'mission_ad_batch',
  'author_read_reward',
] as const

export type AuthorRewardStatus =
  | 'ok'
  | 'duplicate'
  | 'capped'
  | 'disabled'
  | 'ineligible'

export const AUTHOR_REWARD_STATUSES: readonly AuthorRewardStatus[] = [
  'ok',
  'duplicate',
  'capped',
  'disabled',
  'ineligible',
] as const

export interface TintaExchangeResult {
  lakoinOut: number
  tintaSpent: number
  remainderTinta: number
}

/**
 * Hitung penukaran saldo Tinta menjadi Lakoin.
 * Reader-safe: throw jika dimatikan atau hasil di bawah batas minimum.
 */
export function calculateTintaExchange(
  amountTinta: number,
  policy: TintaPolicy = DEFAULT_TINTA_POLICY,
): TintaExchangeResult {
  if (!policy.exchangeEnabled) {
    throw new Error('Penukaran sedang dinonaktifkan.')
  }
  if (!Number.isFinite(policy.tintaPerLakoin) || policy.tintaPerLakoin <= 0) {
    throw new Error('Kurs penukaran tidak valid.')
  }

  const safeAmount = Number.isFinite(amountTinta) ? Math.floor(amountTinta) : 0
  if (safeAmount <= 0) {
    throw new Error(`Penukaran minimal ${policy.exchangeMinLakoin} Lakoin.`)
  }

  const lakoinOut = Math.floor(safeAmount / policy.tintaPerLakoin)
  if (lakoinOut < policy.exchangeMinLakoin) {
    throw new Error(`Penukaran minimal ${policy.exchangeMinLakoin} Lakoin.`)
  }

  const tintaSpent = lakoinOut * policy.tintaPerLakoin
  const remainderTinta = safeAmount - tintaSpent

  return {
    lakoinOut,
    tintaSpent,
    remainderTinta,
  }
}

/**
 * Format kunci idempotensi reward baca penulis.
 * Format persis sama dengan RPC SQL grant_author_tinta_v1.
 */
export function authorRewardRef(
  storyId: string,
  chapter: number | string,
  readerId: string,
): string {
  return `author_read:${storyId}:${chapter}:${readerId}`
}

export type TintaAmountBucket = '1_9' | '10_49' | '50_99' | '100_plus'

export const TINTA_AMOUNT_BUCKETS: readonly TintaAmountBucket[] = [
  '1_9',
  '10_49',
  '50_99',
  '100_plus',
] as const

/**
 * Bucket analytics untuk jumlah Tinta (§9 spec).
 */
export function tintaAmountBucket(amount: number): TintaAmountBucket {
  if (amount < 10) return '1_9'
  if (amount < 50) return '10_49'
  if (amount < 100) return '50_99'
  return '100_plus'
}

export type LakoinOutBucket = '1_4' | '5_19' | '20_99' | '100_plus'

export const LAKOIN_OUT_BUCKETS: readonly LakoinOutBucket[] = [
  '1_4',
  '5_19',
  '20_99',
  '100_plus',
] as const

/**
 * Bucket analytics untuk jumlah Lakoin hasil tukar (§9 spec).
 */
export function lakoinOutBucket(amount: number): LakoinOutBucket {
  if (amount < 5) return '1_4'
  if (amount < 20) return '5_19'
  if (amount < 100) return '20_99'
  return '100_plus'
}
