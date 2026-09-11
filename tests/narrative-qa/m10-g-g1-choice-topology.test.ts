import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/narrative-qa/harness/m10-g-g1-inference-projection', () => ({
  deriveM10GG1InferenceEconomicsProjection: () => ({
    hardInferenceLimit: 2663,
    economicsStatus: {
      status: 'PASS',
      blockerCodes: [],
    },
  }),
}))

import { buildM10GG1RunManifest } from '@/lib/narrative-qa/harness/m10-g-g1.server'
import { runM10GG1ProofOrchestrationForTest } from '@/lib/narrative-qa/harness/m10-g-g1-runner.server'
import { createM10GG1RunBudgetAuthority } from '@/lib/narrative-qa/contracts/m10-g-g1-run-budget.contract'

describe('M10-G G-1 deterministic accepted-choice topology', () => {
  it('commits Bab 1-49 choices and carries each accepted ID into the next chapter', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const authority = createM10GG1RunBudgetAuthority({
      runId: manifest.runId,
      manifestHash,
      storySeedIdentity: manifest.storySeedIdentity,
      hardLimit: 2663,
      issuedBy: 'Lakoku Lead',
      issuedAt: '2026-09-07T00:00:00.000Z',
    })
    const chapterInputs: Array<{ chapterNumber: number; triggerChoiceId: string | null }> = []
    const choiceCommits: number[] = []

    const result = await runM10GG1ProofOrchestrationForTest({
      manifest,
      manifestHash,
      authority,
      deps: {
        executeChapter: vi.fn(async (input) => {
          chapterInputs.push({
            chapterNumber: input.chapterNumber,
            triggerChoiceId: input.triggerChoiceId,
          })
          return { status: 'SUCCESS' as const, parserOutcome: 'ACCEPTED' as const }
        }),
        commitAcceptedChoice: vi.fn(async ({ chapterNumber }) => {
          choiceCommits.push(chapterNumber)
          return {
            choiceId: `choice-${chapterNumber}`,
            replayed: false,
            nextChapterNumber: chapterNumber + 1,
          }
        }),
        executeSemanticSample: vi.fn(async () => ({
          status: 'SUCCESS' as const,
          modelVerdict: 'PASS' as const,
        })),
      },
    })

    expect(result.status).toBe('COMPLETED')
    expect(chapterInputs).toHaveLength(50)
    expect(chapterInputs[0]).toEqual({ chapterNumber: 1, triggerChoiceId: null })
    for (let chapterNumber = 2; chapterNumber <= 50; chapterNumber += 1) {
      expect(chapterInputs[chapterNumber - 1]).toEqual({
        chapterNumber,
        triggerChoiceId: `choice-${chapterNumber - 1}`,
      })
    }
    expect(choiceCommits).toEqual(Array.from({ length: 49 }, (_, index) => index + 1))
    expect(result.manifest.chapters[0]).toMatchObject({
      acceptedChoiceId: 'choice-1',
      choiceReplayed: false,
    })
    expect(result.manifest.chapters[49]).toMatchObject({
      acceptedChoiceId: null,
      choiceReplayed: null,
    })
  })

  it('keeps trigger stable across retries and never starts next chapter before choice commit', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const authority = createM10GG1RunBudgetAuthority({
      runId: manifest.runId,
      manifestHash,
      storySeedIdentity: manifest.storySeedIdentity,
      hardLimit: 2663,
      issuedBy: 'Lakoku Lead',
      issuedAt: '2026-09-07T00:00:00.000Z',
    })
    const chapterTwoTriggers: Array<string | null> = []
    let chapterTwoAttempts = 0

    const result = await runM10GG1ProofOrchestrationForTest({
      manifest,
      manifestHash,
      authority,
      deps: {
        executeChapter: vi.fn(async (input) => {
          if (input.chapterNumber === 2) {
            chapterTwoAttempts += 1
            chapterTwoTriggers.push(input.triggerChoiceId)
            if (chapterTwoAttempts === 1) {
              return { status: 'FAILURE' as const, reason: 'TRANSIENT' }
            }
          }
          return { status: 'SUCCESS' as const }
        }),
        commitAcceptedChoice: vi.fn(async ({ chapterNumber }) => ({
          choiceId: `accepted-${chapterNumber}`,
          replayed: chapterNumber === 1,
          nextChapterNumber: chapterNumber + 1,
        })),
        executeSemanticSample: vi.fn(async () => ({ status: 'SUCCESS' as const })),
        classifyFailure: vi.fn(() => ({ action: 'CONTINUE_RETRY' as const, code: null })),
      },
    })

    expect(result.status).toBe('COMPLETED')
    expect(chapterTwoTriggers).toEqual(['accepted-1', 'accepted-1'])
    expect(result.manifest.chapters[0]).toMatchObject({
      acceptedChoiceId: 'accepted-1',
      choiceReplayed: true,
    })
  })

  it('stops before Bab 2 when accepted choice cannot be committed', async () => {
    const { manifest, manifestHash } = buildM10GG1RunManifest()
    const authority = createM10GG1RunBudgetAuthority({
      runId: manifest.runId,
      manifestHash,
      storySeedIdentity: manifest.storySeedIdentity,
      hardLimit: 2663,
      issuedBy: 'Lakoku Lead',
      issuedAt: '2026-09-07T00:00:00.000Z',
    })
    const executeChapter = vi.fn(async () => ({ status: 'SUCCESS' as const }))

    const result = await runM10GG1ProofOrchestrationForTest({
      manifest,
      manifestHash,
      authority,
      deps: {
        executeChapter,
        commitAcceptedChoice: vi.fn(async () => {
          throw new Error('CHOICE_CONFLICT')
        }),
        executeSemanticSample: vi.fn(),
      },
    })

    expect(result).toMatchObject({
      status: 'STOPPED',
      completedChapters: 0,
      stopCode: 'M10G_G1_STOP_CANONICAL_STATE_CORRUPTION',
    })
    expect(executeChapter).toHaveBeenCalledTimes(1)
    expect(result.manifest.stopFailVerdicts['choice-1'])
      .toBe('M10G_G1_STOP_CANONICAL_STATE_CORRUPTION')
  })
})
