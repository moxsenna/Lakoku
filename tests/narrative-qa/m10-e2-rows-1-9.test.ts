import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import {
  materializeChapterStateCandidateV1,
  projectEffectivePlotDebtState,
  type StructuredStateProposalV1,
} from '@lakoku/narrative-core'
import {
  isCheckpointUsableForChoiceRetry,
  proseFingerprint,
  verifyCheckpointFreshness,
  type ChapterGenerationCheckpoint,
  type CheckpointFreshnessContext,
} from '@/lib/runtime/chapter-generation-checkpoint.pure'
import {
  assembleHistoricalCheckpointReference,
  proveCheckpointDecision,
  proveCheckpointUsability,
  proveMalformedChoicesOutput,
  proveMalformedStateProposalDelta,
  proveProviderFallbackSucceeds,
  staleLeaseReclamationScenarioContract,
  type ExternalCallAuthority,
} from '../../lib/narrative-qa/fault/e2/rows-1-9'
import type { ProviderCandidateTransport } from '@/lib/ai-gateway/provider'

const { streamTextMock, generateTextMock, createOpenAICompatibleMock, recordCallMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  generateTextMock: vi.fn(),
  createOpenAICompatibleMock: vi.fn(),
  recordCallMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/narrative-core', async () => import('@/lib/narrative/index'))
vi.mock('ai', () => ({
  streamText: streamTextMock,
  generateText: generateTextMock,
  Output: { object: vi.fn((value) => value) },
}))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: createOpenAICompatibleMock }))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({ recordGenerationProviderCall: recordCallMock }))

const telemetryContext = {
  userId: '10000000-0000-4000-8000-000000000001',
  storyId: 'fixture:warisan-terkubur',
  chapterNumber: 12,
  generationKind: 'standard',
  jobId: null,
  correlationId: '20000000-0000-4000-8000-000000000002',
  attemptNumber: null,
} as const

const choiceInput = {
  storyId: 'story-a',
  currentChapter: 12,
  draft: { title: 'Bab 12', lastParagraphs: ['satu', 'dua', 'tiga'] as [string, string, string] },
  chapterBrief: {
    phase: 'rising', chapterGoal: 'Maju', mustInclude: [], mustNotInclude: [], mustNotReveal: [],
    plotDebtsToProgress: [], plotDebtsToClose: [], remainingChapters: 38, endingRunway: 'expansion' as const,
  },
  routeState: { truth: 0, risk: 0, secrecy: 0, empathy: 0, trust: {}, flags: {}, endingBias: {}, evidence: [] },
  choiceHistory: [],
  lockedEndingKey: null,
  canon: { activeCharacters: [], activeThreads: [], pendingReveals: [] },
}

function route(fallback = false) {
  return {
    useCase: 'chapter_prose' as const,
    provider: 'gateway' as const,
    modelId: 'openai/chapter-primary',
    fallbackModels: fallback ? [{ provider: 'gateway' as const, modelId: 'openai/choice-fallback' }] : [],
    temperature: 0.6,
    maxOutputTokens: 4000,
    routeVersion: 'chapter-v2',
  }
}

async function runChoice(transport: ProviderCandidateTransport, fallback = false): Promise<unknown> {
  const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
  const provider = createGatewayProvider(undefined, undefined, route(), fallback ? route(true) : route())
  return provider.generateChoices?.(choiceInput, {
    telemetryContext,
    workflowPhase: 'CHOICES_INITIAL',
    providerRuntime: { candidateTransport: transport },
  })
}

function checkpoint(overrides: Partial<ChapterGenerationCheckpoint> = {}): ChapterGenerationCheckpoint {
  return {
    storyId: 'story-a', chapterNumber: 12, attemptId: 'attempt-a', correlationId: 'correlation-a',
    status: 'PROSE_READY', title: 'Bab 12', paragraphs: ['Paragraf aman.'],
    proseFingerprint: proseFingerprint('Bab 12', ['Paragraf aman.']), auditSignals: null,
    auditSignalsVersion: null, canonVersion: 5, blueprintVersion: 2, directionFingerprint: 'direction-a',
    generationMode: 'standard', generationPolicyVersion: 2, promptContractVersion: 2,
    jobId: 'job-a', jobAttemptNumber: 1, schemaVersion: 2, proseAttemptCount: 1,
    choiceAttemptCount: 0, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z',
    expiresAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

function freshness(overrides: Partial<CheckpointFreshnessContext> = {}): CheckpointFreshnessContext {
  return {
    canonVersion: 5, blueprintVersion: 2, directionFingerprint: 'direction-a', generationMode: 'standard',
    generationPolicyVersion: 2, promptContractVersion: 2, requireJobProvenance: true,
    jobId: 'job-a', jobAttemptNumber: 1, ...overrides,
  }
}

function denyExternalAdapters(externalCalls: ExternalCallAuthority): void {
  vi.stubGlobal('fetch', vi.fn(() => {
    externalCalls.recordExternalCall('FETCH')
    throw new Error('FETCH_DENIED')
  }))
  streamTextMock.mockImplementation(() => {
    externalCalls.recordExternalCall('MODEL_SDK')
    throw new Error('MODEL_SDK_DENIED')
  })
  generateTextMock.mockImplementation(() => {
    externalCalls.recordExternalCall('MODEL_SDK')
    throw new Error('MODEL_SDK_DENIED')
  })
}

function instrumentCandidateExecute(
  transport: ProviderCandidateTransport,
  externalCalls: ExternalCallAuthority,
): ProviderCandidateTransport {
  return (candidate) => transport({
    ...candidate,
    execute: () => {
      externalCalls.recordExternalCall('CANDIDATE_EXECUTE')
      throw new Error('CANDIDATE_EXECUTE_DENIED')
    },
  })
}

function evidenceInvariant(row: ReturnType<typeof proveCheckpointDecision> | Awaited<ReturnType<typeof proveMalformedChoicesOutput>>, code: string) {
  if (row.proof.disposition !== 'EXECUTED') throw new Error(`expected EXECUTED row ${row.id}`)
  const found = row.proof.immediateInvariants.find((candidate) => candidate.code === code)
  if (!found) throw new Error(`missing invariant ${code}`)
  return found
}

beforeEach(() => {
  streamTextMock.mockReset()
  generateTextMock.mockReset()
  createOpenAICompatibleMock.mockReset()
  recordCallMock.mockReset()
  recordCallMock.mockResolvedValue(undefined)
  createOpenAICompatibleMock.mockImplementation(() => () => 'model')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('M10-E2 rows 1-3 production seam proofs', () => {
  it('executes malformed choices through current parser with observed zero external calls', async () => {
    const row = await proveMalformedChoicesOutput({
      runChoice: (transport, externalCalls) => {
        denyExternalAdapters(externalCalls)
        return runChoice(instrumentCandidateExecute(transport, externalCalls))
      },
    })
    expect(row).toMatchObject({ id: 'MALFORMED_CHOICES_OUTPUT', proof: { disposition: 'EXECUTED' } })
    expect(evidenceInvariant(row, 'MALFORMED_CHOICES_REJECTED')).toMatchObject({ passed: true })
    expect(evidenceInvariant(row, 'ACTUAL_NETWORK_MODEL_CALLS')).toMatchObject({
      passed: true,
      detail: { expected: 0, observed: 0 },
    })
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('executes narrow materializer proof and observes PROPOSAL_INVALID', async () => {
    const malformed = {
      schemaVersion: 1,
      storyId: misteriDramaContract.storyId,
      chapterNumber: 2,
      facts: { add: 'adversarial-not-an-array', markPaidOff: [] },
      knowledge: { grants: [] }, secrets: { revealIds: [] }, timeline: { append: [] },
      characters: { statusChanges: [] }, threads: { touches: [], transitions: [] },
      plotDebts: { progress: [], closures: [] }, actRollup: null,
    }
    const row = await proveMalformedStateProposalDelta({
      executeMaterializer: () => materializeChapterStateCandidateV1({
        storyId: misteriDramaContract.storyId,
        chapterNumber: 2,
        snapshot: { ...buildFixtureSnapshot(), storyId: misteriDramaContract.storyId },
        storyContract: misteriDramaContract,
        effectivePlotDebtState: projectEffectivePlotDebtState({
          plotDebts: misteriDramaContract.plotDebts,
          progressedMilestones: {},
          closedDebtIds: [],
          chapterNumber: 2,
        }),
        proposal: malformed as unknown as StructuredStateProposalV1,
      }),
    })
    expect(row).toMatchObject({ id: 'MALFORMED_STATE_PROPOSAL_DELTA', proof: { disposition: 'EXECUTED' } })
    expect(evidenceInvariant(row, 'REJECTION_CODE')).toMatchObject({
      passed: true,
      detail: { expected: 'PROPOSAL_INVALID', observed: 'PROPOSAL_INVALID' },
    })
    if (row.proof.disposition !== 'EXECUTED') throw new Error('expected EXECUTED materializer proof')
    expect(row.proof.immediateInvariants.map((entry) => entry.code)).toEqual([
      'MALFORMED_PROPOSAL_REJECTED',
      'REJECTION_CODE',
    ])
  })

  it('executes malformed primary then valid fallback with exact trace and observed zero external calls', async () => {
    const row = await proveProviderFallbackSucceeds({
      runChoice: (transport, externalCalls) => {
        denyExternalAdapters(externalCalls)
        return runChoice(instrumentCandidateExecute(transport, externalCalls), true)
      },
    })
    expect(row).toMatchObject({ id: 'PROVIDER_FALLBACK_SUCCEEDS', proof: { disposition: 'EXECUTED' } })
    expect(evidenceInvariant(row, 'EXACT_CANDIDATE_TRACE').detail.observed).toBe('choice:0,choice:1')
    expect(evidenceInvariant(row, 'BOUNDED_CANDIDATE_CALLS').detail.observed).toBe(2)
    expect(evidenceInvariant(row, 'ACTUAL_NETWORK_MODEL_CALLS').detail.observed).toBe(0)
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('fails zero-external-call invariant when probe records an attempted call', async () => {
    const row = await proveMalformedChoicesOutput({
      runChoice: (transport, externalCalls) => {
        externalCalls.recordExternalCall('MODEL_SDK')
        return runChoice(transport)
      },
    })

    expect(evidenceInvariant(row, 'ACTUAL_NETWORK_MODEL_CALLS')).toEqual({
      code: 'ACTUAL_NETWORK_MODEL_CALLS',
      passed: false,
      detail: { expected: 0, observed: 1 },
    })
  })
})

describe('M10-E2 rows 4-9 checkpoint proofs', () => {
  it('leaves stale lease reclamation as explicit Task 3 DB scenario contract', () => {
    expect(staleLeaseReclamationScenarioContract()).toMatchObject({
      id: 'STALE_LEASE_RECLAMATION',
      proof: { disposition: 'REVIEW_REQUIRED', review: { owner: 'M10-E Task 3' } },
    })
  })

  it.each([
    ['CHECKPOINT_ALTERED_PROVENANCE', 'JOB_ID_MISMATCH', () => verifyCheckpointFreshness(checkpoint(), freshness({ jobId: 'job-b' }))],
    ['CHECKPOINT_ATTEMPT_AHEAD', 'ATTEMPT_AHEAD', () => verifyCheckpointFreshness(checkpoint({ jobAttemptNumber: 3 }), freshness({ jobAttemptNumber: 2 }))],
  ] as const)('executes %s against current pure checkpoint freshness verifier', (id, reason, verify) => {
    const row = proveCheckpointDecision({
      id,
      expectedReason: reason,
      verify: () => {
        const result = verify()
        return { accepted: result.fresh, reason: result.fresh ? 'FRESH' : 'reason' in result ? result.reason : reason }
      },
    })
    expect(row).toMatchObject({ id, proof: { disposition: 'EXECUTED' } })
    expect(evidenceInvariant(row, 'CHECKPOINT_REJECTION_REASON').detail.observed).toBe(reason)
    expect(evidenceInvariant(row, 'CHECKPOINT_REUSE_COUNT').detail.observed).toBe(0)
  })

  it('executes expired checkpoint against current usability function without inventing a reason', () => {
    const row = proveCheckpointUsability({
      id: 'CHECKPOINT_EXPIRED',
      verifyUsable: () => isCheckpointUsableForChoiceRetry(
        checkpoint(),
        new Date('2026-08-15T00:00:00.000Z'),
      ),
    })
    expect(row).toMatchObject({ id: 'CHECKPOINT_EXPIRED', proof: { disposition: 'EXECUTED' } })
    expect(evidenceInvariant(row, 'CHECKPOINT_USABLE')).toEqual({
      code: 'CHECKPOINT_USABLE',
      passed: true,
      detail: { expected: false, observed: false },
    })
    if (row.proof.disposition !== 'EXECUTED') throw new Error('expected EXECUTED usability proof')
    expect(row.proof.immediateInvariants.map((entry) => entry.code)).not.toContain('CHECKPOINT_REJECTION_REASON')
  })

  it.each([
    ['CHECKPOINT_SCHEMA_MISMATCH', "  'CONFLICT', 'state_delta_schema_version mismatch → CONFLICT');"],
    ['CHECKPOINT_STATE_DELTA_HASH_MISMATCH', "  'CONFLICT', 'state_delta_hash mismatch → CONFLICT');"],
  ] as const)('assembles %s authority only from injected Git metadata reader', async (id, exactAssertion) => {
    const sourceCommit = 'cccccccccccccccccccccccccccccccccccccccc'
    const sourceTestPath = 'supabase/tests/living_canon_publication_primitives_test.sql'
    const productionPath = 'supabase/migrations/20260805020000_living_canon_publication_primitives.sql'
    const sourceTestBlobSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const productionBlobSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const metadataReader = {
      readHeadSha: vi.fn().mockResolvedValue('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      readBlobSha: vi.fn(async (path: string) => path === sourceTestPath
        ? sourceTestBlobSha
        : productionBlobSha),
      readBlobContent: vi.fn().mockResolvedValue(`begin;\n${exactAssertion}\nrollback;`),
    }
    const row = await assembleHistoricalCheckpointReference({
      id,
      sourceCommit,
      sourceTest: `${sourceTestPath}:1077`,
      sourceTestPath,
      relevantCurrentSource: productionPath,
      exactAssertion,
      exactProperty: exactAssertion,
      metadataReader,
    })
    expect(metadataReader.readHeadSha).toHaveBeenCalledOnce()
    expect(metadataReader.readBlobSha).toHaveBeenCalledWith(sourceTestPath, sourceCommit)
    expect(metadataReader.readBlobContent).toHaveBeenCalledWith(sourceTestPath, sourceCommit)
    expect(metadataReader.readBlobSha).toHaveBeenCalledWith(productionPath, sourceCommit)
    expect(metadataReader.readBlobSha).toHaveBeenCalledWith(productionPath, 'HEAD')
    expect(row).toMatchObject({ id, proof: {
      disposition: 'PROVEN_REFERENCE',
      sourceCommit,
      sourceTestBlobSha,
      exactAssertion,
      compatibilityProof: {
        method: 'SOURCE_UNCHANGED',
        currentHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sourceBlobSha: productionBlobSha,
        currentBlobSha: productionBlobSha,
      },
    } })

    const mutatedReader = {
      ...metadataReader,
      readBlobSha: vi.fn(async (path: string, revision: string) => {
        if (path === sourceTestPath) return sourceTestBlobSha
        return revision === sourceCommit ? productionBlobSha : 'dddddddddddddddddddddddddddddddddddddddd'
      }),
    }
    const mutated = await assembleHistoricalCheckpointReference({
      id, sourceCommit, sourceTest: `${sourceTestPath}:1`, sourceTestPath,
      relevantCurrentSource: productionPath, exactAssertion, exactProperty: exactAssertion,
      metadataReader: mutatedReader,
    })
    if (mutated.proof.disposition !== 'PROVEN_REFERENCE'
      || mutated.proof.compatibilityProof.method !== 'SOURCE_UNCHANGED') throw new Error('expected reference')
    expect(mutated.proof.compatibilityProof.sourceBlobSha)
      .not.toBe(mutated.proof.compatibilityProof.currentBlobSha)
  })

  it('rejects arbitrary historical test path or assertion without exact source content', async () => {
    const metadataReader = {
      readHeadSha: vi.fn().mockResolvedValue('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      readBlobSha: vi.fn().mockResolvedValue('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      readBlobContent: vi.fn().mockResolvedValue("  'CONFLICT', 'different assertion');"),
    }

    await expect(assembleHistoricalCheckpointReference({
      id: 'CHECKPOINT_SCHEMA_MISMATCH',
      sourceCommit: 'cccccccccccccccccccccccccccccccccccccccc',
      sourceTest: 'arbitrary.sql:1',
      sourceTestPath: 'arbitrary.sql',
      relevantCurrentSource: 'source.sql',
      exactAssertion: "  'CONFLICT', 'state_delta_schema_version mismatch → CONFLICT');",
      exactProperty: 'schema mismatch conflict',
      metadataReader,
    })).rejects.toThrow('E2_HISTORICAL_ASSERTION_NOT_FOUND:arbitrary.sql:1')
  })
})
