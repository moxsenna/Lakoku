'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'

interface CatalogSummary {
  storyId: string
  title: string
  status: string
  chapterPrice: number
  bundlePrice: number
  generationProgress: number
  publishedAt: string | null
  visibility: string
  totalUnits: number
  approvedUnits: number
  rewriteUnits: number
  pendingUnits: number
}

const statusLabel: Record<string, string> = {
  draft: 'Draf',
  generating: 'Menulis',
  review: 'Menunggu QC',
  published: 'Terbit',
  archived: 'Ditarik',
}

async function fetchCatalogSummaries(): Promise<{
  stories: CatalogSummary[]
  error: string | null
}> {
  try {
    const res = await fetch('/api/admin/catalog')
    if (!res.ok) {
      return { stories: [], error: 'Gagal memuat daftar novel katalog.' }
    }
    const data = (await res.json()) as { stories: CatalogSummary[] }
    return { stories: data.stories ?? [], error: null }
  } catch {
    return { stories: [], error: 'Gagal terhubung ke server.' }
  }
}

export default function AdminCatalogPage() {
  const [stories, setStories] = useState<CatalogSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchCatalogSummaries()
    if (result.error) setError(result.error)
    else setStories(result.stories)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchCatalogSummaries().then((result) => {
      if (cancelled) return
      if (result.error) setError(result.error)
      else setStories(result.stories)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Novel Katalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Novel 50 bab yang tampil di Beranda semua pembaca. Tinjau tiap bab sebelum terbit.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted"
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
          Muat ulang
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && stories.length === 0 && !error && (
        <AdminEmptyState
          title="Belum ada novel katalog"
          message="Novel katalog akan muncul di sini setelah proses penulisan selesai."
        />
      )}

      {stories.length > 0 && (
        <div className="flex flex-col gap-3">
          {stories.map((story) => {
            const progress = story.totalUnits > 0
              ? Math.round((story.approvedUnits / story.totalUnits) * 100)
              : 0
            return (
              <div key={story.storyId} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-medium text-foreground">{story.title}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {statusLabel[story.status] ?? story.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {story.chapterPrice} Lakoin/bab · paket {story.bundlePrice}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{story.storyId}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Disetujui {story.approvedUnits}/{story.totalUnits} unit ({progress}%)
                      {story.rewriteUnits > 0 && ` · ${story.rewriteUnits} minta tulis ulang`}
                      {story.pendingUnits > 0 && ` · ${story.pendingUnits} belum ditinjau`}
                      {` · progres tulis ${story.generationProgress}/50`}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <Link
                    href={`/admin/katalog/${encodeURIComponent(story.storyId)}`}
                    className="flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                  >
                    Tinjau
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
