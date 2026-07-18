import Link from 'next/link'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import { serializeAdminGenerationFilters } from '@/lib/admin/generation-filters'

export interface GenerationFilterBarProps {
  filters: AdminGenerationFilters
}

export function GenerationFilterBar({ filters }: GenerationFilterBarProps) {
  const preserved: Array<[string, string | number | null]> = [
    ['userId', filters.userId],
    ['storyId', filters.storyId],
    ['generationKind', filters.generationKind],
    ['jobId', filters.jobId],
    ['correlationId', filters.correlationId],
    ['chapter', filters.chapterNumber],
    ['pageSize', filters.pageSize],
  ]
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
      {preserved.map(([key, value]) => value === null ? null : (
        <input key={key} type="hidden" name={key} value={String(value)} />
      ))}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] text-muted-foreground">
          From (UTC)
          <input name="from" type="text" defaultValue={filters.from} placeholder="2026-07-18T00:00:00.000Z" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          To (UTC)
          <input name="to" type="text" defaultValue={filters.to} placeholder="2026-07-18T23:59:59.000Z" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Provider
          <input name="provider" defaultValue={filters.providerId ?? ''} placeholder="openrouter" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Model
          <input name="model" defaultValue={filters.modelId ?? ''} placeholder="provider/model" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Use case
          <input name="useCase" defaultValue={filters.useCase ?? ''} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Phase
          <input name="phase" defaultValue={filters.workflowPhase ?? ''} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Outcome
          <select name="outcome" defaultValue={filters.outcome ?? ''} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
            <option value="">All</option>
            {['SUCCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'ABORTED', 'INVALID_RESPONSE', 'CONTENT_REJECTED'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-muted-foreground">
          Cost source
          <select name="costSource" defaultValue={filters.costSource ?? ''} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
            <option value="">All</option>
            <option value="provider_actual">Provider actual</option>
            <option value="price_estimate">Price estimate</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">Apply filters</button>
        <Link href={`/admin/generation?${clearFilters.toString()}`} className="text-xs text-muted-foreground underline underline-offset-4">Clear</Link>
      </div>
    </form>
  )
}
