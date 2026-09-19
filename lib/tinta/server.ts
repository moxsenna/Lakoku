import 'server-only'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@lakoku/db'
import {
  DEFAULT_TINTA_POLICY,
  calculateTintaExchange,
  type TintaPolicy,
} from './policy'

export interface TintaBalance {
  total: number
  available: number
  pending: number
}

export interface ExchangeResult {
  lakoinOut: number
  tintaSpent: number
}

export interface TintaLedgerRow {
  id: string
  delta: number
  reason: string
  ref: string
  pending_until: string | null
  created_at: string
  pendingUntil: string | null
  createdAt: string
}

/**
 * Membaca konfigurasi kebijakan Tinta aktif dari database.
 * Fallback ke DEFAULT_TINTA_POLICY bila tabel kosong atau query gagal (fail-open).
 */
export async function getTintaPolicy(): Promise<TintaPolicy> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('tinta_policy')
      .select('*')
      .eq('id', true)
      .maybeSingle()

    if (error || !data) {
      return DEFAULT_TINTA_POLICY
    }

    return {
      tintaPerRead: data.tinta_per_read ?? DEFAULT_TINTA_POLICY.tintaPerRead,
      authorDailyCap: data.author_daily_cap ?? DEFAULT_TINTA_POLICY.authorDailyCap,
      tintaCheckin: data.tinta_checkin ?? DEFAULT_TINTA_POLICY.tintaCheckin,
      tintaChoice: data.tinta_choice ?? DEFAULT_TINTA_POLICY.tintaChoice,
      tintaAdBatch: data.tinta_ad_batch ?? DEFAULT_TINTA_POLICY.tintaAdBatch,
      tintaPerLakoin: data.tinta_per_lakoin ?? DEFAULT_TINTA_POLICY.tintaPerLakoin,
      exchangeMinLakoin: data.exchange_min_lakoin ?? DEFAULT_TINTA_POLICY.exchangeMinLakoin,
      pendingHours: data.pending_hours ?? DEFAULT_TINTA_POLICY.pendingHours,
      authorRewardsEnabled: data.author_rewards_enabled ?? DEFAULT_TINTA_POLICY.authorRewardsEnabled,
      exchangeEnabled: data.exchange_enabled ?? DEFAULT_TINTA_POLICY.exchangeEnabled,
      missionsPayTinta: data.missions_pay_tinta ?? DEFAULT_TINTA_POLICY.missionsPayTinta,
    }
  } catch {
    return DEFAULT_TINTA_POLICY
  }
}

/**
 * Membaca ringkasan saldo Tinta pengguna (total, available, pending).
 * Fail-open: mengembalikan nol semua bila terjadi kegagalan/error.
 */
export async function getTintaBalance(userId: string): Promise<TintaBalance> {
  try {
    const db = createAdminClient()
    const { data, error } = await db.rpc('tinta_balance_v1', { p_user_id: userId })
    if (error || !data) {
      return { total: 0, available: 0, pending: 0 }
    }

    const payload = data as { total?: unknown; available?: unknown; pending?: unknown }
    return {
      total: typeof payload.total === 'number' ? payload.total : (Number(payload.total) || 0),
      available: typeof payload.available === 'number' ? payload.available : (Number(payload.available) || 0),
      pending: typeof payload.pending === 'number' ? payload.pending : (Number(payload.pending) || 0),
    }
  } catch {
    return { total: 0, available: 0, pending: 0 }
  }
}

/**
 * Menukar saldo Tinta menjadi Lakoin secara atomik berpasangan.
 * Alur:
 * 1. Validasi kebijakan & hitung kurs (lempar error bila disabled/di bawah minimum).
 * 2. Spend Tinta via spend_tinta_v1 (ref exchange:{uuid}).
 * 3. Grant Lakoin via grant_credits_v1 (ref tinta_exchange:{uuid}).
 * 4. Bila grant Lakoin gagal, rollback Tinta via grant_tinta_v1 (ref exchange-rollback:{uuid}) lalu throw.
 */
export async function exchangeTintaForLakoin(
  userId: string,
  amountTinta: number,
): Promise<ExchangeResult> {
  const policy = await getTintaPolicy()
  const calculation = calculateTintaExchange(amountTinta, policy)

  const exchangeId = randomUUID()
  const spendRef = `exchange:${exchangeId}`
  const db = createAdminClient()

  // 1. Spend Tinta
  const { data: spendStatus, error: spendErr } = await db.rpc('spend_tinta_v1', {
    p_user_id: userId,
    p_ref: spendRef,
    p_amount: calculation.tintaSpent,
    p_reason: 'tinta_exchange',
  })

  if (spendErr) {
    throw new Error(`spend_tinta_v1 failed: ${spendErr.message}`)
  }

  if (spendStatus === 'insufficient') {
    throw new Error('Saldo Tinta tidak mencukupi')
  }

  if (spendStatus === 'duplicate') {
    throw new Error('Transaksi penukaran sedang diproses')
  }

  if (spendStatus !== 'ok') {
    throw new Error(`spend_tinta_v1 failed: ${spendStatus}`)
  }

  // 2. Grant Lakoin (kredit baca)
  const creditRef = `tinta_exchange:${exchangeId}`
  const { data: creditGranted, error: creditErr } = await db.rpc('grant_credits_v1', {
    p_user_id: userId,
    p_ref: creditRef,
    p_credits: calculation.lakoinOut,
    p_reason: 'tinta_exchange',
  })

  if (creditErr || !creditGranted) {
    // 3. Kompensasi rollback bila grant kredit gagal
    const rollbackRef = `exchange-rollback:${exchangeId}`
    await db.rpc('grant_tinta_v1', {
      p_user_id: userId,
      p_ref: rollbackRef,
      p_delta: calculation.tintaSpent,
      p_reason: 'tinta_exchange_rollback',
      p_pending_hours: 0,
    })

    throw new Error(`grant_credits_v1 failed: ${creditErr?.message ?? 'unknown'}`)
  }

  return {
    lakoinOut: calculation.lakoinOut,
    tintaSpent: calculation.tintaSpent,
  }
}

/**
 * Mengambil riwayat mutasi tinta_ledger untuk pengguna, diurutkan descending.
 */
export async function listTintaHistory(
  userId: string,
  limit = 30,
): Promise<TintaLedgerRow[]> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('tinta_ledger')
      .select('id, delta, reason, ref, pending_until, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !data) {
      return []
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      delta: Number(row.delta ?? 0),
      reason: String(row.reason ?? ''),
      ref: String(row.ref ?? ''),
      pending_until: row.pending_until ? String(row.pending_until) : null,
      created_at: String(row.created_at ?? ''),
      pendingUntil: row.pending_until ? String(row.pending_until) : null,
      createdAt: String(row.created_at ?? ''),
    }))
  } catch {
    return []
  }
}
