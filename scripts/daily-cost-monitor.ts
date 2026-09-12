/**
 * Daily cost monitor (G13 soft launch).
 *
 * READ-ONLY. Selects recorded provider transports from the production database
 * and reports measured spend against the ratified E0 R1 ceilings. It writes
 * nothing, mutates nothing, and never derives price from tokens.
 *
 * Usage:
 *   pnpm cost:daily            # last 24h
 *   pnpm cost:daily -- --days 7
 *
 * Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY, which is the only role granted SELECT on
 * `generation_provider_calls`.
 *
 * Exit codes: 0 = OK/WATCH/UNMEASURED, 1 = BREACH or operational failure. A
 * breach is a go/no-go signal for the operator, not an automatic action.
 */
import fs from 'node:fs'
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'

import {
  buildDailyCostReport,
  type ProviderCallCostRow,
} from '../lib/commercial/daily-cost-report'

const PAGE_SIZE = 1000
const MAX_PAGES = 200

const SELECTED_COLUMNS = [
  'started_at',
  'story_id',
  'chapter_number',
  'job_id',
  'provider_id',
  'model_id',
  'outcome',
  'cost_amount',
  'cost_currency',
  'cost_source',
].join(',')

/** Loads `.env.local` without overriding anything already in the environment. */
function loadLocalEnvironment(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
    if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('DAILY_COST_MONITOR_CONFIG_MISSING')
  return value
}

function parsedDays(argv: readonly string[]): number {
  const index = argv.indexOf('--days')
  if (index === -1) return 1
  const raw = argv[index + 1]
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 90) {
    throw new Error('DAILY_COST_MONITOR_RANGE_INVALID')
  }
  return value
}

async function main(): Promise<void> {
  const days = parsedDays(process.argv.slice(2))
  loadLocalEnvironment()
  const url = process.env.SUPABASE_URL?.trim() || requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const rows: ProviderCallCostRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await client
      .from('generation_provider_calls')
      .select(SELECTED_COLUMNS)
      .gte('started_at', from.toISOString())
      .lt('started_at', to.toISOString())
      .order('started_at', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (error) throw new Error('DAILY_COST_MONITOR_QUERY_FAILED')
    if (!data || data.length === 0) break
    rows.push(...(data as unknown as ProviderCallCostRow[]))
    if (data.length < PAGE_SIZE) break
  }

  const report = buildDailyCostReport(rows)

  console.log(`daily-cost-monitor window=${from.toISOString()}..${to.toISOString()} days=${days}`)
  console.log(`daily-cost-monitor authority=${report.decisionRef} chapterCeiling=${report.ceilings.maxCostPerChapterUsd} novelCeiling=${report.ceilings.maxCostPerNovelUsd}`)
  for (const day of report.days) {
    console.log(`daily-cost-monitor day=${day.day} costUsd=${day.measuredCostUsd} calls=${day.callCount} priced=${day.pricedCallCount} unmeasured=${day.unmeasuredCallCount}`)
  }
  for (const watchpoint of report.watchpoints) {
    console.log(`daily-cost-monitor WATCH ${watchpoint.code} scope=${watchpoint.scope} observed=${watchpoint.observedUsd} ceiling=${watchpoint.ceilingUsd}`)
  }
  for (const breach of report.breaches) {
    console.error(`daily-cost-monitor BREACH ${breach.code} scope=${breach.scope} observed=${breach.observedUsd} ceiling=${breach.ceilingUsd}`)
  }
  console.log(`daily-cost-monitor total=${report.totalMeasuredCostUsd} maxChapter=${report.maxChapterCostUsd} calls=${report.callCount} priced=${report.pricedCallCount} unmeasured=${report.unmeasuredCallCount}`)
  console.log(`DAILY-COST-MONITOR-${report.status}`)

  if (report.status === 'BREACH') process.exitCode = 1
}

main().catch((error: unknown) => {
  const code = error instanceof Error && error.message.startsWith('DAILY_COST_MONITOR_')
    ? error.message
    : 'DAILY_COST_MONITOR_FAILED'
  console.error(code)
  process.exitCode = 1
})
