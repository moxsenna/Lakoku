import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { proveAnalyticsObservabilityInjected } from '../../lib/narrative-qa/fault/e2/analytics-observability'

function invariant(row: Awaited<ReturnType<typeof proveAnalyticsObservabilityInjected>>, code: string) {
  if (row.proof.disposition !== 'EXECUTED') throw new Error('expected EXECUTED')
  const found = row.proof.immediateInvariants.find((item) => item.code === code)
  if (!found) throw new Error(`missing ${code}`)
  return found
}

describe('M10-E2 row 18 analytics observability', () => {
  it('uses production observed-call seam and preserves only primary result across recorder rejection', async () => {
    const row = await proveAnalyticsObservabilityInjected()
    expect(row).toMatchObject({ id: 'ANALYTICS_OBSERVABILITY_INJECTED', proof: {
      disposition: 'EXECUTED', injectionReached: true,
      expectedOutcome: 'PRIMARY_RESULT_SURVIVED_OPTIONAL_RECORDER_FAILURE',
      observedOutcome: 'PRIMARY_RESULT_SURVIVED_OPTIONAL_RECORDER_FAILURE',
    } })
    expect(invariant(row, 'LOCAL_SYNTHETIC_CALLS').detail.observed).toBe(1)
    expect(invariant(row, 'NETWORK_ATTEMPTS').detail.observed).toBe(0)
    expect(invariant(row, 'OPTIONAL_RECORDER_REJECTION_REACHED').detail.observed).toBe(true)
    expect(invariant(row, 'OPTIONAL_RECORDER_CALLS').detail.observed).toBe(1)
    expect(invariant(row, 'PRIMARY_RESULT_SURVIVED').detail.observed).toBe('PRIMARY_RESULT')
    expect(JSON.stringify(row)).not.toContain('durab')
    expect(JSON.stringify(row)).not.toContain('publish')
  })

  it('fails proof through propagated-error negative adapter', async () => {
    const row = await proveAnalyticsObservabilityInjected({ adapter: {
      execute: async () => { throw new Error('BROKEN_ADAPTER_PROPAGATED') },
    } })
    expect(row).toMatchObject({ proof: { injectionReached: false, observedOutcome: 'PRIMARY_RESULT_DID_NOT_SURVIVE' } })
    expect(invariant(row, 'PRIMARY_ERROR_NOT_PROPAGATED').passed).toBe(false)
  })

  it('blocks and counts a network attempt without invoking real fetch', async () => {
    const originalFetch = globalThis.fetch
    const row = await proveAnalyticsObservabilityInjected({
      adapter: {
        execute: async () => globalThis.fetch('https://network-must-not-run.invalid') as never,
      },
    })

    expect(globalThis.fetch).toBe(originalFetch)
    expect(invariant(row, 'NETWORK_ATTEMPTS')).toEqual({
      code: 'NETWORK_ATTEMPTS', passed: false, detail: { expected: 0, observed: 1 },
    })
    expect(invariant(row, 'PRIMARY_ERROR_NOT_PROPAGATED')).toEqual({
      code: 'PRIMARY_ERROR_NOT_PROPAGATED', passed: false, detail: { expected: true, observed: false },
    })
    expect(row.proof).toMatchObject({
      injectionReached: false,
      observedOutcome: 'PRIMARY_RESULT_DID_NOT_SURVIVE',
    })
  })
})
