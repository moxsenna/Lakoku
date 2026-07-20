import Link from 'next/link'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { StatusBadge } from '@/components/admin/status-badge'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import type { AdminGenerationProviderCall } from '@/lib/admin/generation-schemas'
import { formatDecimal, formatDuration, formatTimestamp, generationJobHref } from './generation-view-model'

export interface ProviderCallLedgerProps {
  calls: AdminGenerationProviderCall[]
  filters: AdminGenerationFilters
  nextHref: string | null
}

export function ProviderCallLedger({ calls, filters, nextHref }: ProviderCallLedgerProps) {
  return (
    <AdminSectionCard
      title="Provider-call ledger"
      subtitle="Read-only, newest first. Hasil provider tidak selalu berarti bab sudah diterbitkan."
    >
      {calls.length === 0 ? <AdminEmptyState message="No provider calls match selected filters." /> : (
        <>
          <p className="px-3 pb-2 text-[11px] text-muted-foreground">
            Kolom &quot;Hasil provider&quot; = HTTP/model call saja. Workflow publish/review terpisah di event GENERATION_ATTEMPT.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30 text-left"><th className="px-3 py-2">Started</th><th className="px-3 py-2">Identity</th><th className="px-3 py-2">Story / job</th><th className="px-3 py-2">Provider / phase</th><th className="px-3 py-2">Hasil provider</th><th className="px-3 py-2 text-right">Latency</th><th className="px-3 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Cost</th></tr></thead>
              <tbody>{calls.map((call) => (
                <tr key={call.id} className="border-b border-border align-top hover:bg-muted/20">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatTimestamp(call.started_at)}<div className="font-mono text-[10px]">{call.provider_call_id}</div></td>
                  <td className="px-3 py-2"><Link href={`/admin/users/${call.user_id}`} className="underline underline-offset-4">{call.masked_user_email ?? call.user_id}</Link><div className="font-mono text-[10px] text-muted-foreground">{call.user_id}</div></td>
                  <td className="px-3 py-2"><div>{call.story_title ?? call.story_id}</div><div className="text-[10px] text-muted-foreground">Chapter {call.chapter_number ?? 'Unavailable'}</div>{call.job_id && <Link href={generationJobHref(filters, call.job_id)} className="text-[10px] underline underline-offset-4">View job</Link>}</td>
                  <td className="px-3 py-2"><div>{call.provider_id}</div><div className="font-mono text-[10px]">{call.model_id}</div><div className="text-[10px] text-muted-foreground">{call.workflow_phase} · fallback {call.fallback_index}</div></td>
                  <td className="px-3 py-2"><StatusBadge status={call.outcome} />{call.error_code && <div className="mt-1 font-mono text-[10px] text-red-600">{call.error_code}</div>}{!call.actual_model_resolved && <div className="mt-1 text-[10px] text-amber-600">Actual model Unavailable</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDuration(call.elapsed_ms)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDecimal(call.total_token_count, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{call.cost_amount !== null && call.cost_currency !== null ? `${call.cost_currency} ${formatDecimal(call.cost_amount, 6)}` : 'Unavailable'}<div className="text-[10px] text-muted-foreground">{call.cost_source}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex justify-end p-3">
            {nextHref ? <Link href={nextHref} rel="next" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Next page</Link> : <span className="text-[11px] text-muted-foreground">End of results</span>}
          </div>
        </>
      )}
    </AdminSectionCard>
  )
}
