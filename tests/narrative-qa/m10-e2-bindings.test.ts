import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/narrative-core', async () => import('@/lib/narrative/index'))

import { createM10E2NonDbBindings } from '../../lib/narrative-qa/fault/e2-bindings'
import type { E2EvidenceRow } from '../../lib/narrative-qa/fault/e2/taxonomy'

function invariant(row: E2EvidenceRow, code: string) {
  if (row.proof.disposition !== 'EXECUTED') throw new Error(`expected EXECUTED ${row.id}`)
  const found = row.proof.immediateInvariants.find((item) => item.code === code)
  if (!found) throw new Error(`missing ${code}`)
  return found
}

async function rowFor(
  scenario: 'MALFORMED_CHOICES_OUTPUT' | 'PROVIDER_FALLBACK_SUCCEEDS',
  attempt: 'FETCH' | 'CANDIDATE_EXECUTE' | 'OLD_EMPTY_ACTIONS',
): Promise<E2EvidenceRow> {
  const rows = await createM10E2NonDbBindings({ faultProbe: { scenario, attempt } }).runRows1To7()
  const row = rows.find((candidate) => candidate.id === scenario)
  if (!row) throw new Error(`missing ${scenario}`)
  return row
}

describe('M10-E2 production non-DB bindings external-call authority', () => {
  it('keeps zero-call invariant for synthetic production binding', async () => {
    const rows = await createM10E2NonDbBindings().runRows1To7()
    for (const id of ['MALFORMED_CHOICES_OUTPUT', 'PROVIDER_FALLBACK_SUCCEEDS'] as const) {
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing ${id}`)
      expect(invariant(row, 'ACTUAL_NETWORK_MODEL_CALLS')).toMatchObject({
        passed: true,
        detail: { expected: 0, observed: 0 },
      })
      if (id === 'PROVIDER_FALLBACK_SUCCEEDS') {
        expect(row.proof).toMatchObject({
          expectedOutcome: 'PRODUCTION_FINALIZED_CHOICE_BRANCH_VALID',
          observedOutcome: 'PRODUCTION_FINALIZED_CHOICE_BRANCH_VALID',
        })
        expect(invariant(row, 'EXACT_CANDIDATE_TRACE').detail.observed).toBe('choice:0,choice:1')
        expect(invariant(row, 'BOUNDED_CANDIDATE_CALLS').detail.observed).toBe(2)
        expect(invariant(row, 'FINALIZED_CHOICE_BRANCH')).toMatchObject({
          passed: true,
          detail: {
            expected: 'FINALIZED_CHOICE_BRANCH_VALID',
            observed: 'FINALIZED_CHOICE_BRANCH_VALID',
          },
        })
      }
    }
  }, 20_000)

  it('rejects old question with empty actions at production validator/finalizer boundary', async () => {
    const row = await rowFor('PROVIDER_FALLBACK_SUCCEEDS', 'OLD_EMPTY_ACTIONS')

    expect(invariant(row, 'FINALIZED_CHOICE_BRANCH')).toMatchObject({
      passed: false,
      detail: {
        expected: 'FINALIZED_CHOICE_BRANCH_VALID',
        observed: 'FINALIZED_CHOICE_BRANCH_INVALID',
      },
    })
    expect(invariant(row, 'ACTUAL_NETWORK_MODEL_CALLS')).toMatchObject({
      passed: true,
      detail: { expected: 0, observed: 0 },
    })
  }, 20_000)

  it('blocks and counts fetch attempt through actual production gateway binding', async () => {
    const originalFetch = globalThis.fetch
    const row = await rowFor('MALFORMED_CHOICES_OUTPUT', 'FETCH')

    const calls = invariant(row, 'ACTUAL_NETWORK_MODEL_CALLS')
    expect(calls.passed).toBe(false)
    expect(calls.detail.expected).toBe(0)
    expect(calls.detail.observed).toBeGreaterThan(0)
    expect(globalThis.fetch).toBe(originalFetch)
  }, 20_000)

  it('blocks and counts candidate execute attempt through actual production gateway binding', async () => {
    const originalFetch = globalThis.fetch
    const row = await rowFor('PROVIDER_FALLBACK_SUCCEEDS', 'CANDIDATE_EXECUTE')

    const calls = invariant(row, 'ACTUAL_NETWORK_MODEL_CALLS')
    expect(calls.passed).toBe(false)
    expect(calls.detail.expected).toBe(0)
    expect(calls.detail.observed).toBeGreaterThan(0)
    expect(invariant(row, 'FINALIZED_CHOICE_BRANCH').passed).toBe(false)
    expect(globalThis.fetch).toBe(originalFetch)
  }, 20_000)
})
