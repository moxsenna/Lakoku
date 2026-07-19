import Link from 'next/link'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import { serializeAdminGenerationFilters } from '@/lib/admin/generation-filters'

export interface GenerationFilterBarProps {
  filters: AdminGenerationFilters
}

const inputClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground'
const labelClass = 'text-[11px] text-muted-foreground'

function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function presetHref(hours: number): string {
  const to = new Date()
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
  const params = new URLSearchParams()
  params.set('from', from.toISOString())
  params.set('to', to.toISOString())
  return `/admin/generation?${params.toString()}`
}

export function GenerationFilterBar({ filters }: GenerationFilterBarProps) {
  const clearHref = `/admin/generation?${serializeAdminGenerationFilters({
    ...filters,
    from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    to: new Date().toISOString(),
    providerId: null,
    modelId: null,
    useCase: null,
    workflowPhase: null,
    outcome: null,
    errorCode: null,
    costSource: null,
    userId: null,
    storyId: null,
    generationKind: null,
    jobId: null,
    correlationId: null,
    chapterNumber: null,
    cursorStartedAt: null,
    cursorId: null,
    pageSize: 50,
  }).toString()}`

  return (
    <form action="/admin/generation" method="get" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Cepat:</span>
        <PresetLink href={presetHref(24)} label="24 jam" />
        <PresetLink href={presetHref(24 * 7)} label="7 hari" />
        <PresetLink href={presetHref(24 * 30)} label="30 hari" />
        <Link href={clearHref} className="ml-auto text-xs text-muted-foreground underline underline-offset-4">
          Reset ke 24 jam
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          Dari
          <input
            name="from"
            type="datetime-local"
            defaultValue={toLocalInputValue(filters.from)}
            className={inputClass}
            required
          />
          <span className="mt-1 block text-[10px] text-muted-foreground">Waktu lokal perangkat kamu</span>
        </label>
        <label className={labelClass}>
          Sampai
          <input
            name="to"
            type="datetime-local"
            defaultValue={toLocalInputValue(filters.to)}
            className={inputClass}
            required
          />
          <span className="mt-1 block text-[10px] text-muted-foreground">Default: 24 jam terakhir</span>
        </label>
      </div>

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
          Tip: mulai dari preset 24 jam, biarkan filter lanjutan tertutup.
        </span>
      </div>
    </form>
  )
}

function PresetLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:bg-muted"
    >
      {label}
    </Link>
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
