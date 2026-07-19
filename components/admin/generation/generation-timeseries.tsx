import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import type { AdminGenerationTimeseriesRow } from '@/lib/admin/generation-schemas'
import { addDecimalStrings, formatDecimal, formatTimestamp } from './generation-view-model'

export interface GenerationTimeseriesProps {
  rows: AdminGenerationTimeseriesRow[]
}

function points(values: number[], width: number, height: number): string {
  const max = Math.max(1, ...values)
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = height - (value / max) * (height - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export function GenerationTimeseries({ rows }: GenerationTimeseriesProps) {
  if (rows.length === 0) {
    return <AdminSectionCard title="Call, token, and cost trend"><AdminEmptyState message="No trend data for selected range." /></AdminSectionCard>
  }

  const metricRows = Array.from(rows.reduce((byBucket, row) => {
    if (!byBucket.has(row.bucket_start)) byBucket.set(row.bucket_start, row)
    return byBucket
  }, new Map<string, AdminGenerationTimeseriesRow>()).values())
  const calls = metricRows.map((row) => Number(row.call_count))
  const tokens = metricRows.map((row) => Number(row.total_token_count))
  const costsByCurrency = rows.reduce((map, row) => {
    const currency = row.cost_currency
    if (currency === null) return map
    const currencyRows = map.get(currency) ?? []
    currencyRows.push(row)
    map.set(currency, currencyRows)
    return map
  }, new Map<string, AdminGenerationTimeseriesRow[]>())
  const costColors = ['stroke-emerald-500', 'stroke-amber-500', 'stroke-rose-500', 'stroke-cyan-500']

  return (
    <AdminSectionCard title="Call, token, and cost trend" subtitle="Daily call/token totals render once; costs stay separated by currency.">
      <div className="p-4">
        <svg viewBox="0 0 640 180" role="img" aria-labelledby="generation-trend-title generation-trend-desc" className="h-44 w-full rounded-lg border border-border bg-muted/10">
          <title id="generation-trend-title">Generation call, token, and currency cost trend</title>
          <desc id="generation-trend-desc">Blue line shows provider calls. Purple line shows token volume. Other lines show cost per currency. Exact data follows in tables.</desc>
          <line x1="0" y1="176" x2="640" y2="176" className="stroke-border" />
          <polyline points={points(calls, 640, 180)} fill="none" className="stroke-sky-500" strokeWidth="3" />
          <polyline points={points(tokens, 640, 180)} fill="none" className="stroke-violet-500" strokeWidth="3" strokeDasharray="6 4" />
          {Array.from(costsByCurrency.entries()).map(([currency, currencyRows], index) => (
            <polyline
              key={currency}
              aria-label={`Cost ${currency}`}
              points={points(currencyRows.map((row) => Number(addDecimalStrings(row.actual_cost_amount, row.estimated_cost_amount))), 640, 180)}
              fill="none"
              className={costColors[index % costColors.length]}
              strokeWidth="2"
            />
          ))}
        </svg>
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-sky-500" />Calls</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-violet-500" />Tokens</span>
          {Array.from(costsByCurrency.keys()).map((currency) => <span key={currency}>Cost {currency}</span>)}
          {costsByCurrency.size === 0 && <span>Cost unavailable</span>}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-xs">
          <caption className="sr-only">Exact generation call and token trend values</caption>
          <thead><tr className="bg-muted/30 text-left"><th className="px-3 py-2">Bucket</th><th className="px-3 py-2 text-right">Calls</th><th className="px-3 py-2 text-right">Tokens</th></tr></thead>
          <tbody>{metricRows.map((row) => (
            <tr key={row.bucket_start} className="border-t border-border">
              <td className="px-3 py-2 text-muted-foreground">{formatTimestamp(row.bucket_start)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.call_count}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatDecimal(row.total_token_count, 0)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-xs">
          <caption className="sr-only">Exact generation cost trend values separated by currency</caption>
          <thead><tr className="bg-muted/30 text-left"><th className="px-3 py-2">Bucket</th><th className="px-3 py-2">Currency</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Unavailable</th></tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={`${row.bucket_start}-${row.cost_currency ?? 'none'}-${index}`} className="border-t border-border">
              <td className="px-3 py-2 text-muted-foreground">{formatTimestamp(row.bucket_start)}</td>
              <td className="px-3 py-2">{row.cost_currency ?? 'Unavailable'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.cost_currency ? `${row.cost_currency} ${formatDecimal(addDecimalStrings(row.actual_cost_amount, row.estimated_cost_amount), 6)}` : 'Unavailable'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.unavailable_cost_count}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </AdminSectionCard>
  )
}
