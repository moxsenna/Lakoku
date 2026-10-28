'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Circle, Pencil, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react'

type ReviewStatus = 'pending' | 'approved' | 'rewrite_requested'

interface CatalogUnit {
  chapterNumber: number
  variantKey: string
  variantName: string | null
  title: string
  paragraphs: string[]
  choices: Array<{ id: string; label: string }>
  paragraphCount: number
  wordCount: number
  choiceCount: number
  status: ReviewStatus
  note: string | null
  reviewedAt: string | null
}

interface CatalogDetail {
  storyId: string
  title: string
  status: string
  chapterPrice: number
  bundlePrice: number
  generationProgress: number
  publishedAt: string | null
  visibility: string
  synopsis: string
  tagline: string
  totalChapters: number
  contractError: string | null
  units: CatalogUnit[]
  canPublish: boolean
  blockers: string[]
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

const reviewLabel: Record<ReviewStatus, string> = {
  pending: 'Belum ditinjau',
  approved: 'Disetujui',
  rewrite_requested: 'Minta tulis ulang',
}

const blockerLabel: Record<string, string> = {
  CONTRACT_MISSING: 'Kontrak cerita belum ada.',
  CONTRACT_INVALID: 'Kontrak cerita tidak valid.',
  SPINE_INCOMPLETE: 'Bab 1–44 belum lengkap.',
  ENDING_VARIANTS_INCOMPLETE: 'Varian Bab 45–50 belum lengkap untuk semua ending.',
  CHAPTERS_MISSING: 'Belum ada bab untuk ditinjau.',
  UNITS_NOT_APPROVED: 'Masih ada unit yang belum disetujui.',
}

async function fetchCatalogDetail(
  storyId: string,
): Promise<{ story: CatalogDetail | null; error: string | null }> {
  try {
    const res = await fetch(`/api/admin/catalog/${encodeURIComponent(storyId)}`)
    if (!res.ok) {
      return { story: null, error: 'Gagal memuat detail novel.' }
    }
    const data = (await res.json()) as { story: CatalogDetail }
    return { story: data.story, error: null }
  } catch {
    return { story: null, error: 'Gagal terhubung ke server.' }
  }
}

export default function AdminCatalogDetailPage() {
  const params = useParams<{ id: string }>()
  const storyId = useMemo(() => {
    const raw = params?.id
    if (typeof raw !== 'string') return ''
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }, [params])

  const [detail, setDetail] = useState<CatalogDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeVariant, setActiveVariant] = useState('spine')
  const [busy, setBusy] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editParagraphs, setEditParagraphs] = useState('')
  const [editChoices, setEditChoices] = useState<Array<{ id: string; label: string }>>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const applyDetail = useCallback((story: CatalogDetail) => {
    setDetail(story)
    if (story.units.length > 0) {
      setActiveVariant((current) => {
        const exists = story.units.some((unit) => unit.variantKey === current)
        return exists ? current : story.units[0].variantKey
      })
    }
  }, [])

  const load = useCallback(async () => {
    if (!storyId) return
    setLoading(true)
    setError(null)
    const result = await fetchCatalogDetail(storyId)
    if (result.error) setError(result.error)
    else if (result.story) applyDetail(result.story)
    setLoading(false)
  }, [storyId, applyDetail])

  useEffect(() => {
    if (!storyId) return
    let cancelled = false
    void fetchCatalogDetail(storyId).then((result) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      if (result.story) applyDetail(result.story)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [storyId, applyDetail])

  const variants = useMemo(() => {
    if (!detail) return []
    const seen = new Map<string, string>()
    for (const unit of detail.units) {
      if (!seen.has(unit.variantKey)) {
        seen.set(unit.variantKey, unit.variantName ?? 'Bab Utama (1–44)')
      }
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }))
  }, [detail])

  const units = useMemo(
    () => (detail ? detail.units.filter((unit) => unit.variantKey === activeVariant) : []),
    [detail, activeVariant],
  )

  async function submitReview(unit: CatalogUnit, status: ReviewStatus) {
    const key = `${unit.variantKey}:${unit.chapterNumber}`
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/catalog/${encodeURIComponent(storyId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterNumber: unit.chapterNumber,
          variantKey: unit.variantKey,
          status,
        }),
      })
      if (!res.ok) {
        setError('Gagal menyimpan status tinjauan.')
        return
      }
      await load()
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setBusy(null)
    }
  }

  function startEdit(unit: CatalogUnit) {
    setEditingKey(`${unit.variantKey}:${unit.chapterNumber}`)
    setEditTitle(unit.title)
    setEditParagraphs(unit.paragraphs.join('\n\n'))
    setEditChoices(unit.choices.map((choice) => ({ ...choice })))
    setNotice(null)
  }

  async function saveEdit(unit: CatalogUnit) {
    const key = `${unit.variantKey}:${unit.chapterNumber}`
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = {
        chapterNumber: unit.chapterNumber,
        variantKey: unit.variantKey,
        title: editTitle,
      }
      const paragraphs = editParagraphs
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
      if (paragraphs.length > 0) body.paragraphs = paragraphs
      const choices = editChoices
        .map((choice) => ({ id: choice.id.trim(), label: choice.label.trim() }))
        .filter((choice) => choice.id && choice.label)
      if (choices.length >= 2) body.choices = choices

      const res = await fetch(`/api/admin/catalog/${encodeURIComponent(storyId)}/chapter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setError('Gagal menyimpan perubahan teks.')
        return
      }
      setEditingKey(null)
      await load()
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    setBusy('publish')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/catalog/${encodeURIComponent(storyId)}/publish`, {
        method: 'POST',
      })
      if (!res.ok) {
        setError('Novel belum siap diterbitkan.')
        return
      }
      setNotice('Novel diterbitkan dan tampil di Beranda pembaca.')
      await load()
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setBusy(null)
    }
  }

  async function archive() {
    setBusy('archive')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/catalog/${encodeURIComponent(storyId)}/archive`, {
        method: 'POST',
      })
      if (!res.ok) {
        setError('Gagal menarik novel.')
        return
      }
      setNotice('Novel ditarik dari Beranda.')
      await load()
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setBusy(null)
    }
  }

  if (!detail && loading) {
    return <p className="text-sm text-muted-foreground">Memuat novel…</p>
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-destructive">{error ?? 'Novel tidak ditemukan.'}</p>
        <Link href="/admin/katalog" className="text-sm text-primary underline">
          Kembali ke daftar katalog
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/admin/katalog" className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Daftar katalog
          </Link>
          <h1 className="mt-1 font-serif text-2xl font-semibold text-foreground">{detail.title}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{detail.storyId}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Status {statusLabel[detail.status] ?? detail.status} · {detail.chapterPrice} Lakoin/bab · paket{' '}
            {detail.bundlePrice} Lakoin · progres tulis {detail.generationProgress}/50
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted"
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
            Muat ulang
          </button>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={!detail.canPublish || busy !== null}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            {detail.status === 'published' ? 'Terbitkan ulang' : 'Terbitkan'}
          </button>
          {confirmArchive ? (
            <>
              <button
                type="button"
                onClick={() => void archive()}
                disabled={busy !== null}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 text-sm text-destructive disabled:opacity-50"
              >
                Yakin tarik novel
              </button>
              <button
                type="button"
                onClick={() => setConfirmArchive(false)}
                disabled={busy !== null}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground disabled:opacity-50"
              >
                Batal
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmArchive(true)}
              disabled={detail.status === 'archived' || busy !== null}
              className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground disabled:opacity-50"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Tarik
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      )}

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Disetujui {detail.approvedUnits}/{detail.totalUnits}</span>
          <span>{detail.pendingUnits} belum ditinjau</span>
          <span>{detail.rewriteUnits} minta tulis ulang</span>
          {detail.blockers.length > 0 && (
            <span className="text-destructive">
              Penghalang: {detail.blockers.map((blocker) => blockerLabel[blocker] ?? blocker).join(' ')}
            </span>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary"
            style={{
              width: `${detail.totalUnits > 0 ? Math.round((detail.approvedUnits / detail.totalUnits) * 100) : 0}%`,
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {variants.map((variant) => (
          <button
            key={variant.key}
            type="button"
            onClick={() => setActiveVariant(variant.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              activeVariant === variant.key
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {variant.label}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {units.map((unit) => {
          const key = `${unit.variantKey}:${unit.chapterNumber}`
          const editing = editingKey === key
          return (
            <li key={key} className="rounded-xl border border-border bg-card">
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {unit.status === 'approved' ? (
                      <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="text-sm font-medium text-foreground">
                      Bab {unit.chapterNumber} · {unit.title}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {unit.paragraphCount} paragraf · {unit.wordCount} kata · {unit.choiceCount} pilihan ·{' '}
                    <span className={unit.status === 'rewrite_requested' ? 'text-destructive' : ''}>
                      {reviewLabel[unit.status]}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenKey(openKey === key ? null : key)}
                    className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-muted"
                  >
                    {openKey === key ? 'Tutup teks' : 'Baca teks'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(unit)}
                    className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-muted"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitReview(unit, 'rewrite_requested')}
                    disabled={busy !== null}
                    className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground disabled:opacity-50"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Tulis ulang
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitReview(unit, 'approved')}
                    disabled={busy !== null || unit.status === 'approved'}
                    className="flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Setujui
                  </button>
                </div>
              </div>

              {openKey === key && (
                <div className="border-t border-border px-4 py-3">
                  {unit.paragraphs.map((paragraph, idx) => (
                    <p key={idx} className="mb-2 text-sm leading-relaxed text-foreground">
                      {paragraph}
                    </p>
                  ))}
                  {unit.choices.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                      {unit.choices.map((choice) => (
                        <li key={choice.id}>{choice.label}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {editing && (
                <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor={`title-${key}`}>
                    Judul bab
                  </label>
                  <input
                    id={`title-${key}`}
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    className="min-h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  />
                  <label className="text-xs font-medium text-muted-foreground" htmlFor={`paragraphs-${key}`}>
                    Paragraf (pisahkan dengan baris kosong)
                  </label>
                  <textarea
                    id={`paragraphs-${key}`}
                    value={editParagraphs}
                    onChange={(event) => setEditParagraphs(event.target.value)}
                    rows={6}
                    placeholder="Kosongkan untuk mempertahankan paragraf saat ini."
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  {editChoices.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Label pilihan</span>
                      {editChoices.map((choice, idx) => (
                        <input
                          key={choice.id}
                          value={choice.label}
                          onChange={(event) =>
                            setEditChoices((current) =>
                              current.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, label: event.target.value } : item,
                              ),
                            )
                          }
                          aria-label={`Label pilihan ${idx + 1} (${choice.id})`}
                          className="min-h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveEdit(unit)}
                      disabled={busy !== null}
                      className="min-h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      Simpan (status kembali belum ditinjau)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingKey(null)}
                      className="min-h-9 rounded-lg border border-border px-3 text-xs text-foreground"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {units.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada bab pada varian ini.</p>
      )}
    </div>
  )
}
