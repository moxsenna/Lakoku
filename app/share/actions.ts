'use server'

import {
  createEndingCardShare,
  type ShareVisibility,
} from '@/lib/api/share'
import { recordShareLinkAttribution } from '@/lib/rewards/share-attribution.server'
import type { JejakItem } from '@/lib/api/types'

export type ShareActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

export async function actCreateEndingShare(input: {
  storyId: string
  title: string
  tagline?: string
  tropes: string[]
  cover?: string
  endingName?: string
  jejak: JejakItem[]
  visibility?: ShareVisibility
}): Promise<ShareActionResult<{ shareSlug: string; path: string }>> {
  try {
    const result = await createEndingCardShare(input)
    return { ok: true, ...result }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Gagal membuat tautan share.',
    }
  }
}

export async function actStartFromShare(
  shareSlug: string,
): Promise<ShareActionResult<{ startId: string; next: string }>> {
  try {
    const { cloneStoryFromShare } = await import('@/lib/api/share')
    const { storyId, startId } = await cloneStoryFromShare(shareSlug)
    const next = `/baca/${encodeURIComponent(storyId)}?bab=1`

    // Referral via tautan share: catat pemula sebagai pembawa pemilik tautan.
    try {
      const { getSessionUser } = await import('@/lib/api/user-state')
      const user = await getSessionUser()
      if (user) {
        await recordShareLinkAttribution({ newUserId: user.id, shareSlug })
      }
    } catch {
      // Non-fatal.
    }

    return { ok: true, startId, next }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Gagal memulai dari share.',
    }
  }
}

export async function actAttachShareStart(
  startId: string,
  newStoryId: string,
): Promise<ShareActionResult<{ attached: true }>> {
  try {
    const { attachStoryToShareStart } = await import('@/lib/api/share')
    await attachStoryToShareStart(startId, newStoryId)
    return { ok: true, attached: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Gagal menautkan share start.',
    }
  }
}
