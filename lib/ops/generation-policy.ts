import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@lakoku/db'

/**
 * Generation policy — target panjang bab & scene count.
 *
 * Source of truth: tabel `generation_policy` (DB). Code hanya punya fallback
 * aman. Target bisa diubah dari Dashboard tanpa deploy untuk eksperimen
 * kualitas, biaya AI, atau positioning produk.
 *
 * Tidak digabung dengan `reading_policy` (yang mengatur free chapters &
 * unlock cost) — generation policy murni naratif.
 */

export interface GenerationPolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
}

/** Fallback aman bila DB tak tercapai. */
export const DEFAULT_GENERATION_POLICY: GenerationPolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
}

/** Target tengah untuk plan/prompt (midpoint of min..max). */
export function targetWordCountMidpoint(policy: GenerationPolicy): number {
  return Math.round((policy.targetWordsMin + policy.targetWordsMax) / 2)
}

/**
 * Ambil generation policy aktif dari DB. Cached per-request via `cache()`.
 * Fallback ke `DEFAULT_GENERATION_POLICY` bila DB tak tercapai.
 */
export const getGenerationPolicy = cache(async (): Promise<GenerationPolicy> => {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('generation_policy')
      .select('target_words_min,target_words_max,target_scenes')
      .eq('id', 1)
      .maybeSingle()

    if (data) {
      return {
        targetWordsMin: Number(data.target_words_min),
        targetWordsMax: Number(data.target_words_max),
        targetScenes: Number(data.target_scenes),
      }
    }
  } catch {
    // fallback
  }

  return DEFAULT_GENERATION_POLICY
})
