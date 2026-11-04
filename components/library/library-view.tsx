'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { LibraryStoryCard } from './library-story-card'
import { StoryVisibilityToggle } from '@/components/story/story-visibility-toggle'
import { filterLibraryStories, sortLibraryStories } from '@/lib/library/order'
import type {
  LibrarySortKey,
  LibraryStatusFilter,
  LibraryStoryItem,
} from '@/lib/library/types'
import { cn } from '@/lib/utils'

const STATUS_CHIPS: { key: LibraryStatusFilter; label: string }[] = [
  { key: 'SEMUA', label: 'Semua' },
  { key: 'BARU', label: 'Belum dimulai' },
  { key: 'BERJALAN', label: 'Berjalan' },
  { key: 'SELESAI', label: 'Selesai' },
]

/** Toolbar disembunyikan untuk perpustakaan kecil supaya tidak menambah tinggi. */
const TOOLBAR_THRESHOLD = 4

export function LibraryView({ stories }: { stories: LibraryStoryItem[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySortKey>('lastRead')
  const [status, setStatus] = useState<LibraryStatusFilter>('SEMUA')

  const deferredQuery = useDeferredValue(query)

  const availableChips = useMemo(() => {
    const counts = new Map<LibraryStatusFilter, number>()
    for (const story of stories) {
      counts.set(story.status, (counts.get(story.status) ?? 0) + 1)
    }
    return STATUS_CHIPS.filter(
      (chip) => chip.key === 'SEMUA' || (counts.get(chip.key) ?? 0) > 0,
    )
  }, [stories])

  const visible = useMemo(() => {
    const filtered = filterLibraryStories(stories, { query: deferredQuery, status })
    return sortLibraryStories(filtered, sort)
  }, [stories, deferredQuery, status, sort])

  const showToolbar = stories.length >= TOOLBAR_THRESHOLD
  const isFiltering = query.trim().length > 0 || status !== 'SEMUA'

  function resetFilters() {
    setQuery('')
    setStatus('SEMUA')
  }

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
        <p className="text-sm text-muted-foreground">Belum ada cerita yang menunggumu.</p>
        <Link
          href="/mulai"
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Mulai Cerita Baru
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {showToolbar && (
        <div className="sticky top-0 z-20 -mx-5 flex flex-col gap-2 bg-background/95 px-5 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari judul cerita"
                aria-label="Cari judul cerita"
                className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySortKey)}
              aria-label="Urutkan cerita"
              className="h-10 shrink-0 rounded-xl border border-border bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="lastRead">Terakhir dibaca</option>
              <option value="title">Judul A–Z</option>
              <option value="progress">Progres</option>
            </select>
          </div>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {availableChips.map((chip) => {
              const active = status === chip.key
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setStatus(chip.key)}
                  aria-pressed={active}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-secondary/60',
                  )}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {isFiltering && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {visible.length} dari {stories.length} cerita
        </p>
      )}

      {visible.length > 0 ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-4">
          {visible.map((story) => (
            <div key={story.id} className="flex flex-col gap-1.5">
              <LibraryStoryCard story={story} />
              {story.isOwned && (
                <div className="flex justify-center">
                  <StoryVisibilityToggle
                    storyId={story.id}
                    initialVisibility={story.visibility ?? 'private'}
                    owned={true}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
          <p className="text-sm text-muted-foreground">Tidak ada cerita yang cocok.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-secondary px-4 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            Atur ulang pencarian
          </button>
        </div>
      )}
    </div>
  )
}
