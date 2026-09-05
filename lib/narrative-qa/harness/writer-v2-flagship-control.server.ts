import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import {
  WRITER_QUALIFICATION_FIXTURE_V2,
  buildWriterQualificationFixtureV2,
  type WriterQualificationFixtureV2RuntimeCapture,
} from '@/fixtures/writer-qualification/v2'
import { buildProductionChapterWriterPrompt } from '@lakoku/ai-gateway'
import type {
  GenerationProvider,
  ModelCallExecutionOptions,
} from '@lakoku/ai-gateway'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'
import type { ProviderCallOutcome } from '@/lib/observability/generation-provider-call.contract'
import { stableStringify } from '@/lib/narrative-qa/scoring/canonical-serializer'

export const WRITER_V2_FLAGSHIP_CONTROL_CONFIG = Object.freeze({
  track: 'WRITER_V2_FLAGSHIP_CONTROL_V1' as const,
  fixtureKey: 'MYSTERY' as const,
  genre: 'MYSTERY' as const,
  chapterNumber: 12,
  authorityMode: 'CHAPTER_BRIEF_V2' as const,
  provisionalCorpusManifestHash: '712d46e7b9a06394b98593ee537fab43c376cea4aebcc951d48b654d51ca6a2a',
  readyAuthorityManifestHash: 'be4216adc5d1b1306aef13186eddcc294fa53d4abd8bba681889c7762bde4b99',
  expectedProjectionHash: '149ccdf1ecf1c3093748e5087ae5be66a55bcdd3032c3e0a11671732856e0a0d',
  provider: 'openrouter' as const,
  requestedModel: 'openai/gpt-5.6-sol' as const,
  configuredModel: 'openai/gpt-5.6-sol' as const,
  expectedResponseModel: 'openai/gpt-5.6-sol-20260709' as const,
  reasoningEffort: 'none' as const,
  maxOutputTokens: 4096,
  temperature: null,
  stream: true as const,
  timeoutMs: 120_000,
  maxRetries: 0 as const,
  fallbackModels: [] as const,
  globalInferenceBudget: 1 as const,
  repairRewriteBudget: 0 as const,
  writerLengthRepairEnabled: false,
  databaseObservationEnabled: false,
  publicationAllowed: false,
  artifactWritingAllowed: false,
})

const EXPECTED_ROUTE = Object.freeze({
  useCase: 'chapter_prose',
  provider: 'openrouter',
  modelId: 'openai/gpt-5.6-sol',
  fallbackModels: [],
  temperature: null,
  maxOutputTokens: 4096,
  reasoningEffort: 'none',
  routeVersion: 'writer-v2-flagship-control-v1',
} satisfies AiModelRoute)

const EXPECTED_RUNTIME = Object.freeze({
  timeoutMs: 120_000,
  streaming: true as const,
  maxRetries: 0 as const,
  maxOutputTokens: 4096,
  temperature: null,
})

const NUMERIC_PARAGRAPH_CONTROLLERS = [
  /\b\d+\s*[–-]\s*\d+\s+paragraf\b/iu,
  /\b(?:maks(?:imal)?|minimal|target)\s+\d+\s+(?:kalimat|paragraf)\b/iu,
  /\b\d+\s+kalimat\s+(?:pendek\s+)?(?:per|tiap)\s+paragraf\b/iu,
  /\b1\s+baris\s+ucapan\s*=\s*1\s+paragraf\b/iu,
]

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createWriterV2FlagshipControlRoute(): AiModelRoute {
  return { ...EXPECTED_ROUTE, fallbackModels: [] }
}

export type WriterV2FlagshipPrepared = Awaited<ReturnType<typeof prepareWriterV2FlagshipControl>>

export async function prepareWriterV2FlagshipControl() {
  let runtimeFixture: WriterQualificationFixtureV2RuntimeCapture | null = null
  const built = await buildWriterQualificationFixtureV2({
    captureRuntimeFixture: (fixture) => {
      if (fixture.key === WRITER_V2_FLAGSHIP_CONTROL_CONFIG.fixtureKey) runtimeFixture = fixture
    },
  })
  if (!runtimeFixture) throw new Error('WRITER_V2_FLAGSHIP_CONTROL_FIXTURE_RUNTIME_MISSING')
  const selected: WriterQualificationFixtureV2RuntimeCapture = runtimeFixture
  const fixture = built.validationInput.fixtures.find(
    (candidate) => candidate.key === WRITER_V2_FLAGSHIP_CONTROL_CONFIG.fixtureKey,
  )
  if (!fixture) throw new Error('WRITER_V2_FLAGSHIP_CONTROL_FIXTURE_MISSING')
  const projection = buildProductionChapterWriterPrompt({
    authorityMode: 'CHAPTER_BRIEF_V2',
    snapshot: selected.snapshot,
    plan: selected.plan,
    continuation: selected.continuation,
    brief: selected.brief,
  })
  const envelope = `${projection.system}\0${projection.prompt}`
  const binding = fixture.projection.authorityBinding

  return {
    snapshot: selected.snapshot,
    plan: selected.plan,
    continuation: selected.continuation,
    brief: selected.brief,
    projection,
    projectionHash: sha256(envelope),
    evidence: Object.freeze({
      fixtureKey: fixture.key,
      chapterNumber: fixture.chapterNumber,
      provisionalCorpusManifestHash: built.manifest.provisionalCorpusManifestHash,
      readyAuthorityManifestHash: built.manifest.readyAuthorityManifestHash,
      qualificationAllowed: built.manifest.qualificationAllowed,
      authorityMode: binding.authorityMode,
      briefBindingExact: binding.briefBindingHash === binding.preProseBriefHash,
      legacyFallbackUsed: binding.legacyFallbackUsed,
      writerVisibleInternalIdCount: binding.writerVisibleInternalIdCount,
      scheduledRevealProjected: fixture.projection.scheduledRevealWriterVisible
        && fixture.projection.scheduledRevealObligationConcrete,
      numericParagraphControllersAbsent: NUMERIC_PARAGRAPH_CONTROLLERS.every(
        (pattern) => !pattern.test(envelope),
      ),
      targetBandPresent: envelope.includes('850–950'),
      hardBandPresent: envelope.includes('800–1000'),
    }),
  }
}

export type WriterV2FlagshipPreflightInput = Readonly<{
  childFlag: string | undefined
  credentialAvailable: boolean
  expectedProjectionHash: string
  route?: AiModelRoute
  runtime?: Readonly<typeof EXPECTED_RUNTIME>
  globalInferenceBudget?: number
  repairRewriteBudget?: number
  providerCalls?: number
  artifactWritten?: boolean
}>

export async function preflightWriterV2FlagshipControl(input: WriterV2FlagshipPreflightInput) {
  if (input.childFlag !== '1') throw new Error('WRITER_V2_FLAGSHIP_CONTROL_CHILD_PROCESS_REQUIRED')
  if (!input.credentialAvailable) throw new Error('WRITER_V2_FLAGSHIP_CONTROL_CREDENTIAL_MISSING')
  const prepared = await prepareWriterV2FlagshipControl()
  const evidence = prepared.evidence
  if (evidence.fixtureKey !== 'MYSTERY' || evidence.chapterNumber !== 12
    || evidence.provisionalCorpusManifestHash !== WRITER_V2_FLAGSHIP_CONTROL_CONFIG.provisionalCorpusManifestHash
    || evidence.readyAuthorityManifestHash !== WRITER_V2_FLAGSHIP_CONTROL_CONFIG.readyAuthorityManifestHash
    || evidence.provisionalCorpusManifestHash !== WRITER_QUALIFICATION_FIXTURE_V2.provisionalCorpusManifestHash
    || evidence.readyAuthorityManifestHash !== WRITER_QUALIFICATION_FIXTURE_V2.readyAuthorityManifestHash
    || evidence.qualificationAllowed !== true) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_FIXTURE_AUTHORITY_MISMATCH')
  }
  if (evidence.authorityMode !== 'CHAPTER_BRIEF_V2' || !evidence.briefBindingExact
    || evidence.legacyFallbackUsed !== false) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_BRIEF_BINDING_MISMATCH')
  }
  if (evidence.writerVisibleInternalIdCount !== 0 || !evidence.scheduledRevealProjected) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_PROJECTION_AUTHORITY_MISMATCH')
  }
  if (!evidence.numericParagraphControllersAbsent || !evidence.targetBandPresent
    || !evidence.hardBandPresent) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_LENGTH_AUTHORITY_MISMATCH')
  }
  if (prepared.projectionHash !== input.expectedProjectionHash) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_PROJECTION_HASH_MISMATCH')
  }
  if (stableStringify(input.route ?? createWriterV2FlagshipControlRoute())
    !== stableStringify(EXPECTED_ROUTE)) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_ROUTE_MISMATCH')
  }
  if (stableStringify(input.runtime ?? EXPECTED_RUNTIME) !== stableStringify(EXPECTED_RUNTIME)) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_RUNTIME_MISMATCH')
  }
  if ((input.globalInferenceBudget ?? 1) !== 1 || (input.repairRewriteBudget ?? 0) !== 0) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_INFERENCE_BUDGET_MISMATCH')
  }
  if ((input.providerCalls ?? 0) !== 0 || (input.artifactWritten ?? false) !== false) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_PREFLIGHT_SIDE_EFFECT_MISMATCH')
  }
  return {
    ok: true as const,
    credentialAvailable: true as const,
    providerCalls: 0 as const,
    artifactWritten: false as const,
    projectionHash: prepared.projectionHash,
    evidence,
  }
}

export type WriterV2ControlClassification =
  | 'CONTROL_PASS'
  | 'CONTROL_LENGTH_MISS'
  | 'CONTROL_AUTHORITY_MISS'
  | 'CONTROL_PIPELINE_FAIL'

export type WriterV2ControlObservation = Readonly<{
  providerTransportOutcome: ProviderCallOutcome | 'NOT_COMPLETED'
  requestedModel: 'openai/gpt-5.6-sol'
  configuredModel: 'openai/gpt-5.6-sol'
  responseModel: string | null
  finishReason: string | null
  parserOutcome: 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED'
  requiredSections: boolean | null
  terminalClosure: boolean | null
  wordCount: number | null
  paragraphCount: number | null
  wordsPerParagraph: number | null
  writerCompletenessOutcome: 'PASSED' | 'FAILED' | 'NOT_REACHED'
  completenessCodes: readonly string[]
  scheduledReveal: Readonly<{
    obligationCount: number
    validationOutcome: 'PASSED' | 'FAILED' | 'NOT_REACHED'
  }>
  layerADeterministicResult: Readonly<{
    outcome: 'PASSED' | 'FAILED' | 'NOT_REACHED'
    codes: readonly string[]
  }>
  leakInternalIdResult: Readonly<{
    outcome: 'PASSED' | 'FAILED' | 'NOT_REACHED'
    writerVisibleInternalIdCount: number | null
  }>
  reasoningTokens: number | null
  completionTokens: number | null
  visibleContentChars: number | null
  latencyMs: number
  writerInferenceCount: number
}>

export function classifyWriterV2FlagshipControl(
  observation: WriterV2ControlObservation,
): WriterV2ControlClassification {
  const canonical = observation.responseModel === WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedResponseModel
  const shapeHealthy = (observation.providerTransportOutcome === 'SUCCEEDED'
      || observation.providerTransportOutcome === 'INVALID_RESPONSE')
    && canonical
    && observation.finishReason === 'stop'
    && observation.parserOutcome === 'ACCEPTED'
    && observation.requiredSections === true
    && observation.terminalClosure === true
    && observation.wordCount !== null
    && observation.writerInferenceCount === 1
  if (!shapeHealthy) return 'CONTROL_PIPELINE_FAIL'

  const lengthPass = observation.wordCount !== null
    && observation.wordCount >= 800 && observation.wordCount <= 1000
  const authorityPass = observation.scheduledReveal.validationOutcome === 'PASSED'
    && observation.layerADeterministicResult.outcome === 'PASSED'
    && observation.leakInternalIdResult.outcome === 'PASSED'
    && observation.leakInternalIdResult.writerVisibleInternalIdCount === 0
  if (lengthPass && authorityPass && observation.writerCompletenessOutcome === 'PASSED'
    && observation.completenessCodes.length === 0) return 'CONTROL_PASS'
  const lengthOnly = observation.writerCompletenessOutcome === 'FAILED'
    && observation.completenessCodes.length === 1
    && observation.completenessCodes[0] === 'WRITER_LENGTH_OUT_OF_RANGE'
  if (!lengthPass && authorityPass && lengthOnly) return 'CONTROL_LENGTH_MISS'
  if (lengthPass && !authorityPass && observation.writerCompletenessOutcome === 'PASSED'
    && observation.completenessCodes.length === 0) return 'CONTROL_AUTHORITY_MISS'
  return 'CONTROL_PIPELINE_FAIL'
}

export type WriterV2FlagshipControlReport = Readonly<{
  track: 'WRITER_V2_FLAGSHIP_CONTROL_V1'
  fixture: Readonly<{ key: 'MYSTERY'; genre: 'MYSTERY'; chapterNumber: 12 }>
  authority: Readonly<{
    mode: 'CHAPTER_BRIEF_V2'
    provisionalCorpusManifestHash: string
    readyAuthorityManifestHash: string
    projectionHash: string
  }>
  route: Readonly<{
    provider: 'openrouter'
    requestedModel: 'openai/gpt-5.6-sol'
    configuredModel: 'openai/gpt-5.6-sol'
    expectedResponseModel: 'openai/gpt-5.6-sol-20260709'
    reasoningEffort: 'none'
    maxOutputTokens: 4096
    temperature: null
    stream: true
    timeoutMs: 120000
    maxRetries: 0
    fallbackCount: 0
  }>
  observation: WriterV2ControlObservation
  classification: WriterV2ControlClassification
  providerCalls: number
  databaseCalls: 0
  publicationCalls: 0
  artifactWritten: false
}>

const FORBIDDEN_REPORT_KEYS = new Set([
  'system', 'prompt', 'title', 'prose', 'paragraph', 'paragraphs', 'rawresponse',
  'reasoning', 'reasoningtext', 'canon', 'snapshot', 'plan', 'continuation', 'brief',
])

export function assertWriterV2FlagshipControlSerialization(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) return current.forEach(visit)
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (FORBIDDEN_REPORT_KEYS.has(normalized)) {
        throw new Error(`WRITER_V2_FLAGSHIP_CONTROL_FORBIDDEN_REPORT_KEY:${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

function isControlAuthorityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WRITER_V2_FLAGSHIP_CONTROL_')
}

export async function executeWriterV2FlagshipControl(
  input: WriterV2FlagshipPreflightInput & Readonly<{ provider: GenerationProvider }>,
): Promise<WriterV2FlagshipControlReport> {
  const preflight = await preflightWriterV2FlagshipControl(input)
  const prepared = await prepareWriterV2FlagshipControl()
  const callBudget = { used: 0, max: 1 }
  const writerInferenceBudget = { used: 0, max: 1 as const }
  let runtimeCount = 0
  let modelCallCount = 0
  let deterministicCount = 0
  const mutable = {
    providerTransportOutcome: 'NOT_COMPLETED' as ProviderCallOutcome | 'NOT_COMPLETED',
    responseModel: null as string | null,
    finishReason: null as string | null,
    parserOutcome: 'NOT_REACHED' as 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED',
    requiredSections: null as boolean | null,
    terminalClosure: null as boolean | null,
    wordCount: null as number | null,
    paragraphCount: null as number | null,
    writerCompletenessOutcome: 'NOT_REACHED' as 'PASSED' | 'FAILED' | 'NOT_REACHED',
    completenessCodes: [] as string[],
    scheduledRevealObligationCount: 0,
    scheduledRevealValidationOutcome: 'NOT_REACHED' as 'PASSED' | 'FAILED' | 'NOT_REACHED',
    layerAOutcome: 'NOT_REACHED' as 'PASSED' | 'FAILED' | 'NOT_REACHED',
    layerACodes: [] as string[],
    leakOutcome: 'NOT_REACHED' as 'PASSED' | 'FAILED' | 'NOT_REACHED',
    writerVisibleInternalIdCount: null as number | null,
    reasoningTokens: null as number | null,
    completionTokens: null as number | null,
    visibleContentChars: null as number | null,
    latencyMs: 0,
  }
  let executionError: unknown

  const options: ModelCallExecutionOptions = {
    telemetryContext: {
      userId: '00000000-0000-4000-8000-000000000001',
      storyId: prepared.snapshot.storyId,
      chapterNumber: 12,
      generationKind: 'standard',
      jobId: null,
      correlationId: randomUUID(),
      attemptNumber: null,
    },
    workflowPhase: 'CHAPTER_PROSE_FIRST_PASS',
    callBudget,
    writerInferenceBudget,
    diagnosticChapterWriterPromptOverride: {
      invocation: 'WRITER_V2_FLAGSHIP_CONTROL_V1',
      system: prepared.projection.system,
      prompt: prepared.projection.prompt,
    },
    observeWriterRuntime: (runtime) => {
      runtimeCount += 1
      if (runtimeCount > 1 || stableStringify(runtime) !== stableStringify(EXPECTED_RUNTIME)) {
        throw new Error('WRITER_V2_FLAGSHIP_CONTROL_RUNTIME_MISMATCH')
      }
    },
    observeModelCall: (completion) => {
      modelCallCount += 1
      if (modelCallCount > 1 || completion.actualProviderId !== 'openrouter'
        || completion.actualModelId !== WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedResponseModel
        || completion.actualModelResolved !== true) {
        throw new Error('WRITER_V2_FLAGSHIP_CONTROL_MODEL_IDENTITY_MISMATCH')
      }
      mutable.providerTransportOutcome = completion.outcome
      mutable.responseModel = completion.actualModelId
      mutable.finishReason = completion.finishReason ?? null
      mutable.completionTokens = completion.outputTokenCount
      mutable.latencyMs = completion.elapsedMs
    },
    observeReasoningBudget: (budget) => {
      mutable.reasoningTokens = budget.reasoningTokenCount
      mutable.completionTokens = budget.completionTokenCount
      mutable.visibleContentChars = budget.visibleContentChars
      mutable.finishReason = budget.finishReason ?? null
    },
    observeWriterParserOutcome: (outcome) => { mutable.parserOutcome = outcome },
    observeWriterEvaluation: (evaluation) => {
      mutable.writerCompletenessOutcome = evaluation.completenessPassed ? 'PASSED' : 'FAILED'
      mutable.completenessCodes = [...evaluation.completenessCodes]
      mutable.wordCount = evaluation.wordCount
      mutable.paragraphCount = evaluation.paragraphCount ?? null
      mutable.requiredSections = evaluation.requiredSectionsPresent
      mutable.terminalClosure = evaluation.terminalClosurePresent
    },
    observeWriterDeterministicEvaluation: (evaluation) => {
      deterministicCount += 1
      if (deterministicCount > 1) {
        throw new Error('WRITER_V2_FLAGSHIP_CONTROL_DETERMINISTIC_OBSERVER_MISMATCH')
      }
      mutable.layerAOutcome = evaluation.layerAPassed ? 'PASSED' : 'FAILED'
      mutable.layerACodes = [...evaluation.layerACodes]
      mutable.leakOutcome = evaluation.leakPassed
        && evaluation.writerVisibleInternalIdCount === 0 ? 'PASSED' : 'FAILED'
      mutable.writerVisibleInternalIdCount = evaluation.writerVisibleInternalIdCount
      mutable.scheduledRevealObligationCount = evaluation.scheduledRevealObligationCount
      mutable.scheduledRevealValidationOutcome = evaluation.scheduledRevealValidationPassed
        ? 'PASSED' : 'FAILED'
    },
  }

  try {
    await input.provider.writeChapter({
      snapshot: prepared.snapshot,
      plan: prepared.plan,
      continuation: prepared.continuation,
      brief: prepared.brief,
    }, options)
  } catch (error) {
    executionError = error
  }
  if (isControlAuthorityError(executionError)) throw executionError

  const writerInferenceCount = Math.max(
    callBudget.used,
    writerInferenceBudget.used,
    runtimeCount,
    modelCallCount,
  )
  if (writerInferenceCount > 1 || callBudget.used > 1 || writerInferenceBudget.used > 1) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_INFERENCE_ACCOUNTING_MISMATCH')
  }
  const wordsPerParagraph = mutable.wordCount !== null && mutable.paragraphCount !== null
    && mutable.paragraphCount > 0
    ? Math.round((mutable.wordCount / mutable.paragraphCount) * 10) / 10
    : null
  const observation: WriterV2ControlObservation = {
    providerTransportOutcome: mutable.providerTransportOutcome,
    requestedModel: 'openai/gpt-5.6-sol',
    configuredModel: 'openai/gpt-5.6-sol',
    responseModel: mutable.responseModel,
    finishReason: mutable.finishReason,
    parserOutcome: mutable.parserOutcome,
    requiredSections: mutable.requiredSections,
    terminalClosure: mutable.terminalClosure,
    wordCount: mutable.wordCount,
    paragraphCount: mutable.paragraphCount,
    wordsPerParagraph,
    writerCompletenessOutcome: mutable.writerCompletenessOutcome,
    completenessCodes: mutable.completenessCodes,
    scheduledReveal: {
      obligationCount: mutable.scheduledRevealObligationCount,
      validationOutcome: mutable.scheduledRevealValidationOutcome,
    },
    layerADeterministicResult: {
      outcome: mutable.layerAOutcome,
      codes: mutable.layerACodes,
    },
    leakInternalIdResult: {
      outcome: mutable.leakOutcome,
      writerVisibleInternalIdCount: mutable.writerVisibleInternalIdCount,
    },
    reasoningTokens: mutable.reasoningTokens,
    completionTokens: mutable.completionTokens,
    visibleContentChars: mutable.visibleContentChars,
    latencyMs: mutable.latencyMs,
    writerInferenceCount,
  }
  const report: WriterV2FlagshipControlReport = {
    track: 'WRITER_V2_FLAGSHIP_CONTROL_V1',
    fixture: { key: 'MYSTERY', genre: 'MYSTERY', chapterNumber: 12 },
    authority: {
      mode: 'CHAPTER_BRIEF_V2',
      provisionalCorpusManifestHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.provisionalCorpusManifestHash,
      readyAuthorityManifestHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.readyAuthorityManifestHash,
      projectionHash: preflight.projectionHash,
    },
    route: {
      provider: 'openrouter',
      requestedModel: 'openai/gpt-5.6-sol',
      configuredModel: 'openai/gpt-5.6-sol',
      expectedResponseModel: 'openai/gpt-5.6-sol-20260709',
      reasoningEffort: 'none',
      maxOutputTokens: 4096,
      temperature: null,
      stream: true,
      timeoutMs: 120_000,
      maxRetries: 0,
      fallbackCount: 0,
    },
    observation,
    classification: classifyWriterV2FlagshipControl(observation),
    providerCalls: callBudget.used,
    databaseCalls: 0,
    publicationCalls: 0,
    artifactWritten: false,
  }
  assertWriterV2FlagshipControlSerialization(report)
  return report
}
