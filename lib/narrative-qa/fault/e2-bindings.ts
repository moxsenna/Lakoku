import { buildFixtureSnapshot } from '../../../fixtures/narrative/fixture-50'
import { misteriDramaContract } from '../../../fixtures/contracts/misteri-drama'
import { generateChoiceBranch } from '../../ai-gateway/gateway'
import { createGatewayProvider } from '../../ai-gateway/gateway-provider'
import type { ChoiceInput, ProviderCandidateTransport } from '../../ai-gateway/provider'
import { buildChapterBrief } from '../../story-engine/chapter-brief'
import { normalizeRouteState } from '../../story-engine/route-state'
import {
  isCheckpointUsableForChoiceRetry,
  proseFingerprint,
  verifyCheckpointFreshness,
  type ChapterGenerationCheckpoint,
} from '../../runtime/chapter-generation-checkpoint.pure'
import {
  materializeChapterStateCandidateV1,
  projectEffectivePlotDebtState,
  type StructuredStateProposalV1,
} from '../../narrative'
import { withScopedExternalCallGuard } from './e2/external-call-guard'
import { createWorkingTreeGitReader } from './e2/git-metadata'
import type { M10E2NonDbBindings } from './e2/non-db'
import type { ExternalCallAuthority } from './e2/rows-1-9'
import {
  proveCheckpointDecision,
  proveCheckpointUsability,
  proveMalformedChoicesOutput,
  proveMalformedStateProposalDelta,
  proveProviderFallbackSucceeds,
} from './e2/rows-1-9'

const telemetryContext = {
  userId: '10000000-0000-4000-8000-000000000001', storyId: 'fixture:warisan-terkubur', chapterNumber: 12,
  generationKind: 'standard' as const, jobId: null, correlationId: '20000000-0000-4000-8000-000000000002', attemptNumber: null,
}
function productionChoiceInput(): ChoiceInput {
  const snapshot = buildFixtureSnapshot()
  const contractSnapshot = { ...snapshot, storyId: misteriDramaContract.storyId }
  const routeState = normalizeRouteState({ truth: 4, risk: 2 })
  const chapterBrief = buildChapterBrief({
    storyContract: misteriDramaContract,
    snapshot: contractSnapshot,
    readerState: { routeState, choiceHistory: [], lockedEndingKey: null },
    chapterNumber: 12,
    previousChoice: null,
  })
  return {
    snapshot,
    chapterBrief,
    draft: {
      storyId: snapshot.storyId,
      chapterNumber: 12,
      title: 'Jejak di Balik Pintu',
      paragraphs: [
        'Rani menahan napas di depan pintu tua.',
        'Suara langkah berhenti di lorong gelap.',
        'Surat kusam itu masih tersimpan di tangannya.',
      ],
      wordCount: 23,
      sceneCount: 1,
      hasChoiceOrGate: true,
      events: [], knowledgeAssertions: [], reveals: [], proposedStateDelta: {},
      newNamedCharacters: [], dialogue: [], emotionBeats: [], softClaims: [],
    },
    lastParagraphs: [
      'Rani menahan napas di depan pintu tua.',
      'Suara langkah berhenti di lorong gelap.',
      'Surat kusam itu masih tersimpan di tangannya.',
    ],
    routeState,
    choiceHistory: [],
    lockedEndingKey: chapterBrief.lockedEndingKey,
  }
}
function route(fallback = false) {
  return { useCase: 'chapter_prose' as const, provider: 'gateway' as const, modelId: 'synthetic/primary', fallbackModels: fallback ? [{ provider: 'gateway' as const, modelId: 'synthetic/fallback' }] : [], temperature: 0.6, maxOutputTokens: 4000, routeVersion: 'm10-e2' }
}
function syntheticObservedResult(text: string): unknown {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    finalStep: Promise.resolve({ response: {}, providerMetadata: {} }),
  }
}
async function choice(
  transport: ProviderCandidateTransport,
  fallback: boolean,
  externalCalls: ExternalCallAuthority,
  mutateCandidate?: (candidate: Parameters<ProviderCandidateTransport>[0]) => unknown,
): Promise<unknown> {
  const provider = createGatewayProvider(undefined, undefined, route(), route(fallback))
  const guardedTransport: ProviderCandidateTransport = (candidate) => transport({
    ...candidate,
    execute: () => {
      externalCalls.recordExternalCall('CANDIDATE_EXECUTE')
      if (mutateCandidate) return mutateCandidate(candidate)
      throw new Error('E2_CANDIDATE_EXECUTE_DENIED')
    },
  })
  return withScopedExternalCallGuard(externalCalls, () => generateChoiceBranch(
    { provider },
    productionChoiceInput(),
    {
      telemetryContext,
      workflowPhase: 'CHOICES_INITIAL',
      providerRuntime: { candidateTransport: guardedTransport },
    },
  ))
}
function checkpoint(overrides: Partial<ChapterGenerationCheckpoint> = {}): ChapterGenerationCheckpoint {
  return {
    storyId: 'story-a', chapterNumber: 12, attemptId: 'attempt-a', correlationId: 'correlation-a', status: 'PROSE_READY',
    title: 'Bab 12', paragraphs: ['Paragraf aman.'], proseFingerprint: proseFingerprint('Bab 12', ['Paragraf aman.']),
    auditSignals: null, auditSignalsVersion: null, canonVersion: 5, blueprintVersion: 2, directionFingerprint: 'direction-a',
    generationMode: 'standard', generationPolicyVersion: 2, promptContractVersion: 2, jobId: 'job-a', jobAttemptNumber: 1,
    schemaVersion: 2, proseAttemptCount: 1, choiceAttemptCount: 0, createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z', expiresAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

export interface M10E2BindingFaultProbe {
  scenario: 'MALFORMED_CHOICES_OUTPUT' | 'PROVIDER_FALLBACK_SUCCEEDS'
  attempt: 'FETCH' | 'CANDIDATE_EXECUTE' | 'OLD_EMPTY_ACTIONS'
}

export function createM10E2NonDbBindings(input: {
  faultProbe?: M10E2BindingFaultProbe
} = {}): M10E2NonDbBindings {
  const runChoice = (
    scenario: M10E2BindingFaultProbe['scenario'],
    transport: ProviderCandidateTransport,
    fallback: boolean,
    externalCalls: ExternalCallAuthority,
  ): Promise<unknown> => choice(
    input.faultProbe?.scenario === scenario
      ? input.faultProbe.attempt === 'OLD_EMPTY_ACTIONS'
        ? () => syntheticObservedResult(JSON.stringify({ question: 'Pilihan Rani?', actions: [] }))
        : (candidate) => candidate.execute()
      : transport,
    fallback,
    externalCalls,
    input.faultProbe?.scenario === scenario && input.faultProbe.attempt === 'FETCH'
      ? () => globalThis.fetch('https://network-must-not-run.invalid')
      : undefined,
  )

  return {
    metadataReader: createWorkingTreeGitReader(),
    runRows1To7: async () => {
      const malformed = {
        schemaVersion: 1, storyId: misteriDramaContract.storyId, chapterNumber: 2,
        facts: { add: 'invalid', markPaidOff: [] }, knowledge: { grants: [] }, secrets: { revealIds: [] }, timeline: { append: [] },
        characters: { statusChanges: [] }, threads: { touches: [], transitions: [] }, plotDebts: { progress: [], closures: [] }, actRollup: null,
      }
      return [
        await proveMalformedChoicesOutput({
          runChoice: (transport, externalCalls) => runChoice(
            'MALFORMED_CHOICES_OUTPUT', transport, false, externalCalls,
          ),
        }),
        await proveMalformedStateProposalDelta({ executeMaterializer: () => materializeChapterStateCandidateV1({
          storyId: misteriDramaContract.storyId, chapterNumber: 2,
          snapshot: { ...buildFixtureSnapshot(), storyId: misteriDramaContract.storyId }, storyContract: misteriDramaContract,
          effectivePlotDebtState: projectEffectivePlotDebtState({ plotDebts: misteriDramaContract.plotDebts, progressedMilestones: {}, closedDebtIds: [], chapterNumber: 2 }),
          proposal: malformed as unknown as StructuredStateProposalV1,
        }) }),
        await proveProviderFallbackSucceeds({
          runChoice: (transport, externalCalls) => runChoice(
            'PROVIDER_FALLBACK_SUCCEEDS', transport, true, externalCalls,
          ),
        }),
        proveCheckpointDecision({ id: 'CHECKPOINT_ALTERED_PROVENANCE', expectedReason: 'JOB_ID_MISMATCH', verify: () => {
          const result = verifyCheckpointFreshness(checkpoint(), { canonVersion: 5, blueprintVersion: 2, directionFingerprint: 'direction-a', generationMode: 'standard', generationPolicyVersion: 2, promptContractVersion: 2, requireJobProvenance: true, jobId: 'job-b', jobAttemptNumber: 1 })
          return { accepted: result.fresh, reason: result.fresh ? 'FRESH' : result.reason }
        } }),
        proveCheckpointDecision({ id: 'CHECKPOINT_ATTEMPT_AHEAD', expectedReason: 'ATTEMPT_AHEAD', verify: () => {
          const result = verifyCheckpointFreshness(checkpoint({ jobAttemptNumber: 3 }), { canonVersion: 5, blueprintVersion: 2, directionFingerprint: 'direction-a', generationMode: 'standard', generationPolicyVersion: 2, promptContractVersion: 2, requireJobProvenance: true, jobId: 'job-a', jobAttemptNumber: 2 })
          return { accepted: result.fresh, reason: result.fresh ? 'FRESH' : result.reason }
        } }),
        proveCheckpointUsability({ id: 'CHECKPOINT_EXPIRED', verifyUsable: () => isCheckpointUsableForChoiceRetry(checkpoint(), new Date('2026-08-15T00:00:00.000Z')) }),
      ]
    },
  }
}
