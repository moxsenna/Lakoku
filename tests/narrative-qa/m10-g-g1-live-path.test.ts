import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const liveChapterCalls: unknown[] = []
vi.mock('@/lib/narrative-qa/harness/m10-g-g1-live-executor.server', () => ({
  executeM10GG1LiveChapter: (input: unknown) => {
    liveChapterCalls.push(input)
    throw new Error('LIVE_EXECUTOR_MUST_NOT_RUN_IN_OFFLINE_TEST')
  },
}))

// This suite proves the seams *downstream* of the A/B/C authority gate
// (executor injection, capability forgery, economics fail-closed). Each seam
// must hold on its own, so the authority gate is forced open here. The real
// gate is exercised unmocked in m10-g-g1-live-authority-failclosed.test.ts.
vi.mock('@/lib/narrative-qa/judges/m10-g-g1-remaining-authority', () => ({
  evaluateM10GG1RemainingAuthority: () => ({
    track: 'M10G_G1_REMAINING_AUTHORITY_CLOSURE_V1',
    status: 'BLOCKED',
    economicsMayOpen: true,
    hardInferenceLimit: 2663,
    liveExecutionReady: true,
    subgates: {},
    blockerCodes: [],
  }),
}))

import { buildM10GG1RunManifest } from '@/lib/narrative-qa/harness/m10-g-g1.server'
import { runM10GG1ProofOrchestrationLive } from '@/lib/narrative-qa/harness/m10-g-g1-runner.server'
import { issueM10GG1ExecutionCapability } from '@/lib/runtime/m10-g-g1-execution-capability.server'
import { createM10GG1RunBudgetAuthority } from '@/lib/narrative-qa/contracts/m10-g-g1-run-budget.contract'

function authorityFor(manifestHash: string, hardLimit: number) {
  const { manifest } = buildM10GG1RunManifest()
  return createM10GG1RunBudgetAuthority({
    runId: manifest.runId,
    manifestHash,
    storySeedIdentity: manifest.storySeedIdentity,
    hardLimit,
    issuedBy: 'Lakoku Lead',
    issuedAt: '2026-09-07T00:00:00.000Z',
  })
}

describe('M10-G G-1 live orchestration path', () => {
  it('refuses an arbitrary injected executeChapter on the live entry', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const injected = vi.fn()

    await expect(runM10GG1ProofOrchestrationLive({
      manifest,
      manifestHash,
      authority: authorityFor(manifestHash, 2663),
      capability: issueM10GG1ExecutionCapability(),
      deps: {
        executeSemanticSample: vi.fn(),
        // Simulates a caller trying to smuggle an executor past the live seam.
        executeChapter: injected,
      } as never,
    })).rejects.toThrow('M10G_G1_LIVE_EXECUTOR_INJECTION_FORBIDDEN')

    expect(injected).not.toHaveBeenCalled()
    expect(liveChapterCalls).toHaveLength(0)
  })

  it('refuses a forged capability before any economics or budget work', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()

    await expect(runM10GG1ProofOrchestrationLive({
      manifest,
      manifestHash,
      authority: authorityFor(manifestHash, 2663),
      capability: { executorId: 'generateNextPersonalizedChapter:m10g-g1:v1' } as never,
      deps: { executeSemanticSample: vi.fn() },
    })).rejects.toThrow('M10G_G1_EXECUTION_CAPABILITY_INVALID')

    expect(liveChapterCalls).toHaveLength(0)
  })

  it('still fails closed on blocked economics before reaching the live executor', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const executeSemanticSample = vi.fn()

    await expect(runM10GG1ProofOrchestrationLive({
      manifest,
      manifestHash,
      authority: authorityFor(manifestHash, 2663),
      capability: issueM10GG1ExecutionCapability(),
      deps: { executeSemanticSample },
    })).rejects.toThrow('M10G_G1_ECONOMICS_AUTHORITY_REQUIRED')

    expect(executeSemanticSample).not.toHaveBeenCalled()
    expect(liveChapterCalls).toHaveLength(0)
  })
})
