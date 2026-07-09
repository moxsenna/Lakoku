'use server'

import {
  createEndingCardShare,
  recordShareStart,
  type ShareVisibility,
} from '@/lib/api/share'
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
    const { startId } = await recordShareStart(shareSlug)
    // MVP: playthrough baru via onboarding; foundation-copy penuh = T-SHARE-4.
    const next = `/mulai?share=${encodeURIComponent(shareSlug)}&start=${encodeURIComponent(startId)}`
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
