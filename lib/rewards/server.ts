import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@lakoku/db'
import {
  RewardPolicy,
  DEFAULT_REWARD_POLICY,
  calculateRedeemCredits,
  generateReferralCode,
} from './policy'

export interface ReferralStats {
  referralCode: string
  totalAttributions: number
  totalEarnedIdr: number
  currentBalanceIdr: number
}

export interface RedeemResult {
  creditsGranted: number
  deductedIdr: number
  remainingIdr: number
}

export async function getRewardPolicy(): Promise<RewardPolicy> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('reward_policy')
      .select('*')
      .eq('id', true)
      .maybeSingle()

    if (error || !data) {
      return DEFAULT_REWARD_POLICY
    }

    return {
      commissionPercent: data.commission_percent ?? DEFAULT_REWARD_POLICY.commissionPercent,
      windowDays: data.window_days ?? DEFAULT_REWARD_POLICY.windowDays,
      attributionCookieDays: data.attribution_cookie_days ?? DEFAULT_REWARD_POLICY.attributionCookieDays,
      redeemRateIdrPerCredit: data.redeem_rate_idr_per_credit ?? DEFAULT_REWARD_POLICY.redeemRateIdrPerCredit,
      redeemMinIdr: data.redeem_min_idr ?? DEFAULT_REWARD_POLICY.redeemMinIdr,
      commissionEnabled: data.commission_enabled ?? DEFAULT_REWARD_POLICY.commissionEnabled,
      redeemEnabled: data.redeem_enabled ?? DEFAULT_REWARD_POLICY.redeemEnabled,
      payoutEnabled: data.payout_enabled ?? DEFAULT_REWARD_POLICY.payoutEnabled,
      payoutMinIdr: data.payout_min_idr ?? DEFAULT_REWARD_POLICY.payoutMinIdr,
    }
  } catch {
    return DEFAULT_REWARD_POLICY
  }
}

export async function getRewardBalance(userId: string): Promise<number> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('reward_balance_v1', { p_user_id: userId })
  if (error) {
    throw new Error(`getRewardBalance: ${error.message}`)
  }
  return (data as number) ?? 0
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.code) {
    return existing.code
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const { data, error } = await db
      .from('referral_codes')
      .insert({ user_id: userId, code })
      .select('code')
      .maybeSingle()

    if (!error && data?.code) {
      return data.code
    }

    const { data: checkExisting } = await db
      .from('referral_codes')
      .select('code')
      .eq('user_id', userId)
      .maybeSingle()

    if (checkExisting?.code) {
      return checkExisting.code
    }
  }

  throw new Error('ensureReferralCode: failed to generate unique code after 5 attempts')
}

export async function redeemRewardCredits(
  userId: string,
  amountIdr: number
): Promise<RedeemResult> {
  const policy = await getRewardPolicy()

  if (!policy.redeemEnabled) {
    throw new Error('Penukaran imbalan sedang dinonaktifkan')
  }

  if (amountIdr < policy.redeemMinIdr) {
    throw new Error(`Jumlah penukaran minimal Rp${policy.redeemMinIdr.toLocaleString('id-ID')}`)
  }

  const balance = await getRewardBalance(userId)
  if (balance < amountIdr) {
    throw new Error('Saldo imbalan tidak mencukupi')
  }

  const calculation = calculateRedeemCredits(amountIdr, policy)
  if (calculation.creditsToGrant <= 0) {
    throw new Error('Jumlah penukaran tidak menghasilkan kredit')
  }

  const db = createAdminClient()
  const redeemId = randomUUID()
  const rewardRef = `redeem:${redeemId}`

  // Step 1: Deduct reward balance
  const { data: rewardGranted, error: rewardErr } = await db.rpc('grant_reward_v1', {
    p_user_id: userId,
    p_delta_idr: -calculation.costIdr,
    p_reason: 'redeem_credits',
    p_ref: rewardRef,
  })

  if (rewardErr || !rewardGranted) {
    throw new Error(`redeemRewardCredits reward deduct failed: ${rewardErr?.message ?? 'unknown'}`)
  }

  // Step 2: Grant reading credits
  const creditRef = `reward_redeem:${redeemId}`
  const { data: creditGranted, error: creditErr } = await db.rpc('grant_credits_v1', {
    p_user_id: userId,
    p_ref: creditRef,
    p_credits: calculation.creditsToGrant,
    p_reason: 'reward_redeem',
  })

  if (creditErr || !creditGranted) {
    // Step 3: Compensating rollback if credit grant fails
    await db.rpc('grant_reward_v1', {
      p_user_id: userId,
      p_delta_idr: calculation.costIdr,
      p_reason: 'redeem_rollback',
      p_ref: `rollback:${redeemId}`,
    })
    throw new Error(`redeemRewardCredits credit grant failed: ${creditErr?.message ?? 'unknown'}`)
  }

  return {
    creditsGranted: calculation.creditsToGrant,
    deductedIdr: calculation.costIdr,
    remainingIdr: balance - calculation.costIdr,
  }
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const db = createAdminClient()

  const [referralCode, balance, attributionsRes, earningsRes] = await Promise.all([
    ensureReferralCode(userId),
    getRewardBalance(userId),
    db
      .from('referral_attributions')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_user_id', userId),
    db
      .from('reward_ledger')
      .select('delta_idr')
      .eq('user_id', userId)
      .gt('delta_idr', 0),
  ])

  const totalEarnedIdr = (earningsRes.data ?? []).reduce(
    (acc: number, row: { delta_idr: number }) => acc + row.delta_idr,
    0
  )

  return {
    referralCode,
    totalAttributions: attributionsRes.count ?? 0,
    totalEarnedIdr,
    currentBalanceIdr: balance,
  }
}
