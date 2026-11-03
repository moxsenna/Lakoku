import { randomUUID } from 'node:crypto'
import { getDb, single, result, countOf, rpcOne } from '@lakoku/db'
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
    const db = getDb()
    // RLS_AUDIT: reward_policy_read
    const { data, error } = await single(
      db
        .selectFrom('reward_policy')
        .selectAll()
        .where('id', '=', true)
        .limit(1)
        .execute(),
    )

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
  const db = getDb()
  // RLS_AUDIT: reward_ledger_own_read
  const { data, error } = await single(rpcOne(db, 'reward_balance_v1', { p_user_id: userId }).execute())
  if (error) {
    throw new Error(`getRewardBalance: ${error.message}`)
  }
  const raw = data ? ((data as Record<string, unknown>).fn ?? data) : 0
  return Number(raw ?? 0)
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const db = getDb()

  // RLS_AUDIT: referral_codes_own_read
  const { data: existing } = await single(
    db
      .selectFrom('referral_codes')
      .select('code')
      .where('user_id', '=', userId)
      .limit(1)
      .execute(),
  )

  if (existing?.code) {
    return existing.code
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const { data } = await single(
      db
        .insertInto('referral_codes')
        .values({ user_id: userId, code })
        .returning('code')
        .execute(),
    )

    if (data?.code) {
      return data.code
    }

    const { data: checkExisting } = await single(
      db
        .selectFrom('referral_codes')
        .select('code')
        .where('user_id', '=', userId)
        .limit(1)
        .execute(),
    )

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

  const db = getDb()
  const redeemId = randomUUID()

  // Atomik (audit B3): cek saldo pindah ke DALAM redeem_reward_credits_v1
  // (advisory lock per-user + kedua ledger dalam satu transaksi DB). Race
  // request paralel tidak bisa lagi membuat saldo minus; retry dengan id
  // sama bersifat idempoten.
  const { data: statusData, error: redeemErr } = await single(
    rpcOne(db, 'redeem_reward_credits_v1', {
      p_user_id: userId,
      p_redeem_id: redeemId,
      p_amount_idr: calculation.costIdr,
      p_credits: calculation.creditsToGrant,
    }).execute(),
  )
  if (redeemErr) {
    throw new Error(`redeemRewardCredits failed: ${redeemErr.message}`)
  }
  const status = statusData ? ((statusData as Record<string, unknown>).fn ?? statusData) : null

  if (status === 'insufficient') {
    throw new Error('Saldo imbalan tidak mencukupi')
  }
  if (status === 'duplicate') {
    throw new Error('Transaksi penukaran sedang diproses')
  }
  if (status !== 'ok') {
    throw new Error(`redeem_reward_credits_v1 failed: ${String(status)}`)
  }

  return {
    creditsGranted: calculation.creditsToGrant,
    deductedIdr: calculation.costIdr,
    remainingIdr: balance - calculation.costIdr,
  }
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const db = getDb()

  // RLS_AUDIT: referral_attributions_own_read, reward_ledger_own_read
  const [referralCode, balance, totalAttributions, earningsRes] = await Promise.all([
    ensureReferralCode(userId),
    getRewardBalance(userId),
    countOf(
      db
        .selectFrom('referral_attributions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('referrer_user_id', '=', userId)
        .execute(),
    ),
    result(
      db
        .selectFrom('reward_ledger')
        .select('delta_idr')
        .where('user_id', '=', userId)
        .where('delta_idr', '>', 0)
        .execute(),
    ),
  ])

  const totalEarnedIdr = (earningsRes.data ?? []).reduce(
    (acc: number, row: { delta_idr: number }) => acc + row.delta_idr,
    0
  )

  return {
    referralCode,
    totalAttributions,
    totalEarnedIdr,
    currentBalanceIdr: balance,
  }
}
