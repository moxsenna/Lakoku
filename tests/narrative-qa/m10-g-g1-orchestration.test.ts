import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildM10GG1RunManifest } from '../../lib/narrative-qa/harness/m10-g-g1.server'
import {
  evaluateG1RunnerArchitectureReadiness,
  runM10GG1ProofOrchestrationForTest as runM10GG1ProofOrchestration,
} from '../../lib/narrative-qa/harness/m10-g-g1-runner.server'
import { createM10GG1RunBudgetAuthority } from '../../lib/narrative-qa/contracts/m10-g-g1-run-budget.contract'

describe('M10-G G-1 proof runner orchestration', () => {
  it('reports runner architecture readiness is PASS', () => {
    const readiness = evaluateG1RunnerArchitectureReadiness()
    expect(readiness).toEqual({
      ok: true,
      code: null,
      runnerAvailable: true,
      runBudgetAuthorityContractAvailable: true,
    })
  })

  it('fails closed before chapter 1 if authority does not match manifest', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const authority = createM10GG1RunBudgetAuthority({
      runId: manifest.runId,
      manifestHash: 'f'.repeat(64),
      storySeedIdentity: manifest.storySeedIdentity,
      hardLimit: 300,
      issuedBy: 'Lakoku Lead',
      issuedAt: '2026-09-07T00:00:00.000Z',
    })
    const executeChapter = vi.fn()
    const executeSemanticSample = vi.fn()

    await expect(runM10GG1ProofOrchestration({
      manifest,
      manifestHash,
      authority,
      deps: { executeChapter, executeSemanticSample },
    })).rejects.toThrow('M10G_G1_RUN_BUDGET_MANIFEST_HASH_MISMATCH')

    expect(executeChapter).not.toHaveBeenCalled()
    expect(executeSemanticSample).not.toHaveBeenCalled()
  })

  it('rejects caller-issued hard limits while economics authority remains blocked', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const authority = createM10GG1RunBudgetAuthority({
      runId: manifest.runId,
      manifestHash,
      storySeedIdentity: manifest.storySeedIdentity,
      hardLimit: 2663,
      issuedBy: 'Lakoku Lead',
      issuedAt: '2026-09-07T00:00:00.000Z',
    })
    const executeChapter = vi.fn()
    const executeSemanticSample = vi.fn()

    await expect(runM10GG1ProofOrchestration({
      manifest,
      manifestHash,
      authority,
      deps: { executeChapter, executeSemanticSample },
    })).rejects.toThrow(
      'M10G_G1_ECONOMICS_AUTHORITY_REQUIRED:BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
    )

    expect(executeChapter).not.toHaveBeenCalled()
    expect(executeSemanticSample).not.toHaveBeenCalled()
    expect(manifest.inferenceProjection.hardInferenceLimit).toBeNull()
    expect(manifest.inferenceProjection.mutuallyExclusiveWriterTopology).toMatchObject({
      writerLengthRepairEnabled: false,
      writerLengthRepairMaximumTransportsContributed: 0,
    })
  })
})
