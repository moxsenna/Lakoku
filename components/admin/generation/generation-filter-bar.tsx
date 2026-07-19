import Link from 'next/link'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import { serializeAdminGenerationFilters } from '@/lib/admin/generation-filters'

export interface GenerationFilterBarProps {
  filters: AdminGenerationFilters
}

const inputClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground'

export function GenerationFilterBar({ filters }: GenerationFilterBarProps) {
  const clearFilters = serializeAdminGenerationFilters({
    ...filters,
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
  })

  return (
    <form action="/admin/generation" method="get" className="rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FilterInput name="from" label="From (UTC)" value={filters.from} placeholder="2026-07-18T00:00:00.000Z" />
        <FilterInput name="to" label="To (UTC)" value={filters.to} placeholder="2026-07-18T23:59:59.000Z" />
        <FilterInput name="provider" label="Provider" value={filters.providerId} placeholder="openrouter" />
        <FilterInput name="model" label="Model" value={filters.modelId} placeholder="provider/model" />
        <FilterInput name="useCase" label="Use case" value={filters.useCase} />
        <FilterInput name="phase" label="Phase" value={filters.workflowPhase} />
        <label className="text-[11px] text-muted-foreground">
          Outcome
          <select name="outcome" defaultValue={filters.outcome ?? ''} className={inputClass}>
            <option value="">All</option>
            {['SUCCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'ABORTED', 'INVALID_RESPONSE', 'CONTENT_REJECTED'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <FilterInput name="errorCode" label="Error code" value={filters.errorCode} placeholder="PROVIDER_TIMEOUT" />
        <label className="text-[11px] text-muted-foreground">
          Cost source
          <select name="costSource" defaultValue={filters.costSource ?? ''} className={inputClass}>
            <option value="">All</option>
            <option value="provider_actual">Provider actual</option>
            <option value="price_estimate">Price estimate</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <FilterInput name="userId" label="User ID" value={filters.userId} />
        <FilterInput name="storyId" label="Story ID" value={filters.storyId} />
        <label className="text-[11px] text-muted-foreground">
          Generation kind
          <select name="generationKind" defaultValue={filters.generationKind ?? ''} className={inputClass}>
            <option value="">All</option>
            <option value="standard">Standard</option>
            <option value="personalized">Personalized</option>
          </select>
        </label>
        <FilterInput name="jobId" label="Job ID" value={filters.jobId} />
        <FilterInput name="correlationId" label="Correlation ID" value={filters.correlationId} />
        <FilterInput name="chapter" label="Chapter" value={filters.chapterNumber} type="number" min={1} max={50} />
        <FilterInput name="pageSize" label="Ledger page size" value={filters.pageSize} type="number" min={1} max={100} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">Apply filters</button>
        <Link href={`/admin/generation?${clearFilters.toString()}`} className="text-xs text-muted-foreground underline underline-offset-4">Clear</Link>
      </div>
    </form>
  )
}

function FilterInput({
  name,
  label,
  value,
  type = 'text',
  placeholder,
  min,
  max,
}: {
  name: string
  label: string
  value: string | number | null
  type?: 'text' | 'number'
  placeholder?: string
  min?: number
  max?: number
}) {
  return (
    <label className="text-[11px] text-muted-foreground">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        min={min}
        max={max}
        className={inputClass}
      />
    </label>
  )
}
