import 'server-only'
import { cache } from 'react'
import { getDb, result, single, rpcOne } from '@lakoku/db'
import {
  DEFAULT_READING_POLICY,
  unlockRef,
  type ReadingPolicy,
} from './policy'

/**
 * Sisi server kredit baca (server-only, service-role).
 *  - getReadingPolicy: baca kebijakan harga dari DB (reading_policy + feature_credit_costs), fallback default.
 *  - getCreditBalance: saldo kredit user (RPC credit_balance_v1).
 *  - isChapterUnlocked / listUnlockedChapters: status akses bab.
 *  - spendChapterUnlock: belanjakan kredit untuk buka bab (RPC spend_credits_v1, idempoten).
 */

/** Kebijakan harga aktif dari DB; creditsPerChapter dari feature_credit_costs (chapter_unlock). */
export const getReadingPolicy = cache(async function getReadingPolicy(): Promise<ReadingPolicy> {
  let creditsPerChapter = DEFAULT_READING_POLICY.creditsPerChapter
  let freeChapters = DEFAULT_READING_POLICY.freeChapters

  try {
    const db = getDb()

    // Baca freeChapters dari reading_policy (existing table)
    // RLS_AUDIT: reading_policy_read
    const { data: rp } = await single(
      db
        .selectFrom('reading_policy')
        .select(['free_chapters', 'credits_per_chapter'])
        .where('id', '=', 1)
        .limit(1)
        .execute(),
    )
    if (rp) {
      freeChapters = Number(rp.free_chapters)
    }

    // Baca creditsPerChapter dari feature_credit_costs (chapter_unlock)
    // RLS_AUDIT: feature_credit_costs_read
    const { data: fc } = await single(
      db
        .selectFrom('feature_credit_costs')
        .select('credits_required')
        .where('feature_key', '=', 'chapter_unlock')
        .where('is_active', '=', true)
        .limit(1)
        .execute(),
    )
    if (fc) {
      creditsPerChapter = Number(fc.credits_required)
    }
  } catch {
    /* fallback */
  }

  return { freeChapters, creditsPerChapter }
})

/** Saldo kredit user (0 bila belum ada / gagal). */
export async function getCreditBalance(userId: string): Promise<number> {
  try {
    const db = getDb()
    // RLS_AUDIT: credit_ledger_own_read
    const { data, error } = await single(
      rpcOne(db, 'credit_balance_v1', { p_user_id: userId }).execute(),
    )
    if (error) return 0
    const raw = data ? ((data as Record<string, unknown>).fn ?? data) : 0
    return Number(raw ?? 0)
  } catch {
    return 0
  }
}

/** Nomor bab yang sudah di-unlock user untuk sebuah story. */
export async function listUnlockedChapters(userId: string, storyId: string): Promise<number[]> {
  try {
    const db = getDb()
    const prefix = `unlock:${storyId}:`
    // RLS_AUDIT: credit_ledger_own_read
    const { data } = await result(
      db
        .selectFrom('credit_ledger')
        .select('ref')
        .where('user_id', '=', userId)
        .where('ref', 'like', `${unlockRef(storyId, 0).slice(0, -1)}%`) // "unlock:{storyId}:"
        .execute(),
    )
    return (data ?? [])
      .map((r) => Number(String(r.ref).slice(prefix.length)))
      .filter((n) => Number.isInteger(n))
  } catch {
    return []
  }
}

export async function isChapterUnlocked(
  userId: string | null,
  storyId: string,
  chapter: number,
  policy: ReadingPolicy = DEFAULT_READING_POLICY,
): Promise<boolean> {
  const { resolveChapterAccess } = await import('./access-resolver.server')
  const decision = await resolveChapterAccess({ userId, storyId, chapterNumber: chapter, policy })
  return decision.readable
}

export type SpendResult = 'ok' | 'insufficient' | 'duplicate'

/** Belanjakan kredit untuk membuka bab (idempoten via ledger ref). */
export async function spendChapterUnlock(
  userId: string,
  storyId: string,
  chapter: number,
  cost: number,
): Promise<SpendResult> {
  const db = getDb()
  // RLS_AUDIT: credit_ledger_own_read
  const { data, error } = await single(
    rpcOne(db, 'spend_credits_v1', {
      p_user_id: userId,
      p_ref: unlockRef(storyId, chapter),
      p_credits: cost,
      p_reason: 'unlock_chapter',
    }).execute(),
  )
  if (error) throw new Error(`spendChapterUnlock: ${error.message}`)
  const status = String(data ? ((data as Record<string, unknown>).fn ?? data) : '')
  if (status === 'ok' || status === 'duplicate' || status === 'insufficient') return status
  throw new Error(`spendChapterUnlock: unexpected result ${status}`)
}
