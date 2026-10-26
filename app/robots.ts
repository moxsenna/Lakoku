import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/og/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/beranda', '/cerita/', '/mulai', '/privacy', '/terms'],
      disallow: [
        '/api/',
        '/admin',
        '/auth/',
        '/baca/',
        '/akhir/',
        '/koleksiku',
        '/kredit',
        '/payment',
        '/profil',
        '/misi',
        '/s/',
        '/r/',
      ],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  }
}
