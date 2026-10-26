import type { Metadata } from 'next'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { StoryCard } from '@/components/story-card'
import { listExploreStories, listPublicUserStories } from '@/lib/api/server'
import { listPublicShareTeasers } from '@/lib/api/share'
import { TROPE_TAGS, type StorySummary, type TropeTag } from '@lakoku/contracts'

export const metadata: Metadata = {
  title: 'Jelajah Cerita — Lakoku',
  description:
    'Cari cerita interaktif berdasarkan judul atau trope: pengkhianatan, rahasia keluarga, second chance, dan lainnya.',
  alternates: { canonical: '/jelajah' },
}

export const dynamic = 'force-dynamic'

interface ExploreItem {
  key: string
  title: string
  tagline: string
  tropes: string[]
  href: string
  badge: string | null
  story: StorySummary
}

/**
 * Jelajah + cari. Filter & kata kunci lewat query param sehingga hasil bisa
 * dibagikan sebagai tautan (?q=, ?trope=) — bagian dari viral loop.
 */
export default async function JelajahPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; trope?: string }>
}) {
  const { q, trope } = (await searchParams) ?? {}
  const query = (q ?? '').trim().toLowerCase()
  const activeTrope = trope && (TROPE_TAGS as readonly string[]).includes(trope) ? trope : null

  const [explore, publicUserStories, publicShares] = await Promise.all([
    listExploreStories(),
    listPublicUserStories(50).catch(() => []),
    listPublicShareTeasers(30).catch(() => []),
  ])

  const items: ExploreItem[] = [
    ...explore.map((story) => ({
      key: story.id,
      title: story.title,
      tagline: story.tagline,
      tropes: story.tropes,
      href: `/cerita/${encodeURIComponent(story.id)}`,
      badge: 'RESMI' as const,
      story,
    })),
    ...publicUserStories
      .filter((s) => !explore.some((e) => e.id === s.id))
      .map((story) => ({
        key: story.id,
        title: story.title,
        tagline: story.tagline,
        tropes: story.tropes,
        href: `/cerita/${encodeURIComponent(story.id)}`,
        badge: 'DARI PENULIS' as const,
        story,
      })),
    ...publicShares
      .filter((share) => !items.some((i) => i.title === share.teaser.title))
      .map((share) => ({
        key: `share:${share.shareSlug}`,
        title: share.teaser.title,
        tagline: share.teaser.tagline ?? share.title,
        tropes: share.teaser.tropes as TropeTag[],
        href: `/s/${share.shareSlug}`,
        badge: share.teaser.endingName ? `AKHIR: ${share.teaser.endingName}` : 'ENDING CARD',
        story: {
          id: share.id,
          title: share.teaser.title,
          cover: share.teaser.cover ?? '',
          tagline: share.teaser.tagline ?? share.title,
          role: 'pembaca',
          tropes: share.teaser.tropes as TropeTag[],
          totalChapters: 50,
          currentChapter: 50,
          status: 'SELESAI' as const,
        },
      })),
  ]

  const filtered = items.filter((item) => {
    if (activeTrope && !item.tropes.includes(activeTrope)) return false
    if (!query) return true
    return (
      item.title.toLowerCase().includes(query) ||
      item.tagline.toLowerCase().includes(query) ||
      item.tropes.some((t) => t.toLowerCase().includes(query))
    )
  })

  function tropeHref(tag: string): string {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (tag === activeTrope) params.delete('trope')
    else params.set('trope', tag)
    const qs = params.toString()
    return qs ? `/jelajah?${qs}` : '/jelajah'
  }

  return (
    <main className="flex flex-col gap-6 px-5 pt-8 pb-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl text-foreground">Jelajah Cerita</h1>
        <p className="text-sm text-muted-foreground">
          Cari berdasarkan judul, nuansa, atau trope yang kamu suka.
        </p>
        <form action="/jelajah" method="get" className="mt-2 flex items-center gap-2">
          {activeTrope && <input type="hidden" name="trope" value={activeTrope} />}
          <label className="flex min-h-12 flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Cari cerita</span>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="mis. rahasia keluarga"
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <button
            type="submit"
            className="flex min-h-12 items-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            Cari
          </button>
        </form>
      </header>

      <nav aria-label="Filter trope" className="flex flex-wrap gap-2">
        {TROPE_TAGS.map((tag) => (
          <Link
            key={tag}
            href={tropeHref(tag)}
            aria-pressed={tag === activeTrope}
            className={`flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
              tag === activeTrope
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {tag}
          </Link>
        ))}
      </nav>

      {filtered.length > 0 ? (
        <section aria-live="polite" className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {filtered.length} cerita{query ? ` untuk “${query}”` : ''}
            {activeTrope ? ` · trope ${activeTrope}` : ''}
          </p>
          <div className="flex flex-col gap-3">
            {filtered.map((item) => (
              <div key={item.key} className="relative">
                {item.badge && (
                  <div className="pointer-events-none absolute right-3 top-3 z-10">
                    <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-gold">
                      {item.badge}
                    </span>
                  </div>
                )}
                <StoryCard story={item.story} href={item.href} />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Belum ada cerita yang cocok. Coba kata kunci lain, atau mulai ceritamu sendiri.
          </p>
          <Link
            href="/mulai"
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Mulai Cerita Baru
          </Link>
        </div>
      )}
    </main>
  )
}
