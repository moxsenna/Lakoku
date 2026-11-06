import { describe, expect, it } from 'vitest'

describe('Jelajah explore items logic (Audit BL-3)', () => {
  it('prevents TDZ by evaluating baseItems before filtering publicShares', () => {
    const explore = [
      { id: 'catalog:novel-1', title: 'Novel Resmi', tagline: 'Tagline', tropes: ['romansa'] },
    ]
    const publicUserStories = [
      { id: 'user:cerita-1', title: 'Cerita User', tagline: 'Tagline User', tropes: ['fantasi'] },
      { id: 'catalog:novel-1', title: 'Duplicate Story', tagline: '', tropes: [] },
    ]
    const publicShares = [
      {
        id: 'share-1',
        shareSlug: 'slug-1',
        title: 'Share 1',
        teaser: { title: 'Novel Resmi', tagline: 'Teaser' },
      },
      {
        id: 'share-2',
        shareSlug: 'slug-2',
        title: 'Share 2',
        teaser: { title: 'Ending Eksklusif', tagline: 'Ending Teaser', endingName: 'Happy Ending', tropes: ['drama'] },
      },
    ]

    // Evaluasi sesuai struktur jelajah/page.tsx setelah perbaikan BL-3
    const baseItems = [
      ...explore.map((story) => ({
        key: story.id,
        title: story.title,
        badge: 'RESMI',
      })),
      ...publicUserStories
        .filter((s) => !explore.some((e) => e.id === s.id))
        .map((story) => ({
          key: story.id,
          title: story.title,
          badge: 'DARI PENULIS',
        })),
    ]

    const shareItems = publicShares
      .filter((share) => !baseItems.some((i) => i.title === share.teaser.title))
      .map((share) => ({
        key: `share:${share.shareSlug}`,
        title: share.teaser.title,
        badge: share.teaser.endingName ? `AKHIR: ${share.teaser.endingName}` : 'ENDING CARD',
      }))

    const items = [...baseItems, ...shareItems]

    expect(items).toHaveLength(3) // 1 resmi + 1 user (duplicate filtered) + 1 share (Novel Resmi share filtered)
    expect(items.map((i) => i.title)).toEqual(['Novel Resmi', 'Cerita User', 'Ending Eksklusif'])
    expect(items[2].badge).toBe('AKHIR: Happy Ending')
  })
})
