import 'server-only'
import { randomUUID } from 'node:crypto'
import { getDb, single, result, rpcOne } from '@lakoku/db'
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
    const db = getDb()
    // RLS_AUDIT: tinta_policy_read
    const { data, error } = await single(
      db
        .selectFrom('tinta_policy')
        .selectAll()
        .where('id', '=', true)
        .limit(1)
        .execute(),
    )

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
    const db = getDb()
    // RLS_AUDIT: tinta_ledger_own_read
    const { data, error } = await single(rpcOne(db, 'tinta_balance_v1', { p_user_id: userId }).execute())
    if (error || !data) {
      return { total: 0, available: 0, pending: 0 }
    }

    const payload = (data as Record<string, unknown>).fn ?? data
    const p = payload as { total?: unknown; available?: unknown; pending?: unknown }
    return {
      total: typeof p.total === 'number' ? p.total : (Number(p.total) || 0),
      available: typeof p.available === 'number' ? p.available : (Number(p.available) || 0),
      pending: typeof p.pending === 'number' ? p.pending : (Number(p.pending) || 0),
    }
  } catch {
    return { total: 0, available: 0, pending: 0 }
  }
}

/**
 * Menukar saldo Tinta menjadi Lakoin secara atomik.
 * Alur:
 * 1. Validasi kebijakan & hitung kurs (lempar error bila disabled/di bawah minimum).
 * 2. exchange_tinta_to_lakoin_v1 memotong Tinta + grant Lakoin dalam SATU
 *    transaksi DB ber-lock per user (audit B4). Tanpa ini, server mati di
 *    tengah jalan bisa menghanguskan Tinta atau menduplikasi Lakoin.
 */
export async function exchangeTintaForLakoin(
  userId: string,
  amountTinta: number,
): Promise<ExchangeResult> {
  const policy = await getTintaPolicy()
  const calculation = calculateTintaExchange(amountTinta, policy)

  const exchangeId = randomUUID()
  const db = getDb()

  // Atomik (audit B4): potong Tinta + grant Lakoin dalam SATU transaksi DB
  // (exchange_tinta_to_lakoin_v1, advisory lock per-user). Tanpa ini server
  // mati di tengah jalan bisa menghanguskan Tinta atau menduplikasi Lakoin.
  const { data: statusData, error: exchangeErr } = await single(
    rpcOne(db, 'exchange_tinta_to_lakoin_v1', {
      p_user_id: userId,
      p_exchange_id: exchangeId,
      p_amount_tinta: calculation.tintaSpent,
      p_lakoin_out: calculation.lakoinOut,
    }).execute(),
  )

  if (exchangeErr) {
    throw new Error(`exchange_tinta_to_lakoin_v1 failed: ${exchangeErr.message}`)
  }

  const status = statusData ? ((statusData as Record<string, unknown>).fn ?? statusData) : null

  if (status === 'insufficient') {
    throw new Error('Saldo Tinta tidak mencukupi')
  }

  if (status === 'duplicate') {
    throw new Error('Transaksi penukaran sedang diproses')
  }

  if (status !== 'ok') {
    throw new Error(`exchange_tinta_to_lakoin_v1 failed: ${String(status)}`)
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
    const db = getDb()
    // RLS_AUDIT: tinta_ledger_own_read
    const { data, error } = await result(
      db
        .selectFrom('tinta_ledger')
        .select(['id', 'delta', 'reason', 'ref', 'pending_until', 'created_at'])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute(),
    )

    if (error || !data) {
      return []
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      delta: Number(row.delta ?? 0),
      reason: String(row.reason ?? ''),
      ref: String(row.ref ?? ''),
      pending_until: row.pending_until ? (row.pending_until instanceof Date ? row.pending_until.toISOString() : String(row.pending_until)) : null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
      pendingUntil: row.pending_until ? (row.pending_until instanceof Date ? row.pending_until.toISOString() : String(row.pending_until)) : null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
    }))
  } catch {
    return []
  }
}
