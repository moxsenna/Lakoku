'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'

export interface GenerationFilterBarProps {
  filters: AdminGenerationFilters
}

const inputClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground'
const labelClass = 'text-[11px] text-muted-foreground'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Display ISO instant as browser-local datetime-local value. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Convert datetime-local wall-clock (browser local) to UTC ISO.
 * Never send bare datetime-local to the server — VPS is UTC and would misread it.
 */
export function localInputToIso(localValue: string): string {
  const trimmed = localValue.trim()
  if (!trimmed) throw new Error('empty timestamp')
  // Already absolute.
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const absolute = new Date(trimmed)
    if (Number.isNaN(absolute.getTime())) throw new Error('invalid timestamp')
    return absolute.toISOString()
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (!match) throw new Error('invalid timestamp')
  const [, y, mo, d, h, mi, s] = match
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
    0,
  )
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp')
  return date.toISOString()
}

export function buildPresetRange(hours: number, now = new Date()): { from: string; to: string } {
  const to = new Date(now.getTime())
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function buildGenerationQuery(args: {
  from: string
  to: string
  provider?: string
  model?: string
  useCase?: string
  phase?: string
  outcome?: string
  errorCode?: string
  costSource?: string
  userId?: string
  storyId?: string
  generationKind?: string
  jobId?: string
  correlationId?: string
  chapter?: string
  pageSize?: string
}): string {
  const params = new URLSearchParams()
  params.set('from', args.from)
  params.set('to', args.to)
  const optional: Array<[string, string | undefined]> = [
    ['provider', args.provider],
    ['model', args.model],
    ['useCase', args.useCase],
    ['phase', args.phase],
    ['outcome', args.outcome],
    ['errorCode', args.errorCode],
    ['costSource', args.costSource],
    ['userId', args.userId],
    ['storyId', args.storyId],
    ['generationKind', args.generationKind],
    ['jobId', args.jobId],
    ['correlationId', args.correlationId],
    ['chapter', args.chapter],
    ['pageSize', args.pageSize],
  ]
  for (const [key, value] of optional) {
    const trimmed = value?.trim()
    if (trimmed) params.set(key, trimmed)
  }
  return `/admin/generation?${params.toString()}`
}

export function GenerationFilterBar({ filters }: GenerationFilterBarProps) {
  const router = useRouter()
  const [fromLocal, setFromLocal] = useState(() => toLocalInputValue(filters.from))
  const [toLocal, setToLocal] = useState(() => toLocalInputValue(filters.to))
  const [error, setError] = useState<string | null>(null)

  // Keep pickers in sync when URL/presets change (defer to avoid sync setState-in-effect lint).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFromLocal(toLocalInputValue(filters.from))
      setToLocal(toLocalInputValue(filters.to))
      setError(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [filters.from, filters.to])

  function goPreset(hours: number) {
    const range = buildPresetRange(hours)
    // Absolute ISO only — no advanced filters, no cursor.
    router.push(buildGenerationQuery(range))
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    try {
      const from = localInputToIso(String(form.get('fromLocal') ?? fromLocal))
      const to = localInputToIso(String(form.get('toLocal') ?? toLocal))
      if (new Date(from).getTime() >= new Date(to).getTime()) {
        setError('Waktu "Dari" harus sebelum "Sampai".')
        return
      }
      const maxMs = 90 * 24 * 60 * 60 * 1000
      if (new Date(to).getTime() - new Date(from).getTime() > maxMs) {
        setError('Maksimal rentang 90 hari.')
        return
      }
      router.push(buildGenerationQuery({
        from,
        to,
        provider: String(form.get('provider') ?? ''),
        model: String(form.get('model') ?? ''),
        useCase: String(form.get('useCase') ?? ''),
        phase: String(form.get('phase') ?? ''),
        outcome: String(form.get('outcome') ?? ''),
        errorCode: String(form.get('errorCode') ?? ''),
        costSource: String(form.get('costSource') ?? ''),
        userId: String(form.get('userId') ?? ''),
        storyId: String(form.get('storyId') ?? ''),
        generationKind: String(form.get('generationKind') ?? ''),
        jobId: String(form.get('jobId') ?? ''),
        correlationId: String(form.get('correlationId') ?? ''),
        chapter: String(form.get('chapter') ?? ''),
        pageSize: String(form.get('pageSize') ?? ''),
      }))
    } catch {
      setError('Waktu tidak valid. Pakai preset 24 jam.')
    }
  }

  const resetHref = buildGenerationQuery(buildPresetRange(24))

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Cepat:</span>
        <PresetButton label="24 jam" onClick={() => goPreset(24)} />
        <PresetButton label="7 hari" onClick={() => goPreset(24 * 7)} />
        <PresetButton label="30 hari" onClick={() => goPreset(24 * 30)} />
        <Link
          href={resetHref}
          className="ml-auto text-xs text-muted-foreground underline underline-offset-4"
        >
          Reset ke 24 jam
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          Dari
          <input
            key={`from-${filters.from}`}
            name="fromLocal"
            type="datetime-local"
            value={fromLocal}
            onChange={(event) => setFromLocal(event.target.value)}
            className={inputClass}
            required
          />
          <span className="mt-1 block text-[10px] text-muted-foreground">
            Waktu lokal perangkat · dikirim sebagai UTC ke server
          </span>
        </label>
        <label className={labelClass}>
          Sampai
          <input
            key={`to-${filters.to}`}
            name="toLocal"
            type="datetime-local"
            value={toLocal}
            onChange={(event) => setToLocal(event.target.value)}
            className={inputClass}
            required
          />
          <span className="mt-1 block text-[10px] text-muted-foreground">
            Default: 24 jam terakhir (bukan semua riwayat)
          </span>
        </label>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      ) : null}

      <details className="mt-4 rounded-lg border border-border/70 bg-background/40 p-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Filter lanjutan (opsional)
        </summary>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Kosongkan semua field di bawah untuk melihat seluruh data di rentang waktu.
          Isi hanya saat investigasi insiden.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field name="provider" label="Provider" defaultValue={filters.providerId} placeholder="opsional, contoh: openrouter" />
          <Field name="model" label="Model" defaultValue={filters.modelId} placeholder="opsional" />
          <Field name="useCase" label="Use case" defaultValue={filters.useCase} placeholder="opsional" />
          <Field name="phase" label="Phase" defaultValue={filters.workflowPhase} placeholder="opsional" />

          <label className={labelClass}>
            Outcome
            <select name="outcome" defaultValue={filters.outcome ?? ''} className={inputClass}>
              <option value="">Semua</option>
              {['SUCCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'ABORTED', 'INVALID_RESPONSE', 'CONTENT_REJECTED'].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <Field name="errorCode" label="Kode error" defaultValue={filters.errorCode} placeholder="opsional" />

          <label className={labelClass}>
            Sumber biaya
            <select name="costSource" defaultValue={filters.costSource ?? ''} className={inputClass}>
              <option value="">Semua</option>
              <option value="provider_actual">Provider actual</option>
              <option value="price_estimate">Price estimate</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>

          <label className={labelClass}>
            Jenis generasi
            <select name="generationKind" defaultValue={filters.generationKind ?? ''} className={inputClass}>
              <option value="">Semua</option>
              <option value="standard">Standard</option>
              <option value="personalized">Personalized</option>
            </select>
          </label>

          <Field name="userId" label="User ID" defaultValue={filters.userId} placeholder="UUID opsional" />
          <Field name="storyId" label="Story ID" defaultValue={filters.storyId} placeholder="opsional" />
          <Field name="jobId" label="Job ID" defaultValue={filters.jobId} placeholder="UUID opsional" />
          <Field name="correlationId" label="Correlation ID" defaultValue={filters.correlationId} placeholder="UUID opsional" />
          <Field name="chapter" label="Bab" defaultValue={filters.chapterNumber} type="number" min={1} max={50} placeholder="1-50" />
          <Field name="pageSize" label="Baris ledger" defaultValue={filters.pageSize} type="number" min={1} max={100} />
        </div>
      </details>

      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">
          Terapkan
        </button>
        <span className="text-[11px] text-muted-foreground">
          Tip: klik <strong>24 jam</strong> dulu. Filter lanjutan biarkan tertutup.
        </span>
      </div>
    </form>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:bg-muted"
    >
      {label}
    </button>
  )
}

function Field({
  name,
  label,
  defaultValue,
  type = 'text',
  placeholder,
  min,
  max,
}: {
  name: string
  label: string
  defaultValue: string | number | null
  type?: 'text' | 'number'
  placeholder?: string
  min?: number
  max?: number
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        min={min}
        max={max}
        className={inputClass}
      />
    </label>
  )
}
