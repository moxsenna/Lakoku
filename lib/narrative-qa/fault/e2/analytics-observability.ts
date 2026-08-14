import { executeObservedModelCall } from '../../../ai-gateway/observed-model-call.server'
import type { ObservedModelCallDeps } from '../../../ai-gateway/observed-model-call.server'
import { withScopedExternalCallGuard } from './external-call-guard'
import type { E2EvidenceRow, E2InvariantResult } from './taxonomy'

export interface AnalyticsProofAdapter {
  execute: typeof executeObservedModelCall
}

function invariant(code: string, expected: unknown, observed: unknown): E2InvariantResult {
  return { code, passed: Object.is(expected, observed), detail: { expected, observed } }
}

export async function proveAnalyticsObservabilityInjected(input: {
  adapter?: AnalyticsProofAdapter
} = {}): Promise<E2EvidenceRow> {
  let syntheticCalls = 0
  let networkAttempts = 0
  let recorderCalls = 0
  let recorderRejectionReached = false
  let primaryResult: string | undefined
  let propagatedError: unknown
  const times = [0, 1]
  const deps: ObservedModelCallDeps = {
    createId: () => 'e2180000-0000-4000-8000-000000000001',
    now: () => new Date('2026-08-13T00:00:00.000Z'),
    monotonicNow: () => times.shift() ?? 1,
    record: async () => {
      recorderCalls += 1
      recorderRejectionReached = true
      throw new Error('INJECTED_RECORDER_REJECTION')
    },
    recorderTimeoutMs: 50,
  }

  try {
    primaryResult = await withScopedExternalCallGuard(
      { recordExternalCall: () => { networkAttempts += 1 } },
      () => (input.adapter?.execute ?? executeObservedModelCall)({
      context: {
        userId: 'e2180000-0000-4000-8000-000000000002',
        storyId: 'm10-e2:analytics-observability',
        chapterNumber: 18,
        generationKind: 'standard',
        jobId: null,
        correlationId: 'e2180000-0000-4000-8000-000000000003',
        attemptNumber: null,
      },
      candidate: {
        providerId: 'synthetic',
        configuredModelId: 'synthetic-observed-call',
        routeVersion: 'm10-e2',
        fallbackIndex: 0,
      },
      useCase: 'm10-e2-proof',
      workflowPhase: 'ANALYTICS_RECORDER_REJECTION',
      call: () => {
        syntheticCalls += 1
        return {
          text: Promise.resolve('PRIMARY_RESULT'),
          usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          finalStep: Promise.resolve({ response: { modelId: 'synthetic-observed-call' }, providerMetadata: {} }),
        } as unknown as ReturnType<Parameters<typeof executeObservedModelCall<string>>[0]['call']>
      },
      consume: (text) => text,
    }, deps),
    )
  } catch (error) {
    propagatedError = error
  }

  return {
    id: 'ANALYTICS_OBSERVABILITY_INJECTED',
    proof: {
      disposition: 'EXECUTED',
      injectionReached: recorderRejectionReached,
      expectedOutcome: 'PRIMARY_RESULT_SURVIVED_OPTIONAL_RECORDER_FAILURE',
      observedOutcome: primaryResult === 'PRIMARY_RESULT' && propagatedError === undefined
        ? 'PRIMARY_RESULT_SURVIVED_OPTIONAL_RECORDER_FAILURE'
        : 'PRIMARY_RESULT_DID_NOT_SURVIVE',
      immediateInvariants: [
        invariant('LOCAL_SYNTHETIC_CALLS', 1, syntheticCalls),
        invariant('NETWORK_ATTEMPTS', 0, networkAttempts),
        invariant('OPTIONAL_RECORDER_REJECTION_REACHED', true, recorderRejectionReached),
        invariant('OPTIONAL_RECORDER_CALLS', 1, recorderCalls),
        invariant('PRIMARY_RESULT_SURVIVED', 'PRIMARY_RESULT', primaryResult),
        invariant('PRIMARY_ERROR_NOT_PROPAGATED', true, propagatedError === undefined),
      ],
      recoveryExpected: false,
      recovered: true,
      recoveryInvariants: null,
    },
  }
}
