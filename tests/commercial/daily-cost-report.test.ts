import { describe, expect, it } from 'vitest'

import {
  buildDailyCostReport,
  type ProviderCallCostRow,
} from '../../lib/commercial/daily-cost-report'
import { E0_R1_CEILINGS } from '../../fixtures/m10-e/e0-budget-authority'

function row(overrides: Partial<ProviderCallCostRow> = {}): ProviderCallCostRow {
  return {
    started_at: '2026-09-12T03:00:00.000Z',
    story_id: 'story-a',
    chapter_number: 1,
    job_id: 'job-1',
    provider_id: 'openrouter',
    model_id: 'model-x',
    outcome: 'SUCCEEDED',
    cost_amount: '0.50000000',
    cost_currency: 'USD',
    cost_source: 'provider_actual',
    ...overrides,
  }
}

describe('daily cost report', () => {
  it('binds the ratified E0 R1 ceilings verbatim instead of redefining them', () => {
    const report = buildDailyCostReport([])
    expect(report.ceilings.maxCostPerChapterUsd).toBe(E0_R1_CEILINGS.maxExpectedCostPerChapter)
    expect(report.ceilings.maxCostPerNovelUsd).toBe(E0_R1_CEILINGS.maxExpectedCostPerNovel)
    expect(report.decisionRef).toBe('LAKOKU-E0-2026-08-26-LOOSE-200-R1')
  })

  it('reports an empty window as OK with zero measured spend', () => {
    const report = buildDailyCostReport([])
    expect(report.status).toBe('OK')
    expect(report.totalMeasuredCostUsd).toBe('0.00000000')
    expect(report.days).toEqual([])
    expect(report.breaches).toEqual([])
  })

  it('sums measured cost per day in exact decimal, never floating point', () => {
    // 0.1 + 0.2 is the canonical float trap; exact decimal must give 0.3.
    const report = buildDailyCostReport([
      row({ cost_amount: '0.10000000' }),
      row({ cost_amount: '0.20000000', started_at: '2026-09-12T20:00:00.000Z' }),
      row({ cost_amount: '1.00000000', started_at: '2026-09-13T01:00:00.000Z', chapter_number: 2, job_id: 'job-2' }),
    ])
    expect(report.days).toEqual([
      { day: '2026-09-12', measuredCostUsd: '0.30000000', callCount: 2, pricedCallCount: 2, unmeasuredCallCount: 0 },
      { day: '2026-09-13', measuredCostUsd: '1.00000000', callCount: 1, pricedCallCount: 1, unmeasuredCallCount: 0 },
    ])
    expect(report.totalMeasuredCostUsd).toBe('1.30000000')
  })

  it('counts unmeasured transports separately and never treats them as zero spend', () => {
    const report = buildDailyCostReport([
      row({ cost_amount: null, cost_currency: null, cost_source: 'unavailable' }),
      row({ cost_amount: '0.25000000' }),
    ])
    expect(report.days[0]).toEqual({
      day: '2026-09-12',
      measuredCostUsd: '0.25000000',
      callCount: 2,
      pricedCallCount: 1,
      unmeasuredCallCount: 1,
    })
    expect(report.unmeasuredCallCount).toBe(1)
    expect(report.status).toBe('UNMEASURED')
  })

  it('flags a chapter attempt whose accumulated cost exceeds the E0 R1 chapter ceiling', () => {
    const report = buildDailyCostReport([
      row({ cost_amount: '2.00000000' }),
      row({ cost_amount: '0.10000001' }),
    ])
    expect(report.status).toBe('BREACH')
    expect(report.breaches).toEqual([
      {
        code: 'E0_CHAPTER_COST_CEILING_EXCEEDED',
        scope: 'story-a#1@job-1',
        observedUsd: '2.10000001',
        ceilingUsd: '2.10000000',
      },
    ])
  })

  it('treats the chapter ceiling as inclusive — exactly at the ceiling is not a breach', () => {
    const report = buildDailyCostReport([
      row({ cost_amount: '2.00000000' }),
      row({ cost_amount: '0.10000000' }),
    ])
    expect(report.breaches).toEqual([])
    // Sitting exactly on the ceiling is not a breach, but it is the loudest
    // possible watchpoint — one more cent trips.
    expect(report.status).toBe('WATCH')
    expect(report.maxChapterCostUsd).toBe('2.10000000')
  })

  it('surfaces the watchpoint band below the ceiling so 2.05 is visible before it trips', () => {
    const report = buildDailyCostReport([row({ cost_amount: '2.05000000' })])
    expect(report.status).toBe('WATCH')
    expect(report.maxChapterCostUsd).toBe('2.05000000')
    expect(report.watchpoints).toEqual([
      { code: 'E0_CHAPTER_COST_WATCHPOINT', scope: 'story-a#1@job-1', observedUsd: '2.05000000', ceilingUsd: '2.10000000' },
    ])
  })

  it('accumulates per novel and flags the novel ceiling independently of chapters', () => {
    const rows: ProviderCallCostRow[] = []
    for (let chapter = 1; chapter <= 100; chapter++) {
      rows.push(row({ chapter_number: chapter, job_id: `job-${chapter}`, cost_amount: '2.00000000' }))
    }
    const report = buildDailyCostReport(rows)
    expect(report.breaches).toEqual([
      {
        code: 'E0_NOVEL_COST_CEILING_EXCEEDED',
        scope: 'story-a',
        observedUsd: '200.00000000',
        ceilingUsd: '200.00000000',
      },
    ])
  })

  it('rejects a non-USD billed amount instead of silently mixing currencies', () => {
    expect(() => buildDailyCostReport([row({ cost_currency: 'EUR' })]))
      .toThrow('DAILY_COST_REPORT_CURRENCY_UNSUPPORTED')
  })

  it('rejects a malformed cost amount instead of coercing it', () => {
    expect(() => buildDailyCostReport([row({ cost_amount: 'NaN' })]))
      .toThrow('DAILY_COST_REPORT_COST_MALFORMED')
  })

  it('counts failed transports because a failed call is still billed', () => {
    const report = buildDailyCostReport([
      row({ outcome: 'PROVIDER_ERROR', cost_amount: '0.40000000' }),
    ])
    expect(report.totalMeasuredCostUsd).toBe('0.40000000')
    expect(report.days[0].pricedCallCount).toBe(1)
  })
})
