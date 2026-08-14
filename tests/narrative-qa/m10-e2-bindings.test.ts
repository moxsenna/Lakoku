import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/narrative-core', async () => import('@/lib/narrative/index'))

import { createM10E2NonDbBindings } from '../../lib/narrative-qa/fault/e2-bindings'
import { evaluateE2Gate } from '../../lib/narrative-qa/fault/e2/gate'
import { E2_SCENARIO_IDS } from '../../lib/narrative-qa/fault/e2/catalog'
import type { E2EvidenceRow, E2ScenarioId } from '../../lib/narrative-qa/fault/e2/taxonomy'

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

function gateForRows(rows: E2EvidenceRow[]) {
  const sha = 'a'.repeat(40)
  const remaining = E2_SCENARIO_IDS.filter((id) => !rows.some((row) => row.id === id))
    .map((id: E2ScenarioId): E2EvidenceRow => ({
      id,
      proof: {
        disposition: 'N/A_PROVEN',
        callPathProof: {
          entrypoint: 'fixture', exactCallPath: ['fixture'], inspectedCurrentSources: ['fixture'], terminalFinding: 'fixture',
        },
      },
    }))
  return evaluateE2Gate({
    version: 'm10-e2-fault-evidence/v1', baseGitSha: sha, workingTreeDirty: false,
    seed: 'm10-e2-seed-v1', faultSchedule: [...E2_SCENARIO_IDS], rows: [...rows, ...remaining]
      .sort((a, b) => E2_SCENARIO_IDS.indexOf(a.id) - E2_SCENARIO_IDS.indexOf(b.id)),
    safetyCounters: { duplicatePublicationCount: 0, canonicalCorruptionCount: 0, unboundedRetryCount: 0 },
    resetProof: { completed: true, targets: [{ target: 'fixture', resetApplied: true, cleanStateVerified: true }] },
    e1Regression: { baseGitSha: sha, result: 'PASS' },
  })
}

describe('M10-E2 production non-DB bindings external-call authority', () => {
  it('reports successful parser and finalizer probes as passing EXECUTED evidence', async () => {
    const rows = await createM10E2NonDbBindings().runRows1To7()
    for (const id of ['MALFORMED_CHOICES_OUTPUT', 'PROVIDER_FALLBACK_SUCCEEDS'] as const) {
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing ${id}`)
      expect(row.proof.disposition).toBe('EXECUTED')
      if (row.proof.disposition !== 'EXECUTED') throw new Error(`expected EXECUTED ${id}`)
      expect(row.proof.immediateInvariants.every((item) => item.passed)).toBe(true)
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
    expect(invariant(row, 'FORBIDDEN_MODEL_OR_CANDIDATE_CALLS')).toMatchObject({
      passed: true,
      detail: { expected: 0, observed: 0 },
    })
    expect(row.proof.disposition).toBe('EXECUTED')
    expect(gateForRows([row])).toMatchObject({ result: 'FAIL' })
  }, 20_000)

  it('blocks and counts fetch attempt through actual production gateway binding', async () => {
    const originalFetch = globalThis.fetch
    const row = await rowFor('MALFORMED_CHOICES_OUTPUT', 'FETCH')

    const calls = invariant(row, 'UNEXPECTED_NETWORK_CALLS')
    expect(calls.passed).toBe(false)
    expect(calls.detail.expected).toBe(0)
    expect(calls.detail.observed).toBeGreaterThan(0)
    expect(globalThis.fetch).toBe(originalFetch)
  }, 20_000)

  it('blocks and counts candidate execute attempt through actual production gateway binding', async () => {
    const originalFetch = globalThis.fetch
    const row = await rowFor('PROVIDER_FALLBACK_SUCCEEDS', 'CANDIDATE_EXECUTE')

    const calls = invariant(row, 'FORBIDDEN_MODEL_OR_CANDIDATE_CALLS')
    expect(calls.passed).toBe(false)
    expect(calls.detail.expected).toBe(0)
    expect(calls.detail.observed).toBeGreaterThan(0)
    expect(invariant(row, 'FINALIZED_CHOICE_BRANCH').passed).toBe(false)
    expect(globalThis.fetch).toBe(originalFetch)
  }, 20_000)

  it('does not let partial production-bound rows substitute N/A_PROVEN for remaining normative evidence', async () => {
    const producerRows = await createM10E2NonDbBindings().runRows1To7()
    const result = gateForRows(producerRows)
    expect(result.result).toBe('FAIL')
    expect(result.failures).toContain(
      'ANALYTICS_OBSERVABILITY_INJECTED: disposition must be PROVEN_REFERENCE, observed N/A_PROVEN',
    )
  }, 20_000)

})
