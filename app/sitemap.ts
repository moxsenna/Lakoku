import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/og/site'
import { listPublicStoryIdsForSitemap } from '@/lib/api/public-preview'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin()
  const ids = await listPublicStoryIdsForSitemap()
  return [
    { url: `${origin}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/beranda`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${origin}/mulai`, changeFrequency: 'monthly', priority: 0.7 },
    ...ids.map((id) => ({
      url: `${origin}/cerita/${encodeURIComponent(id)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    { url: `${origin}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${origin}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
