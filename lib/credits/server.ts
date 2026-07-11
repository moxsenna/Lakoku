import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@lakoku/db'
import {
  DEFAULT_READING_POLICY,
  isChapterFree,
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
    const db = createAdminClient()

    // Baca freeChapters dari reading_policy (existing table)
    const { data: rp } = await db
      .from('reading_policy')
      .select('free_chapters,credits_per_chapter')
      .eq('id', 1)
      .maybeSingle()
    if (rp) {
      freeChapters = Number(rp.free_chapters)
    }

    // Baca creditsPerChapter dari feature_credit_costs (chapter_unlock)
    const { data: fc } = await db
      .from('feature_credit_costs')
      .select('credits_required')
      .eq('feature_key', 'chapter_unlock')
      .eq('is_active', true)
      .maybeSingle()
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
    const db = createAdminClient()
    const { data, error } = await db.rpc('credit_balance_v1', { p_user_id: userId })
    if (error) return 0
    return Number(data ?? 0)
  } catch {
    return 0
  }
}

/** Nomor bab yang sudah di-unlock user untuk sebuah story. */
export async function listUnlockedChapters(userId: string, storyId: string): Promise<number[]> {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('credit_ledger')
      .select('ref')
      .eq('user_id', userId)
      .like('ref', `${unlockRef(storyId, 0).slice(0, -1)}%`) // "unlock:{storyId}:"
    const prefix = `unlock:${storyId}:`
    return (data ?? [])
      .map((r) => Number(String(r.ref).slice(prefix.length)))
      .filter((n) => Number.isInteger(n))
  } catch {
    return []
  }
}

/** true bila bab bisa dibaca user: gratis (≤ freeChapters) ATAU sudah di-unlock. */
export async function isChapterUnlocked(
  userId: string | null,
  storyId: string,
  chapter: number,
  policy: ReadingPolicy,
): Promise<boolean> {
  if (isChapterFree(chapter, policy)) return true
  if (!userId) return false
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('ref', unlockRef(storyId, chapter))
      .maybeSingle()
    return data != null
  } catch {
    return false
  }
}

export type SpendResult = 'ok' | 'insufficient' | 'duplicate'

/** Belanjakan kredit untuk membuka bab (idempoten via ledger ref). */
export async function spendChapterUnlock(
  userId: string,
  storyId: string,
  chapter: number,
  cost: number,
): Promise<SpendResult> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('spend_credits_v1', {
    p_user_id: userId,
    p_ref: unlockRef(storyId, chapter),
    p_credits: cost,
    p_reason: 'unlock_chapter',
  })
  if (error) throw new Error(`spendChapterUnlock: ${error.message}`)
  const status = String(data)
  if (status === 'ok' || status === 'duplicate' || status === 'insufficient') return status
  throw new Error(`spendChapterUnlock: unexpected result ${status}`)
}
