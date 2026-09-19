import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { type AuthorRewardStatus, tintaAmountBucket } from './policy'
import { getTintaPolicy } from './server'
import { trackServerEvent } from '@/lib/analytics/server'

export interface MaybeGrantAuthorTintaParams {
  readerUserId: string
  storyId: string
  chapterNumber: number
}

/**
 * Memberikan reward Tinta ke penulis saat pembaca menyelesaikan suatu bab.
 * Non-fatal: semua exception ditelan penuh (tidak pernah throw).
 * Logika eligibility sepenuhnya ditegakkan di dalam RPC grant_author_tinta_v1.
 */
export async function maybeGrantAuthorTinta(
  params: MaybeGrantAuthorTintaParams,
): Promise<void> {
  try {
    const { readerUserId, storyId, chapterNumber } = params
    const db = createAdminClient()
    const { data, error } = await db.rpc('grant_author_tinta_v1', {
      p_reader_id: readerUserId,
      p_story_id: storyId,
      p_chapter_number: chapterNumber,
    })

    if (error) {
      console.log('[tinta] author reward rpc error', {
        storyId,
        chapterNumber,
        error: error.message,
      })
      return
    }

    const status = data as AuthorRewardStatus

    if (status === 'ok') {
      console.log('[tinta] author reward granted', {
        storyId,
        chapterNumber,
        readerUserId,
      })

      try {
        const policy = await getTintaPolicy()
        trackServerEvent(
          'tinta_earned',
          {
            tinta_source: 'author_read_reward',
            tinta_amount_bucket: tintaAmountBucket(policy.tintaPerRead),
            story_id: storyId,
          },
          { userId: readerUserId },
        )
      } catch {
        // Non-critical — jangan memblokir jika gagal analitik
      }
    } else if (status === 'capped' || status === 'disabled' || status === 'duplicate') {
      console.log('[tinta] author reward skipped', {
        status,
        storyId,
        chapterNumber,
        readerUserId,
      })

      trackServerEvent(
        'author_reward_skipped',
        {
          tinta_skip_reason: status,
          story_id: storyId,
        },
        { userId: readerUserId },
      )
    } else {
      // Status 'ineligible' (atau lainnya): log server saja tanpa event
      // Alasan: penyebab spesifik (bukan public vs self-read vs bab di luar batas)
      // tidak dapat dipetakan secara jujur dari status tunggal RPC.
      console.log('[tinta] author reward skipped', {
        status,
        storyId,
        chapterNumber,
        readerUserId,
      })
    }
  } catch (error) {
    console.log('[tinta] author reward unhandled error', error)
  }
}
