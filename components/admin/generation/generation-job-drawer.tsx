import Link from 'next/link'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { StatusBadge } from '@/components/admin/status-badge'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import type { AdminGenerationJobDetailRow } from '@/lib/admin/generation-schemas'
import { formatDecimal, formatDuration, formatTimestamp, generationClearJobHref } from './generation-view-model'

function ordered(rows: AdminGenerationJobDetailRow[]): AdminGenerationJobDetailRow[] {
  return [...rows].sort((a, b) => BigInt(a.sequence_number) < BigInt(b.sequence_number) ? -1 : BigInt(a.sequence_number) > BigInt(b.sequence_number) ? 1 : 0)
}

export function GenerationJobDrawer({ rows, filters }: { rows: AdminGenerationJobDetailRow[]; filters: AdminGenerationFilters }) {
  if (rows.length === 0) {
    return <AdminSectionCard title="Job detail"><AdminEmptyState message="Job detail unavailable or job not found." /></AdminSectionCard>
  }
  const sorted = ordered(rows)
  const job = sorted.find((row) => row.row_kind === 'JOB') ?? sorted[0]
  const timeline = sorted.filter((row) => row.row_kind !== 'JOB')

  return (
    <aside aria-labelledby="job-detail-heading" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <div><h2 id="job-detail-heading" className="text-sm font-semibold">Job detail</h2><p className="font-mono text-[10px] text-muted-foreground">{job.job_id}</p></div>
        <Link href={generationClearJobHref(filters)} className="text-xs text-muted-foreground underline underline-offset-4">Close</Link>
      </div>
      <div className="grid gap-3 border-b border-border p-4 text-xs md:grid-cols-2 lg:grid-cols-4">
        <div><span className="text-muted-foreground">State</span><div className="mt-1"><StatusBadge status={job.job_status} /></div></div>
        <div><span className="text-muted-foreground">User</span><div><Link href={`/admin/users/${job.user_id}`} className="underline underline-offset-4">{job.masked_user_email ?? job.user_id}</Link></div></div>
        <div><span className="text-muted-foreground">Story</span><div>{job.story_title ?? job.story_id}</div><div className="text-[10px]">Chapter {job.chapter_number}</div></div>
        <div><span className="text-muted-foreground">Attempts</span><div>{job.job_attempt_count} / {job.max_attempts}</div></div>
        <div><span className="text-muted-foreground">Queued / available</span><div>{formatTimestamp(job.available_at)}</div></div>
        <div><span className="text-muted-foreground">Claimed</span><div>{formatTimestamp(job.claimed_at)}</div></div>
        <div><span className="text-muted-foreground">Heartbeat</span><div>{formatTimestamp(job.heartbeat_at)}</div></div>
        <div><span className="text-muted-foreground">Completed</span><div>{formatTimestamp(job.completed_at)}</div></div>
        <div><span className="text-muted-foreground">Deadline</span><div>{formatTimestamp(job.deadline_at)}</div></div>
        <div><span className="text-muted-foreground">Worker</span><div>{job.worker_id ?? 'Unavailable'}</div></div>
        <div><span className="text-muted-foreground">Correlation</span><div className="font-mono text-[10px]">{job.correlation_id}</div></div>
        <div><span className="text-muted-foreground">Controlled job error</span><div className="font-mono text-[10px]">{job.job_error_code ?? 'None'}</div></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Ordered job attempts and provider calls</caption>
          <thead><tr className="border-b border-border bg-muted/30 text-left"><th className="px-3 py-2">Sequence</th><th className="px-3 py-2">Attempt / call</th><th className="px-3 py-2">Phase / provider</th><th className="px-3 py-2">Result</th><th className="px-3 py-2 text-right">Duration</th><th className="px-3 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Cost</th></tr></thead>
          <tbody>{timeline.map((row) => (
            <tr key={`${row.row_kind}-${row.sequence_number}-${row.attempt_id ?? row.provider_call_row_id ?? ''}`} className="border-b border-border align-top">
              <td className="px-3 py-2 tabular-nums">{row.sequence_number}</td>
              <td className="px-3 py-2">{row.row_kind === 'ATTEMPT' ? `Attempt ${row.attempt_number ?? 'Unavailable'}` : row.provider_call_id ?? 'Provider call'}<div className="font-mono text-[10px] text-muted-foreground">{row.started_at ? formatTimestamp(row.started_at) : ''}</div></td>
              <td className="px-3 py-2"><div>{row.workflow_phase ?? 'Unavailable'}</div><div className="font-mono text-[10px] text-muted-foreground">{row.provider_id && row.model_id ? `${row.provider_id} / ${row.model_id}` : row.retry_decision ?? ''}</div>{row.fallback_index !== null && <div className="text-[10px]">Fallback {row.fallback_index}</div>}</td>
              <td className="px-3 py-2">{row.outcome ? <StatusBadge status={row.outcome} /> : <StatusBadge status={row.job_status} />}<div className="mt-1 font-mono text-[10px] text-red-600">{row.error_code ?? ''}</div></td>
              <td className="px-3 py-2 text-right tabular-nums">{formatDuration(row.elapsed_ms)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatDecimal(row.total_token_count, 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.cost_amount !== null && row.cost_currency !== null ? `${row.cost_currency} ${formatDecimal(row.cost_amount, 6)}` : 'Unavailable'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </aside>
  )
}
