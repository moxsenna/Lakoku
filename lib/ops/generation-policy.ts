import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@lakoku/db'

/**
 * Generation policy — target panjang bab, scene count, lease & concurrency caps.
 *
 * Source of truth: tabel `generation_policy` (DB). Code hanya punya fallback
 * aman. Target bisa diubah dari Dashboard tanpa deploy untuk eksperimen
 * kualitas, biaya AI, atau positioning produk.
 *
 * Tidak digabung dengan `reading_policy` (yang mengatur free chapters &
 * unlock cost) — generation policy murni naratif + runtime caps.
 */

export interface GenerationPolicy {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
  leaseTtlSeconds: number
  maxConcurrentGenerations: number
  maxConcurrentGenerationsPerUser: number
  generationMaxQueue: number
}

/** Fallback aman bila DB tak tercapai. */
export const DEFAULT_GENERATION_POLICY: GenerationPolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
  leaseTtlSeconds: 300,
  maxConcurrentGenerations: 10,
  maxConcurrentGenerationsPerUser: 1,
  generationMaxQueue: 40,
}

/** Target tengah untuk plan/prompt (midpoint of min..max). */
export function targetWordCountMidpoint(policy: GenerationPolicy): number {
  return Math.round((policy.targetWordsMin + policy.targetWordsMax) / 2)
}

function numOrDefault(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
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
      .select(
        'target_words_min,target_words_max,target_scenes,lease_ttl_seconds,max_concurrent_generations,max_concurrent_generations_per_user,generation_max_queue',
      )
      .eq('id', 1)
      .maybeSingle()

    if (data) {
      const d = DEFAULT_GENERATION_POLICY
      return {
        targetWordsMin: numOrDefault(data.target_words_min, d.targetWordsMin),
        targetWordsMax: numOrDefault(data.target_words_max, d.targetWordsMax),
        targetScenes: numOrDefault(data.target_scenes, d.targetScenes),
        leaseTtlSeconds: numOrDefault(data.lease_ttl_seconds, d.leaseTtlSeconds),
        maxConcurrentGenerations: numOrDefault(
          data.max_concurrent_generations,
          d.maxConcurrentGenerations,
        ),
        maxConcurrentGenerationsPerUser: numOrDefault(
          data.max_concurrent_generations_per_user,
          d.maxConcurrentGenerationsPerUser,
        ),
        generationMaxQueue: numOrDefault(
          data.generation_max_queue,
          d.generationMaxQueue,
        ),
      }
    }
  } catch {
    // fallback
  }

  return DEFAULT_GENERATION_POLICY
})
