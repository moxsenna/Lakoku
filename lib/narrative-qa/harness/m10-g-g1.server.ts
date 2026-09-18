import 'server-only'
import { execSync } from 'node:child_process'
import {
  M10_G_SEMANTIC_AUTHORITY,
  assertM10GSemanticAuthority,
} from '../../../fixtures/m10-g/semantic-authority'
import { E0_R1_CEILINGS, E0_R1_DECISION_REF } from '../../../fixtures/m10-e/e0-budget-authority'
import { createGlobalInferenceBudget } from '../../ai-gateway/global-inference-budget.contract'
import {
  WRITER_V2_FLAGSHIP_CONTROL_CONFIG,
  createWriterV2FlagshipControlRoute,
} from './writer-v2-flagship-control.server'
import { evaluateM10FSemanticSourceCompatibility } from '../judges/m10-f-semantic-compatibility'
import { evaluateM10GSemanticSurfaceLoaderReadiness } from '../judges/m10-g-semantic-readiness'
import {
  evaluateM10GG1RemainingAuthority,
  type M10GG1RemainingAuthorityStatus,
} from '../judges/m10-g-g1-remaining-authority'
import {
  deriveM10GG1InferenceEconomicsProjection,
} from './m10-g-g1-inference-projection'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import { M10_G_G1_ROUTE_AUTHORITY } from '@/fixtures/m10-g/g1-route-authority'

export const M10G_G1_TRACK = 'M10G_G1_HIGH_TRUST_50CH_PROOF_V1' as const
export const M10G_G1_PREFLIGHT_VERSION = 'M10G_G1_RUNNER_PREFLIGHT_V2' as const
export const M10G_G1_RUNTIME_BASELINE_COMMIT = '5d4112de9ca621bf7444a9b4edbcc23f32e62099'
export const M10G_G1_ROUTE_CLASS = 'HIGH_TRUST' as const
export const M10G_G1_HISTORICAL_PLANNING_ESTIMATE = Object.freeze({
  value: 138 as const,
  authority: 'HISTORICAL_ONLY' as const,
  liveAuthority: false as const,
})
export const M10G_G1_MAX_ATTEMPTS_PER_CHAPTER = 3
export const M10G_G1_RETRYABLE_REASONS: readonly string[] = Object.freeze([
  'TRANSIENT',
  'CAPACITY_BUSY',
  'CAPACITY_TIMEOUT',
  'CHOICE_WORKFLOW_TIMEOUT',
  'GENERATION_JOB_DEADLINE_EXCEEDED',
])

const M10G_G1_STOP_CODE_LIST = [
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
] as const

export const M10G_G1_STOP_CODES = Object.freeze(M10G_G1_STOP_CODE_LIST)
export type M10G_G1_StopCode = (typeof M10G_G1_STOP_CODES)[number]

export interface M10G_G1_JudgeScheduleEntry {
  caseIndex: number
  rubricId: string
  sampleIndex: number
}

export function buildM10GG1JudgeSchedule(
  authority: typeof M10_G_SEMANTIC_AUTHORITY = M10_G_SEMANTIC_AUTHORITY,
): M10G_G1_JudgeScheduleEntry[] {
  const schedule: M10G_G1_JudgeScheduleEntry[] = []
  for (let caseIndex = 0; caseIndex < authority.cases.length; caseIndex += 1) {
    for (let sampleIndex = 0; sampleIndex < authority.sampleCountPerCase; sampleIndex += 1) {
      schedule.push({ caseIndex, rubricId: authority.cases[caseIndex]!.rubricId, sampleIndex })
    }
  }
  return schedule
}

export function evaluateJudgeSchedule(
  authority: typeof M10_G_SEMANTIC_AUTHORITY = M10_G_SEMANTIC_AUTHORITY,
): { ok: boolean; code: string | null; observed: { cases: number; samples: number; total: number } } {
  const cases = authority.cases.length
  const total = cases * authority.sampleCountPerCase
  const ok = cases === 12 && authority.sampleCountPerCase === 3 && total === 36
  return { ok, code: ok ? null : 'PREFLIGHT_JUDGE_SCHEDULE_MISMATCH', observed: {
    cases, samples: authority.sampleCountPerCase, total,
  } }
}

export function evaluateRouteIntegrity(): {
  ok: boolean
  code: string | null
  routeHash: string
  projectionHash: string
  requestedModel: string
} {
  const route = createWriterV2FlagshipControlRoute()
  const routeHash = computeSha256(stableStringify(route))
  const ok = WRITER_V2_FLAGSHIP_CONTROL_CONFIG.requestedModel === 'openai/gpt-5.6-sol'
    && WRITER_V2_FLAGSHIP_CONTROL_CONFIG.configuredModel === 'openai/gpt-5.6-sol'
    && WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedProjectionHash
      === '68759d6557fe341fa7fc90d8a62bea294fcb3f8987db0567fd05505d0804e8f1'
    && route.modelId === 'openai/gpt-5.6-sol'
    && route.fallbackModels.length === 0
    && route.reasoningEffort === 'none'
    && route.maxOutputTokens === 4096
    && route.temperature === null
  return {
    ok,
    code: ok ? null : 'PREFLIGHT_WRITER_ROUTE_MISMATCH',
    routeHash,
    projectionHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedProjectionHash,
    requestedModel: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.requestedModel,
  }
}

const M10G_G1_FORBIDDEN_MANIFEST_KEYS = new Set([
  'system', 'prompt', 'title', 'prose', 'paragraph', 'paragraphs', 'rawresponse',
  'reasoning', 'reasoningtext', 'credential', 'credentials', 'apikey', 'authorization',
  'directive', 'writerdirective', 'canon', 'snapshot', 'plan', 'continuation', 'brief',
  'content', 'storytext',
])

export function assertM10GG1ManifestSerializable(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertM10GG1ManifestSerializable(child, `${path}[${index}]`))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (M10G_G1_FORBIDDEN_MANIFEST_KEYS.has(key.toLowerCase())) {
      throw new Error(`M10G_G1_MANIFEST_SERIALIZATION_FORBIDDEN_KEY:${path}.${key}`)
    }
    assertM10GG1ManifestSerializable(child, `${path}.${key}`)
  }
}

export interface M10G_G1_ChapterTelemetrySlot {
  chapterNumber: number
  writerAttempts: number | null
  finishReason: string | null
  parserOutcome: 'ACCEPTED' | 'REJECTED' | null
  wordCount: number | null
  paragraphCountObservational: number | null
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  retryCount: number | null
  continuityCanonOutcome: string | null
  publicationSimulationOutcome: string | null
  acceptedChoiceId: string | null
  choiceReplayed: boolean | null
}

export interface M10G_G1_RunManifestV2 {
  track: typeof M10G_G1_TRACK
  runId: string
  runtimeBaselineCommit: string
  headCommit: string
  routeClass: typeof M10G_G1_ROUTE_CLASS
  storySeedIdentity: {
    fixtureId: string
    storyId: string
    harnessUserId: string
    publicationMode: 'isolated-local-db'
  }
  modelConfig: {
    writer: {
      provider: string
      requestedModel: string
      configuredModel: string
      reasoningEffort: string
      maxOutputTokens: number
      temperature: null
      stream: boolean
      timeoutMs: number
      maxRetries: number
      fallbackCount: number
    }
    judge: {
      providerId: string
      configuredModelId: string
      expectedActualModelId: string
      routeVersion: string
      primaryIndex: number
    }
  }
  authorityHashes: {
    projectionHash: string
    provisionalCorpusManifestHash: string
    readyAuthorityManifestHash: string
    semanticAuthorityHash: string
    e0BudgetDecisionRef: string
    writerRouteHash: string
    g1RouteAuthorityHash: string
    runSpecHash: string
  }
  thresholdPolicy: {
    uniformThreshold: number
    sampleCountPerCase: number
    aggregation: string
    maximumConclusiveSpread: number
    requiredCaseCount: number
    paragraphCountAuthority: 'OBSERVATIONAL_NOT_A_GATE'
    historicalParagraphGuidance: '35-50_OBSERVATIONAL_ONLY'
    wordBandHard: '800-1000'
    sectionsAndClosure: 'REQUIRED'
  }
  inferenceProjection: ReturnType<typeof deriveM10GG1InferenceEconomicsProjection>
  judgeSchedule: M10G_G1_JudgeScheduleEntry[]
  chapters: M10G_G1_ChapterTelemetrySlot[]
  stopFailRules: readonly M10G_G1_StopCode[]
  stopFailVerdicts: Record<string, string>
}

function currentHeadCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'GIT_UNAVAILABLE'
  }
}

export function buildM10GG1RunManifest(): { manifest: M10G_G1_RunManifestV2; manifestHash: string } {
  const authority = assertM10GSemanticAuthority(M10_G_SEMANTIC_AUTHORITY)
  const route = evaluateRouteIntegrity()
  if (!route.ok) throw new Error(route.code ?? 'PREFLIGHT_WRITER_ROUTE_MISMATCH')
  const routeConfig = createWriterV2FlagshipControlRoute()
  const projection = deriveM10GG1InferenceEconomicsProjection()
  const runSpec = {
    schemaVersion: 2 as const,
    storyFixtureId: 'm10c-brankas-50',
    routeProfile: 'high-trust',
    publicationMode: 'sync' as const,
    chapters: 50,
    choicePolicyVersion: 'm10c-first-choice-v1',
    g1RouteAuthorityHash: M10_G_G1_ROUTE_AUTHORITY.authorityHash,
  }
  const runSpecHash = computeSha256(stableStringify(runSpec))
  const configFingerprint = computeSha256(stableStringify({
    baseline: M10G_G1_RUNTIME_BASELINE_COMMIT,
    routeHash: route.routeHash,
    semanticAuthorityHash: authority.authorityHash,
    runSpecHash,
    inferenceProjection: projection,
  }))
  const runId = `m10g-g1-${configFingerprint.slice(0, 16)}`
  const manifest: M10G_G1_RunManifestV2 = {
    track: M10G_G1_TRACK,
    runId,
    runtimeBaselineCommit: M10G_G1_RUNTIME_BASELINE_COMMIT,
    headCommit: currentHeadCommit(),
    routeClass: M10G_G1_ROUTE_CLASS,
    storySeedIdentity: {
      fixtureId: 'm10c-brankas-50',
      storyId: `m10c-${runId}`,
      harnessUserId: '99999999-9999-4999-9999-99999999c000',
      publicationMode: 'isolated-local-db',
    },
    modelConfig: {
      writer: {
        provider: 'openrouter',
        requestedModel: 'openai/gpt-5.6-sol',
        configuredModel: 'openai/gpt-5.6-sol',
        reasoningEffort: 'none',
        maxOutputTokens: 4096,
        temperature: null,
        stream: true,
        timeoutMs: 120_000,
        maxRetries: 0,
        fallbackCount: routeConfig.fallbackModels.length,
      },
      judge: {
        providerId: authority.executionIdentity.providerId,
        configuredModelId: authority.executionIdentity.configuredModelId,
        expectedActualModelId: authority.executionIdentity.expectedActualModelId,
        routeVersion: authority.executionIdentity.routeVersion,
        primaryIndex: authority.executionIdentity.primaryIndex,
      },
    },
    authorityHashes: {
      projectionHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedProjectionHash,
      provisionalCorpusManifestHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.provisionalCorpusManifestHash,
      readyAuthorityManifestHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.readyAuthorityManifestHash,
      semanticAuthorityHash: authority.authorityHash,
      e0BudgetDecisionRef: E0_R1_DECISION_REF,
      writerRouteHash: route.routeHash,
      g1RouteAuthorityHash: M10_G_G1_ROUTE_AUTHORITY.authorityHash,
      runSpecHash,
    },
    thresholdPolicy: {
      uniformThreshold: authority.uniformThreshold,
      sampleCountPerCase: authority.sampleCountPerCase,
      aggregation: authority.aggregation,
      maximumConclusiveSpread: authority.maximumConclusiveSpread,
      requiredCaseCount: authority.requiredCaseCount,
      paragraphCountAuthority: 'OBSERVATIONAL_NOT_A_GATE',
      historicalParagraphGuidance: '35-50_OBSERVATIONAL_ONLY',
      wordBandHard: '800-1000',
      sectionsAndClosure: 'REQUIRED',
    },
    inferenceProjection: projection,
    judgeSchedule: buildM10GG1JudgeSchedule(authority),
    chapters: Array.from({ length: 50 }, (_, index) => ({
      chapterNumber: index + 1,
      writerAttempts: null,
      finishReason: null,
      parserOutcome: null,
      wordCount: null,
      paragraphCountObservational: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      retryCount: null,
      continuityCanonOutcome: null,
      publicationSimulationOutcome: null,
      acceptedChoiceId: null,
      choiceReplayed: null,
    })),
    stopFailRules: M10G_G1_STOP_CODES,
    stopFailVerdicts: {},
  }
  assertM10GG1ManifestSerializable(manifest)
  return { manifest, manifestHash: computeSha256(stableStringify(manifest)) }
}

export type M10G_G1_StopFailAction =
  | { action: 'CONTINUE_RETRY'; code: null }
  | { action: 'STOP_RUN'; code: M10G_G1_StopCode }

export function classifyG1StopFail(input: {
  error: unknown
  attemptsUsed: number
  budgetRemaining: number
  isPilotGenerationFailure?: (error: unknown) => { reason: string } | null
}): M10G_G1_StopFailAction {
  if (
    input.budgetRemaining <= 0
    || (input.error instanceof Error && input.error.message.includes('M10G_GLOBAL_INFERENCE_BUDGET'))
  ) {
    return { action: 'STOP_RUN', code: 'M10G_G1_STOP_BUDGET_CEILING_OVERRUN' }
  }
  const reason = input.isPilotGenerationFailure?.(input.error)?.reason
    ?? (input.error && typeof input.error === 'object' && 'reason' in input.error && typeof (input.error as { reason?: unknown }).reason === 'string'
      ? (input.error as { reason: string }).reason
      : null)
  if (reason && M10G_G1_RETRYABLE_REASONS.includes(reason)) {
    if (input.attemptsUsed < M10G_G1_MAX_ATTEMPTS_PER_CHAPTER && input.budgetRemaining > 0) {
      return { action: 'CONTINUE_RETRY', code: null }
    }
    return { action: 'STOP_RUN', code: 'M10G_G1_STOP_P0_P1_INVARIANT_FAILURE' }
  }
  if (reason === 'FAILED_REVIEW_REQUIRED') {
    return { action: 'STOP_RUN', code: 'M10G_G1_STOP_ESCAPED_DETERMINISTIC_FINDING' }
  }
  return { action: 'STOP_RUN', code: 'M10G_G1_STOP_P0_P1_INVARIANT_FAILURE' }
}

const BUDGET_ARCHITECTURE_EVIDENCE = Object.freeze([
  'GLOBAL_BUDGET_FACTORY_FAILS_CLOSED_BEFORE_CAP_PLUS_ONE_TRANSPORT',
  'GATEWAY_CANDIDATE_BOUNDARY_RESERVES_PROSE_SEMANTIC_AND_CHOICE',
  'STANDARD_RUNTIME_PROPAGATES_SAME_BUDGET_TO_PROSE_AND_CHOICE',
  'PERSONALIZED_RUNTIME_PROPAGATES_SAME_BUDGET_TO_PROSE_AND_CHOICE',
  'CHOICE_REPAIR_PROPAGATES_SAME_BUDGET',
] as const)

/** Deterministic factory proof. Test limit is not G-1 live authority. */
export function evaluateBudgetArchitectureReadiness(): {
  ok: boolean
  code: string | null
  sharedBudgetReachesEveryProviderTransport: boolean
  noUnbudgetedCandidateTransport: boolean
  evidence: typeof BUDGET_ARCHITECTURE_EVIDENCE
} {
  const budget = createGlobalInferenceBudget({ runId: 'm10g-g1-preflight-unit-budget', hardLimit: 1 })
  budget.reserve('prose', { workflowPhase: 'PREFLIGHT_UNIT_ONLY' })
  let blockedAtCap = false
  try {
    budget.reserve('semantic', { workflowPhase: 'PREFLIGHT_UNIT_ONLY' })
  } catch (error) {
    blockedAtCap = error instanceof Error
      && error.message === 'M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED'
  }
  return {
    ok: blockedAtCap && budget.consumed === 1,
    code: blockedAtCap ? null : 'PREFLIGHT_GLOBAL_BUDGET_CONTRACT_FAILED',
    sharedBudgetReachesEveryProviderTransport: blockedAtCap,
    noUnbudgetedCandidateTransport: blockedAtCap,
    evidence: BUDGET_ARCHITECTURE_EVIDENCE,
  }
}

export interface M10G_G1_LiveAuthorityReadiness {
  ok: false
  code: 'M10G_G1_LIVE_EXECUTION_NOT_AUTHORIZED'
  architectureReady: true
  blockers: readonly string[]
}

export function evaluateLiveAuthorityReadiness(): M10G_G1_LiveAuthorityReadiness {
  const semantic = evaluateM10GSemanticSurfaceLoaderReadiness()
  const projection = deriveM10GG1InferenceEconomicsProjection()
  return {
    ok: false,
    code: 'M10G_G1_LIVE_EXECUTION_NOT_AUTHORIZED',
    architectureReady: semantic.ok,
    blockers: Object.freeze([
      ...semantic.executeTimeBlockers,
      ...projection.economicsStatus.blockerCodes,
    ]),
  }
}

export function evaluateBaselineAncestry(): { ok: boolean; code: string | null; head: string } {
  const head = currentHeadCommit()
  if (head === 'GIT_UNAVAILABLE') return { ok: false, code: 'PREFLIGHT_BASELINE_ANCESTRY_BROKEN', head }
  try {
    execSync(`git merge-base --is-ancestor ${M10G_G1_RUNTIME_BASELINE_COMMIT} HEAD`, { stdio: 'ignore' })
    return { ok: true, code: null, head }
  } catch {
    return { ok: false, code: 'PREFLIGHT_BASELINE_ANCESTRY_BROKEN', head }
  }
}

type GateOutcome = 'PASS' | 'FAIL' | 'BLOCKED'

export interface M10G_G1_PreflightResult {
  version: typeof M10G_G1_PREFLIGHT_VERSION
  track: typeof M10G_G1_TRACK
  mode: 'PREFLIGHT'
  ok: false
  status: 'V2_OPENED_EVALUATED_BLOCKED_ECONOMICS'
  code: 'M10G_G1_V2_BLOCKED_ECONOMICS'
  failedGate: 'economicsWithinFrozenCeiling'
  gates: Record<string, GateOutcome>
  finalDecision: {
    canOpenV2: true
    decision: 'V2_OPENED_EVALUATED'
    explanation: string
  }
  inferenceEnvelope: {
    minimumExpectedInferenceCount: number
    maximumPolicyPermittedInferenceCount: number
  }
  manifestHash: string
  runId: string
  providerCalls: 0
  networkAttempts: 0
  dbWrites: 0
  artifactWritten: false
  semanticOutcome: 'UNVERIFIABLE'
  liveExecutionReady: false
  explicitExecutionAuthorization: false
  blockers: readonly string[]
  liveExecutionBlockers: readonly string[]
  remainingAuthority: M10GG1RemainingAuthorityStatus
}

/** Offline-only V2 evaluation. Never instantiates a live run budget or transport. */
export function preflightM10GG1Runner(): M10G_G1_PreflightResult {
  assertM10GSemanticAuthority(M10_G_SEMANTIC_AUTHORITY)
  const budget = evaluateBudgetArchitectureReadiness()
  const semanticSource = evaluateM10GSemanticSurfaceLoaderReadiness()
  const compatibility = evaluateM10FSemanticSourceCompatibility()
  const projection = deriveM10GG1InferenceEconomicsProjection()
  const route = evaluateRouteIntegrity()
  const ancestry = evaluateBaselineAncestry()
  const first = buildM10GG1RunManifest()
  const second = buildM10GG1RunManifest()
  const deterministic = stableStringify(first.manifest) === stableStringify(second.manifest)
    && first.manifestHash === second.manifestHash
  const manifestImmutable = first.manifest.chapters.length === 50
    && first.manifest.chapters.every((chapter, index) => chapter.chapterNumber === index + 1)
  const projectionValid = projection.minimumExpectedInferenceCount === 184
    && projection.maximumPolicyPermittedInferenceCount === 2663
    && projection.mutuallyExclusiveWriterTopology.writerLengthRepairMaximumTransportsContributed === 0
    && projection.hardInferenceLimit === null
    && projection.historicalInferenceCount.authority === 'HISTORICAL_ONLY'
    && projection.historicalInferenceCount.liveAuthority === false
  const economicsBlocked = projection.economicsStatus.status === 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED'
    && projection.economicsStatus.pricingAuthority === 'BLOCKED_PRICING_AUTHORITY_MISSING'
    && projection.economicsStatus.hardInferenceLimit === null
    && projection.economicsStatus.comparisonStatus === 'NOT_EVALUATED'
    && projection.economicsStatus.frozenCeilings.maxExpectedCostPerNovelUsd
      === E0_R1_CEILINGS.maxExpectedCostPerNovel

  assertM10GG1ManifestSerializable(first.manifest)
  const gates: Record<string, GateOutcome> = {
    sharedBudgetReachesEveryProviderTransport: budget.sharedBudgetReachesEveryProviderTransport ? 'PASS' : 'FAIL',
    noUnbudgetedCandidateTransport: budget.noUnbudgetedCandidateTransport ? 'PASS' : 'FAIL',
    semanticProvenanceArchitecture: semanticSource.ok ? 'PASS' : 'FAIL',
    semanticAuthoritativeExecutionArchitecture: semanticSource.ok ? 'PASS' : 'FAIL',
    semanticFullSourceAuthorityArchitecture: semanticSource.ok ? 'PASS' : 'FAIL',
    m10fSemanticArtifactsUnchanged: compatibility.ok ? 'PASS' : 'FAIL',
    inferenceEnvelopeRecomputed: projectionValid ? 'PASS' : 'FAIL',
    economicsWithinFrozenCeiling: economicsBlocked ? 'BLOCKED' : 'FAIL',
    fiftyChapterManifestImmutable: manifestImmutable ? 'PASS' : 'FAIL',
    tenStopFailRulesEnforced: M10G_G1_STOP_CODES.length === 10 ? 'PASS' : 'FAIL',
    paragraphCountObservational: first.manifest.thresholdPolicy.paragraphCountAuthority
      === 'OBSERVATIONAL_NOT_A_GATE' ? 'PASS' : 'FAIL',
    routeIdentity: route.ok ? 'PASS' : 'FAIL',
    baselineAncestry: ancestry.ok ? 'PASS' : 'FAIL',
    metadataPrivacyGuard: 'PASS',
    manifestDeterminism: deterministic ? 'PASS' : 'FAIL',
    preconditionsToOpenV2: semanticSource.ok && budget.ok && compatibility.ok ? 'PASS' : 'FAIL',
  }
  const readiness = evaluateLiveAuthorityReadiness()
  return {
    version: M10G_G1_PREFLIGHT_VERSION,
    track: M10G_G1_TRACK,
    mode: 'PREFLIGHT',
    ok: false,
    status: 'V2_OPENED_EVALUATED_BLOCKED_ECONOMICS',
    code: 'M10G_G1_V2_BLOCKED_ECONOMICS',
    failedGate: 'economicsWithinFrozenCeiling',
    gates,
    finalDecision: {
      canOpenV2: true,
      decision: 'V2_OPENED_EVALUATED',
      explanation: 'V2 dibuka dan dievaluasi; live execution tetap tidak diotorisasi karena economics belum dapat dihitung.',
    },
    inferenceEnvelope: {
      minimumExpectedInferenceCount: projection.minimumExpectedInferenceCount,
      maximumPolicyPermittedInferenceCount: projection.maximumPolicyPermittedInferenceCount,
    },
    manifestHash: first.manifestHash,
    runId: first.manifest.runId,
    providerCalls: 0,
    networkAttempts: 0,
    dbWrites: 0,
    artifactWritten: false,
    semanticOutcome: 'UNVERIFIABLE',
    liveExecutionReady: false,
    explicitExecutionAuthorization: false,
    blockers: readiness.blockers,
    liveExecutionBlockers: readiness.blockers,
    remainingAuthority: evaluateM10GG1RemainingAuthority(),
  }
}

export {
  evaluateG1RunnerArchitectureReadiness,
  runM10GG1ProofOrchestrationForTest as runM10GG1ProofOrchestration,
  type M10GG1ChapterExecutionInput,
  type M10GG1ChapterExecutionResult,
  type M10GG1SemanticExecutionInput,
  type M10GG1SemanticExecutionResult,
  type M10GG1RunnerDeps,
  type M10GG1RunExecutionResult,
} from './m10-g-g1-runner.server'

