import 'server-only'
import { cache } from 'react'
import { queryExploreStories, queryPublicUserStories, queryStoryForUser } from './queries'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

export interface PublicStoryPreview {
  id: string
  title: string
  tagline: string
  synopsis?: string
  cover: string
}

/**
 * Pratinjau cerita untuk crawler/metadata. Sengaja tanpa sesi: hanya cerita
 * publik yang boleh muncul di kartu tautan, apa pun yang dilihat pemiliknya.
 */
export const getPublicStoryPreview = cache(async function getPublicStoryPreview(
  id: string,
): Promise<PublicStoryPreview | null> {
  try {
    const story = await queryStoryForUser(normalizeStoryRouteId(id), null)
    if (!story) return null
    return {
      id: story.id,
      title: story.title,
      tagline: story.tagline,
      synopsis: story.synopsis,
      cover: story.cover,
    }
  } catch {
    return null
  }
})

/** Id cerita publik untuk sitemap: katalog resmi + cerita pembaca yang dipublikasikan. */
export async function listPublicStoryIdsForSitemap(): Promise<string[]> {
  try {
    const [official, community] = await Promise.all([
      queryExploreStories(),
      queryPublicUserStories(200),
    ])
    return [...new Set([...official, ...community].map((s) => s.id))]
  } catch {
    return []
  }
}
