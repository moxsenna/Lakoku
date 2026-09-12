/**
 * Read-only daily cost report over recorded provider transports (G13).
 *
 * BINDS — never redefines — the ratified M10-E E0 R1 ceilings from
 * `fixtures/m10-e/e0-budget-authority.ts` (decision ref
 * LAKOKU-E0-2026-08-26-LOOSE-200-R1).
 *
 * Only provider-reported billed amounts are summed. A transport recorded
 * without a billed amount is COUNTED as unmeasured, never assumed to be free:
 * pricing authority is frozen BLOCKED (M10-G G-1) and this report must not
 * manufacture it by deriving price from tokens.
 *
 * This module is pure — it receives rows and returns a verdict. Fetching lives
 * in the operator script so the reporting logic stays testable without a DB.
 */
import { E0_R1_CEILINGS, E0_R1_DECISION_REF } from '../../fixtures/m10-e/e0-budget-authority'

/** One `generation_provider_calls` row, in the shape PostgREST returns it. */
export type ProviderCallCostRow = Readonly<{
  started_at: string
  story_id: string | null
  chapter_number: number | null
  job_id: string | null
  provider_id: string
  model_id: string
  outcome: string
  cost_amount: string | number | null
  cost_currency: string | null
  cost_source: string
}>

export type DailyCostBucket = Readonly<{
  day: string
  measuredCostUsd: string
  callCount: number
  pricedCallCount: number
  unmeasuredCallCount: number
}>

export type CostFinding = Readonly<{
  code:
    | 'E0_CHAPTER_COST_CEILING_EXCEEDED'
    | 'E0_NOVEL_COST_CEILING_EXCEEDED'
    | 'E0_CHAPTER_COST_WATCHPOINT'
  scope: string
  observedUsd: string
  ceilingUsd: string
}>

export type DailyCostReportStatus = 'OK' | 'WATCH' | 'UNMEASURED' | 'BREACH'

export type DailyCostReport = Readonly<{
  decisionRef: string
  ceilings: Readonly<{ maxCostPerChapterUsd: string, maxCostPerNovelUsd: string }>
  status: DailyCostReportStatus
  days: readonly DailyCostBucket[]
  totalMeasuredCostUsd: string
  maxChapterCostUsd: string
  callCount: number
  pricedCallCount: number
  unmeasuredCallCount: number
  breaches: readonly CostFinding[]
  watchpoints: readonly CostFinding[]
}>

const SCALE = BigInt(10 ** 8)

/**
 * The band below the chapter ceiling that is reported before it trips. The M10-F
 * closeout recorded an observed chapter mean of 2.05 against the R1 ceiling of
 * 2.10; the watchpoint must make that visible while it is still passing.
 */
const CHAPTER_WATCHPOINT_FRACTION_NUMERATOR = BigInt(97)
const CHAPTER_WATCHPOINT_FRACTION_DENOMINATOR = BigInt(100)

class DailyCostReportError extends Error {}

/** Exact decimal at 8 fractional digits via BigInt — never Number. */
function toCents8(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new DailyCostReportError('DAILY_COST_REPORT_COST_MALFORMED')
  }
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > 8 && /[1-9]/.test(fraction.slice(8))) {
    // Over-precise input would have to be rounded; the report must not decide
    // which direction a billed amount moves.
    throw new DailyCostReportError('DAILY_COST_REPORT_COST_MALFORMED')
  }
  return BigInt(whole) * SCALE + BigInt(fraction.slice(0, 8).padEnd(8, '0'))
}

function formatCents(cents: bigint): string {
  return `${cents / SCALE}.${(cents % SCALE).toString().padStart(8, '0')}`
}

function costAmountText(value: string | number | null): string | null {
  if (value === null) return null
  if (typeof value === 'number') {
    // numeric(20,8) arrives as a string from PostgREST; a number here means the
    // value already passed through float and its exactness is unprovable.
    throw new DailyCostReportError('DAILY_COST_REPORT_COST_MALFORMED')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new DailyCostReportError('DAILY_COST_REPORT_COST_MALFORMED')
  return trimmed
}

function dayOf(startedAt: string): string {
  const parsed = new Date(startedAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new DailyCostReportError('DAILY_COST_REPORT_TIMESTAMP_MALFORMED')
  }
  return parsed.toISOString().slice(0, 10)
}

function chapterScope(row: ProviderCallCostRow): string | null {
  if (row.story_id === null || row.chapter_number === null) return null
  // A retry of the same chapter is a separate attempt with its own ceiling; the
  // job id is what separates them.
  return `${row.story_id}#${row.chapter_number}@${row.job_id ?? 'no-job'}`
}

type MutableBucket = {
  day: string
  cents: bigint
  callCount: number
  pricedCallCount: number
  unmeasuredCallCount: number
}

/**
 * Aggregates recorded transports into a daily spend report and compares the
 * measured totals against the frozen E0 R1 ceilings.
 */
export function buildDailyCostReport(rows: readonly ProviderCallCostRow[]): DailyCostReport {
  const buckets = new Map<string, MutableBucket>()
  const chapterCents = new Map<string, bigint>()
  const novelCents = new Map<string, bigint>()
  let totalCents = BigInt(0)
  let pricedCallCount = 0
  let unmeasuredCallCount = 0

  for (const row of rows) {
    const day = dayOf(row.started_at)
    const bucket = buckets.get(day) ?? { day, cents: BigInt(0), callCount: 0, pricedCallCount: 0, unmeasuredCallCount: 0 }
    bucket.callCount += 1

    const amountText = costAmountText(row.cost_amount)
    if (amountText === null || row.cost_source === 'unavailable') {
      bucket.unmeasuredCallCount += 1
      unmeasuredCallCount += 1
      buckets.set(day, bucket)
      continue
    }

    if (row.cost_currency !== 'USD') {
      throw new DailyCostReportError('DAILY_COST_REPORT_CURRENCY_UNSUPPORTED')
    }

    const cents = toCents8(amountText)
    bucket.cents += cents
    bucket.pricedCallCount += 1
    pricedCallCount += 1
    totalCents += cents
    buckets.set(day, bucket)

    const scope = chapterScope(row)
    if (scope !== null) {
      chapterCents.set(scope, (chapterCents.get(scope) ?? BigInt(0)) + cents)
    }
    if (row.story_id !== null) {
      novelCents.set(row.story_id, (novelCents.get(row.story_id) ?? BigInt(0)) + cents)
    }
  }

  const chapterCeiling = toCents8(E0_R1_CEILINGS.maxExpectedCostPerChapter)
  const novelCeiling = toCents8(E0_R1_CEILINGS.maxExpectedCostPerNovel)
  const watchpointFloor = (chapterCeiling * CHAPTER_WATCHPOINT_FRACTION_NUMERATOR)
    / CHAPTER_WATCHPOINT_FRACTION_DENOMINATOR

  const breaches: CostFinding[] = []
  const watchpoints: CostFinding[] = []
  let maxChapterCents = BigInt(0)

  for (const [scope, cents] of chapterCents) {
    if (cents > maxChapterCents) maxChapterCents = cents
    if (cents > chapterCeiling) {
      breaches.push({
        code: 'E0_CHAPTER_COST_CEILING_EXCEEDED',
        scope,
        observedUsd: formatCents(cents),
        ceilingUsd: formatCents(chapterCeiling),
      })
    } else if (cents >= watchpointFloor) {
      watchpoints.push({
        code: 'E0_CHAPTER_COST_WATCHPOINT',
        scope,
        observedUsd: formatCents(cents),
        ceilingUsd: formatCents(chapterCeiling),
      })
    }
  }

  for (const [storyId, cents] of novelCents) {
    if (cents >= novelCeiling) {
      breaches.push({
        code: 'E0_NOVEL_COST_CEILING_EXCEEDED',
        scope: storyId,
        observedUsd: formatCents(cents),
        ceilingUsd: formatCents(novelCeiling),
      })
    }
  }

  const status: DailyCostReportStatus = breaches.length > 0
    ? 'BREACH'
    : unmeasuredCallCount > 0
      ? 'UNMEASURED'
      : watchpoints.length > 0
        ? 'WATCH'
        : 'OK'

  return {
    decisionRef: E0_R1_DECISION_REF,
    ceilings: {
      maxCostPerChapterUsd: E0_R1_CEILINGS.maxExpectedCostPerChapter,
      maxCostPerNovelUsd: E0_R1_CEILINGS.maxExpectedCostPerNovel,
    },
    status,
    days: [...buckets.values()]
      .sort((left, right) => left.day.localeCompare(right.day))
      .map((bucket) => ({
        day: bucket.day,
        measuredCostUsd: formatCents(bucket.cents),
        callCount: bucket.callCount,
        pricedCallCount: bucket.pricedCallCount,
        unmeasuredCallCount: bucket.unmeasuredCallCount,
      })),
    totalMeasuredCostUsd: formatCents(totalCents),
    maxChapterCostUsd: formatCents(maxChapterCents),
    callCount: rows.length,
    pricedCallCount,
    unmeasuredCallCount,
    breaches,
    watchpoints,
  }
}
