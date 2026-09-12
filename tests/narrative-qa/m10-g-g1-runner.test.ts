import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  M10G_G1_HISTORICAL_PLANNING_ESTIMATE,
  M10G_G1_STOP_CODES,
  M10G_G1_RUNTIME_BASELINE_COMMIT,
  assertM10GG1ManifestSerializable,
  buildM10GG1JudgeSchedule,
  buildM10GG1RunManifest,
  classifyG1StopFail,
  evaluateBudgetArchitectureReadiness,
  evaluateJudgeSchedule,
  evaluateLiveAuthorityReadiness,
  evaluateRouteIntegrity,
  preflightM10GG1Runner,
} from '@/lib/narrative-qa/harness/m10-g-g1.server'
import { evaluateM10GSemanticSurfaceLoaderReadiness } from '@/lib/narrative-qa/judges/m10-g-semantic-readiness'
import { deriveM10GG1InferenceEconomicsProjection } from '@/lib/narrative-qa/harness/m10-g-g1-inference-projection'
import { PilotGenerationFailure } from '../../scripts/m10-f-pilot-support'

const pilotFailure = (reason: string) => new PilotGenerationFailure(reason)

describe('M10-G G-1 runner preflight V2', () => {
  it('builds deterministic metadata-only 50-chapter manifest', () => {
    const first = buildM10GG1RunManifest()
    const second = buildM10GG1RunManifest()

    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest))
    expect(first.manifestHash).toBe(second.manifestHash)
    expect(first.manifestHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.manifest.runtimeBaselineCommit).toBe(M10G_G1_RUNTIME_BASELINE_COMMIT)
    expect(first.manifest.chapters.map((chapter) => chapter.chapterNumber)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
    expect(() => assertM10GG1ManifestSerializable(first.manifest)).not.toThrow()
    expect(() => assertM10GG1ManifestSerializable({ prompt: 'private' })).toThrow(/FORBIDDEN_KEY/)
  })

  it('keeps 138 historical-only and omits any live hard limit', () => {
    const { manifest } = buildM10GG1RunManifest()
    const projection = deriveM10GG1InferenceEconomicsProjection()

    expect(M10G_G1_HISTORICAL_PLANNING_ESTIMATE).toEqual({
      value: 138,
      authority: 'HISTORICAL_ONLY',
      liveAuthority: false,
    })
    expect(manifest.inferenceProjection).toMatchObject({
      minimumExpectedInferenceCount: 184,
      maximumPolicyPermittedInferenceCount: 2663,
      historicalInferenceCount: M10G_G1_HISTORICAL_PLANNING_ESTIMATE,
    })
    expect(manifest).not.toHaveProperty('inferencePolicy.cap')
    expect(JSON.stringify(manifest)).not.toContain('"hardLimit"')
    expect(projection.minimumExpectedInferenceCount).toBe(184)
    expect(projection.maximumPolicyPermittedInferenceCount).toBe(2663)
  })

  it('proves shared budget contract reaches every standard and personalized candidate transport', () => {
    expect(evaluateBudgetArchitectureReadiness()).toEqual({
      ok: true,
      code: null,
      sharedBudgetReachesEveryProviderTransport: true,
      noUnbudgetedCandidateTransport: true,
      evidence: [
        'GLOBAL_BUDGET_FACTORY_FAILS_CLOSED_BEFORE_CAP_PLUS_ONE_TRANSPORT',
        'GATEWAY_CANDIDATE_BOUNDARY_RESERVES_PROSE_SEMANTIC_AND_CHOICE',
        'STANDARD_RUNTIME_PROPAGATES_SAME_BUDGET_TO_PROSE_AND_CHOICE',
        'PERSONALIZED_RUNTIME_PROPAGATES_SAME_BUDGET_TO_PROSE_AND_CHOICE',
        'CHOICE_REPAIR_PROPAGATES_SAME_BUDGET',
      ],
    })
  })

  it('retains route identity and exact 12x3 judge schedule', () => {
    expect(evaluateRouteIntegrity()).toMatchObject({
      ok: true,
      requestedModel: 'openai/gpt-5.6-sol',
      projectionHash: 'b72919dd223317f708397ac055a7eca082cfff7400476618fba8c08d8d78c10e',
    })
    expect(evaluateJudgeSchedule()).toMatchObject({
      ok: true,
      observed: { cases: 12, samples: 3, total: 36 },
    })
    expect(buildM10GG1JudgeSchedule()).toHaveLength(36)
  })

  it('enforces all 10 frozen STOP/FAIL rules', () => {
    expect(M10G_G1_STOP_CODES).toEqual([
      'M10G_G1_STOP_P0_P1_INVARIANT_FAILURE',
      'M10G_G1_STOP_CANONICAL_STATE_CORRUPTION',
      'M10G_G1_STOP_DUPLICATE_PUBLICATION',
      'M10G_G1_STOP_ESCAPED_DETERMINISTIC_FINDING',
      'M10G_G1_STOP_MAIN_MYSTERY_UNRESOLVED',
      'M10G_G1_STOP_ENDING_RUNWAY_BREAKAGE',
      'M10G_G1_STOP_SEMANTIC_HARD_FAIL',
      'M10G_G1_STOP_BUDGET_CEILING_OVERRUN',
      'M10G_G1_STOP_MANUAL_PATCHING',
      'M10G_G1_STOP_POST_HOC_THRESHOLD_TUNING',
    ])
  })

  it('keeps retry classification fail-closed without owning a live cap', () => {
    const classify = (reason: string, attemptsUsed = 1, budgetRemaining = 1) => classifyG1StopFail({
      error: pilotFailure(reason),
      attemptsUsed,
      budgetRemaining,
      isPilotGenerationFailure: (error) => error instanceof PilotGenerationFailure
        ? { reason: error.reason }
        : null,
    })

    expect(classify('TRANSIENT')).toEqual({ action: 'CONTINUE_RETRY', code: null })
    expect(classify('TRANSIENT', 3)).toEqual({
      action: 'STOP_RUN', code: 'M10G_G1_STOP_P0_P1_INVARIANT_FAILURE',
    })
    expect(classify('FAILED_REVIEW_REQUIRED')).toEqual({
      action: 'STOP_RUN', code: 'M10G_G1_STOP_ESCAPED_DETERMINISTIC_FINDING',
    })
    expect(classify('UNKNOWN')).toEqual({
      action: 'STOP_RUN', code: 'M10G_G1_STOP_P0_P1_INVARIANT_FAILURE',
    })
  })

  it('passes semantic architecture while retaining execute-time and economics blockers', () => {
    const readiness = evaluateLiveAuthorityReadiness()
    const semanticBlockers = evaluateM10GSemanticSurfaceLoaderReadiness().executeTimeBlockers
    const economicsBlockers = deriveM10GG1InferenceEconomicsProjection().economicsStatus.blockerCodes

    expect(readiness.ok).toBe(false)
    expect(readiness.architectureReady).toBe(true)
    expect(readiness.code).toBe('M10G_G1_LIVE_EXECUTION_NOT_AUTHORIZED')
    expect(readiness.blockers).toEqual([...semanticBlockers, ...economicsBlockers])
    expect(readiness.blockers).not.toContain('GLOBAL_BUDGET_NOT_PROPAGATED_TO_INTERNAL_PROVIDER_CALLS')
    expect(readiness.blockers).not.toContain('M10G_G1_LIVE_RUNNER_UNAVAILABLE')
  })

  it('reports every required V2 gate and blocks opening and live authorization safely', () => {
    const result = preflightM10GG1Runner()

    expect(result).toMatchObject({
      version: 'M10G_G1_RUNNER_PREFLIGHT_V2',
      ok: false,
      status: 'V2_OPENED_EVALUATED_BLOCKED_ECONOMICS',
      code: 'M10G_G1_V2_BLOCKED_ECONOMICS',
      failedGate: 'economicsWithinFrozenCeiling',
      finalDecision: {
        canOpenV2: true,
        decision: 'V2_OPENED_EVALUATED',
        explanation: 'V2 dibuka dan dievaluasi; live execution tetap tidak diotorisasi karena economics belum dapat dihitung.',
      },
      providerCalls: 0,
      networkAttempts: 0,
      dbWrites: 0,
      artifactWritten: false,
      semanticOutcome: 'UNVERIFIABLE',
      liveExecutionReady: false,
      explicitExecutionAuthorization: false,
      inferenceEnvelope: {
        minimumExpectedInferenceCount: 184,
        maximumPolicyPermittedInferenceCount: 2663,
      },
    })
    expect(result.gates).toEqual({
      sharedBudgetReachesEveryProviderTransport: 'PASS',
      noUnbudgetedCandidateTransport: 'PASS',
      semanticProvenanceArchitecture: 'PASS',
      semanticAuthoritativeExecutionArchitecture: 'PASS',
      semanticFullSourceAuthorityArchitecture: 'PASS',
      m10fSemanticArtifactsUnchanged: 'PASS',
      inferenceEnvelopeRecomputed: 'PASS',
      economicsWithinFrozenCeiling: 'BLOCKED',
      fiftyChapterManifestImmutable: 'PASS',
      tenStopFailRulesEnforced: 'PASS',
      paragraphCountObservational: 'PASS',
      routeIdentity: 'PASS',
      baselineAncestry: 'PASS',
      metadataPrivacyGuard: 'PASS',
      manifestDeterminism: 'PASS',
      preconditionsToOpenV2: 'PASS',
    })
    expect(result.blockers).toEqual([
      'FROZEN_M10G_SOURCE_MANIFEST_NOT_YET_PROVIDED',
      'FROZEN_M10G_SOURCE_CAPTURE_NOT_YET_PROVIDED',
      'M10G_STORY_IDENTITY_NOT_YET_PROVIDED',
      'M10G_GLOBAL_BUDGET_AUTHORITY_NOT_YET_PROVIDED',
      'M10G_EXECUTION_AUTHORIZATION_NOT_YET_PROVIDED',
      // Choice and continuity model routes are frozen. Full 50-chapter
      // execution topology remains unbound until deterministic choice advance
      // and immutable generation policy are carried through the live executor.
      'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
      'BLOCKED_PRICING_AUTHORITY_MISSING',
      'G1_EXECUTE_CHAPTER_TOPOLOGY_UNBOUND',
    ])
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.runId).toMatch(/^m10g-g1-[0-9a-f]{16}$/)
  })
})
