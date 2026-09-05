import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import {
  HISTORICAL_WRITER_AUTHORITY_VERSION,
  renderHistoricalWriterPrompt,
} from './historical-writer-prompt'
import { createDeterministicProvider, type GenerationProvider } from '@/lib/ai-gateway/provider'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'
import { stableStringify } from '@/lib/narrative-qa/scoring/canonical-serializer'
import { buildWriterLengthRepairDiagnosticFixture } from './writer-length-repair-diagnostic-fixture'

import type { ProviderCallOutcome } from '@/lib/observability/generation-provider-call.contract'

export const GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY = Object.freeze({
  source: 'OpenRouter GET /api/v1/models + /api/v1/models/z-ai/glm-5.3-flash/endpoints',
  observedOn: '2026-09-03',
  requestedModel: 'z-ai/glm-5.3-flash',
  modelId: 'z-ai/glm-5.3-flash',
  canonicalSlug: 'z-ai/glm-5.3-flash-20260826',
  reasoningSupported: true,
  reasoningMandatory: true,
  reasoningDefaultEnabled: true,
  reasoningDefaultEffort: 'max',
  supportedReasoningEfforts: ['max', 'high', 'low'] as const,
  catalogContextLength: 1_310_720,
  topProviderMaxCompletionTokens: 131_072,
  endpointsActive: true,
  minimumEndpointMaxCompletionTokens: 2048,
})

export const GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG = Object.freeze({
  track: 'GLM53_FLASH_WRITER_DIAGNOSTIC_V1' as const,
  fixtureClassification: 'SYNTHETIC' as const,
  genre: 'MYSTERY' as const,
  chapterNumber: 12,
  provider: 'openrouter' as const,
  requestedModel: GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY.requestedModel,
  modelId: GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY.modelId,
  canonicalSlug: GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY.canonicalSlug,
  reasoningSupported: true,
  reasoningMandatory: true,
  reasoningDefaultEnabled: true,
  reasoningDefaultEffort: 'max' as const,
  supportedReasoningEfforts: ['max', 'high', 'low'] as const,
  reasoningEffort: 'low' as const,
  catalogContextLength: 1_310_720,
  topProviderMaxCompletionTokens: 131_072,
  endpointsActive: true,
  minimumEndpointMaxCompletionTokens: 2048,
  capabilityRoutingMustPreserveRequestCap: true,
  promptTarget: '850–950',
  hardAcceptance: '800–1000',
  fallbackModels: [] as const,
  maxOutputTokens: 4096,
  timeoutMs: 120_000,
  streaming: true as const,
  maxRetries: 0,
  temperature: null,
  maxProviderCalls: 1,
  maxWriterInferences: 1,
  persistObservation: false,
  writerLengthRepairEnabled: false,
  databaseAllowed: false,
  publicationAllowed: false,
  contentRetentionAllowed: false,
})

const EXPECTED_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'
const EXPECTED_ROUTE = Object.freeze({
  useCase: 'chapter_prose',
  provider: 'openrouter',
  modelId: 'z-ai/glm-5.3-flash',
  fallbackModels: [],
  temperature: null,
  maxOutputTokens: 4096,
  reasoningEffort: 'low',
  routeVersion: 'glm53-flash-writer-diagnostic-v1',
} satisfies AiModelRoute)
const EXPECTED_RUNTIME = Object.freeze({
  timeoutMs: 120_000,
  streaming: true as const,
  maxRetries: 0,
  maxOutputTokens: 4096,
  temperature: null,
})

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createGlm53FlashWriterDiagnosticRoute(): AiModelRoute {
  return { ...EXPECTED_ROUTE, fallbackModels: [] }
}

export async function prepareGlm53FlashWriterDiagnostic() {
  const context = buildWriterLengthRepairDiagnosticFixture(12)
  const plan = await createDeterministicProvider({
    targetWordsMin: 850,
    targetWordsMax: 950,
    targetScenes: 3,
  }).generatePlan({
    snapshot: context.snapshot,
    blueprint: context.blueprint,
    chapterNumber: 12,
    continuation: context.continuation,
    brief: context.brief,
  }) as Record<string, unknown>
  const production = renderHistoricalWriterPrompt({
    snapshot: context.snapshot,
    plan,
    continuation: context.continuation,
  })
  return {
    authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
    fixture: Object.freeze({
      fixtureClassification: 'SYNTHETIC' as const,
      genre: 'MYSTERY' as const,
      chapterNumber: 12,
      promptSha256: sha256(production.prompt),
    }),
    system: production.system,
    prompt: production.prompt,
    snapshot: context.snapshot,
    plan,
    continuation: context.continuation,
    brief: context.brief,
  }
}

type DiagnosticRuntime = Readonly<{
  timeoutMs: number
  streaming: true
  maxRetries: number
  maxOutputTokens: number
  temperature: number | null
}>

type PreflightInput = Readonly<{
  productionRepairFlag: string | undefined
  diagnosticChildFlag: string | undefined
  credentialAvailable: boolean
  expectedPromptSha256?: string
  metadataAuthority?: unknown
  route?: AiModelRoute
  runtime?: DiagnosticRuntime
}>

export async function preflightGlm53FlashWriterDiagnostic(input: PreflightInput) {
  if (!input.credentialAvailable) throw new Error('GLM53_DIAGNOSTIC_CREDENTIAL_MISSING')
  if (input.diagnosticChildFlag !== '1') {
    throw new Error('GLM53_DIAGNOSTIC_CHILD_PROCESS_REQUIRED')
  }
  if (input.productionRepairFlag !== undefined) {
    throw new Error('GLM53_DIAGNOSTIC_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  }
  const prepared = await prepareGlm53FlashWriterDiagnostic()
  const expectedPromptSha256 = input.expectedPromptSha256 ?? EXPECTED_PROMPT_SHA256
  if (prepared.fixture.promptSha256 !== expectedPromptSha256) {
    throw new Error('GLM53_DIAGNOSTIC_PROMPT_HASH_MISMATCH')
  }
  if (stableStringify(input.metadataAuthority ?? GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY)
    !== stableStringify(GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY)) {
    throw new Error('GLM53_DIAGNOSTIC_METADATA_AUTHORITY_MISMATCH')
  }
  if (stableStringify(input.route ?? createGlm53FlashWriterDiagnosticRoute())
    !== stableStringify(EXPECTED_ROUTE)) {
    throw new Error('GLM53_DIAGNOSTIC_ROUTE_MISMATCH')
  }
  if (stableStringify(input.runtime ?? EXPECTED_RUNTIME) !== stableStringify(EXPECTED_RUNTIME)) {
    throw new Error('GLM53_DIAGNOSTIC_RUNTIME_MISMATCH')
  }
  return {
    ok: true as const,
    providerCalls: 0 as const,
    promptSha256: prepared.fixture.promptSha256,
  }
}

export type Glm53FlashWriterDiagnosticObservation = Readonly<{
  transportOutcome: ProviderCallOutcome | 'NOT_COMPLETED'
  parserOutcome: 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED'
  completenessPassed: boolean | null
  completenessCodes: readonly string[]
  wordCount: number | null
  paragraphCount: number | null
  requiredSectionsPresent: boolean | null
  terminalClosurePresent: boolean | null
  finishReason: string | null
  reasoningTokenCount: number | null
  completionTokenCount: number | null
  latencyMs: number
}>

export type Glm53FlashWriterDiagnosticClassification =
  | 'PASS_ADVANCE_TO_5_FIXTURE'
  | 'NEAR_MISS_5_FIXTURE_ALLOWED'
  | 'STOP_MODEL_WRITER_TRACK'
  | 'STOP_CLASSIFY_LAYER'

export function classifyGlm53FlashWriterDiagnostic(
  observation: Glm53FlashWriterDiagnosticObservation,
): Glm53FlashWriterDiagnosticClassification {
  const completedEvaluation = observation.transportOutcome === 'SUCCEEDED'
    && observation.parserOutcome === 'ACCEPTED'
    && observation.wordCount !== null
    && observation.requiredSectionsPresent === true
    && observation.terminalClosurePresent === true
    && observation.finishReason === 'stop'
  if (!completedEvaluation) return 'STOP_CLASSIFY_LAYER'

  const lengthOnly = observation.completenessCodes.length === 1
    && observation.completenessCodes[0] === 'WRITER_LENGTH_OUT_OF_RANGE'
  const noFindings = observation.completenessCodes.length === 0
  if (observation.wordCount >= 800 && observation.wordCount <= 1000) {
    return observation.completenessPassed === true && noFindings
      ? 'PASS_ADVANCE_TO_5_FIXTURE'
      : 'STOP_CLASSIFY_LAYER'
  }
  if (
    ((observation.wordCount >= 750 && observation.wordCount <= 799)
      || (observation.wordCount >= 1001 && observation.wordCount <= 1050))
    && observation.completenessPassed === false
    && lengthOnly
  ) return 'NEAR_MISS_5_FIXTURE_ALLOWED'
  if (observation.completenessPassed === false && lengthOnly) {
    return 'STOP_MODEL_WRITER_TRACK'
  }
  return 'STOP_CLASSIFY_LAYER'
}

export type Glm53FlashWriterDiagnosticReport = Readonly<{
  track: 'GLM53_FLASH_WRITER_DIAGNOSTIC_V1'
  fixture: Readonly<{
    fixtureClassification: 'SYNTHETIC'
    genre: 'MYSTERY'
    chapterNumber: 12
  }>
  modelPolicy: Readonly<{
    provider: 'openrouter'
    requestedModel: 'z-ai/glm-5.3-flash'
    modelId: 'z-ai/glm-5.3-flash'
    canonicalSlug: 'z-ai/glm-5.3-flash-20260826'
    reasoningSupported: true
    reasoningMandatory: true
    reasoningDefaultEnabled: true
    reasoningDefaultEffort: 'max'
    supportedReasoningEfforts: readonly ['max', 'high', 'low']
    reasoningEffort: 'low'
    catalogContextLength: 1_310_720
    topProviderMaxCompletionTokens: 131_072
    endpointsActive: true
    minimumEndpointMaxCompletionTokens: 2048
    capabilityRoutingMustPreserveRequestCap: true
    maxOutputTokens: 4096
    fallbackCount: 0
  }>
  promptSha256: string
  runtime: DiagnosticRuntime
  observation: Glm53FlashWriterDiagnosticObservation
  inferenceCount: 1
  databaseCalls: 0
  publicationCalls: 0
  classification: Glm53FlashWriterDiagnosticClassification
}>

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  'prompt',
  'system',
  'title',
  'prose',
  'paragraph',
  'paragraphs',
  'rawresponse',
  'reasoning',
  'reasoningtext',
  'canon',
])

export function assertGlm53FlashWriterDiagnosticSerialization(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (FORBIDDEN_ARTIFACT_KEYS.has(normalized)) {
        throw new Error(`GLM53_DIAGNOSTIC_FORBIDDEN_ARTIFACT_KEY:${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

function authorityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('GLM53_DIAGNOSTIC_')
}

export async function executeGlm53FlashWriterDiagnostic(
  input: PreflightInput & Readonly<{ provider: GenerationProvider }>,
): Promise<Glm53FlashWriterDiagnosticReport> {
  const preflight = await preflightGlm53FlashWriterDiagnostic(input)
  const prepared = await prepareGlm53FlashWriterDiagnostic()
  const callBudget = { used: 0, max: 1 }
  const writerInferenceBudget = { used: 0, max: 1 as const }
  let runtimeCount = 0
  let modelCallCount = 0
  const mutable: {
    transportOutcome: ProviderCallOutcome | 'NOT_COMPLETED'
    parserOutcome: 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED'
    completenessPassed: boolean | null
    completenessCodes: string[]
    wordCount: number | null
    paragraphCount: number | null
    requiredSectionsPresent: boolean | null
    terminalClosurePresent: boolean | null
    finishReason: string | null
    reasoningTokenCount: number | null
    completionTokenCount: number | null
    latencyMs: number
  } = {
    transportOutcome: 'NOT_COMPLETED',
    parserOutcome: 'NOT_REACHED',
    completenessPassed: null,
    completenessCodes: [],
    wordCount: null,
    paragraphCount: null,
    requiredSectionsPresent: null,
    terminalClosurePresent: null,
    finishReason: null,
    reasoningTokenCount: null,
    completionTokenCount: null,
    latencyMs: 0,
  }
  let executionError: unknown

  try {
    await input.provider.writeChapter({
      snapshot: prepared.snapshot,
      plan: prepared.plan,
      continuation: prepared.continuation,
      brief: prepared.brief,
    }, {
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
        invocation: GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG.track,
        system: prepared.system,
        prompt: prepared.prompt,
      },
      observeWriterRuntime: (runtime) => {
        runtimeCount += 1
        if (runtimeCount > 1 || stableStringify(runtime) !== stableStringify(EXPECTED_RUNTIME)) {
          throw new Error('GLM53_DIAGNOSTIC_RUNTIME_MISMATCH')
        }
      },
      observeModelCall: (completion) => {
        modelCallCount += 1
        const allowedModelIds: readonly string[] = [
          GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG.modelId,
          GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG.canonicalSlug,
        ]
        if (modelCallCount > 1
          || completion.actualProviderId !== 'openrouter'
          || !allowedModelIds.includes(completion.actualModelId)) {
          throw new Error('GLM53_DIAGNOSTIC_MODEL_IDENTITY_MISMATCH')
        }
        mutable.transportOutcome = completion.outcome
        mutable.finishReason = completion.finishReason ?? null
        mutable.completionTokenCount = completion.outputTokenCount
        mutable.latencyMs = completion.elapsedMs
      },
      observeReasoningBudget: (budget) => {
        mutable.reasoningTokenCount = budget.reasoningTokenCount
        mutable.completionTokenCount = budget.completionTokenCount
        mutable.finishReason = budget.finishReason ?? null
      },
      observeWriterParserOutcome: (outcome) => {
        mutable.parserOutcome = outcome
      },
      observeWriterEvaluation: (evaluation) => {
        mutable.completenessPassed = evaluation.completenessPassed
        mutable.completenessCodes = [...evaluation.completenessCodes]
        mutable.wordCount = evaluation.wordCount
        mutable.paragraphCount = evaluation.paragraphCount ?? null
        mutable.requiredSectionsPresent = evaluation.requiredSectionsPresent
        mutable.terminalClosurePresent = evaluation.terminalClosurePresent
      },
    })
  } catch (error) {
    executionError = error
  }

  if (authorityError(executionError)) throw executionError
  const inferenceCount = Math.max(callBudget.used, writerInferenceBudget.used, runtimeCount, modelCallCount)
  if (inferenceCount !== 1 || callBudget.used > 1 || writerInferenceBudget.used > 1) {
    throw new Error('GLM53_DIAGNOSTIC_INFERENCE_ACCOUNTING_MISMATCH')
  }
  const observation: Glm53FlashWriterDiagnosticObservation = Object.freeze({ ...mutable })
  const report: Glm53FlashWriterDiagnosticReport = {
    track: GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG.track,
    fixture: {
      fixtureClassification: 'SYNTHETIC',
      genre: 'MYSTERY',
      chapterNumber: 12,
    },
    modelPolicy: {
      provider: 'openrouter',
      requestedModel: 'z-ai/glm-5.3-flash',
      modelId: 'z-ai/glm-5.3-flash',
      canonicalSlug: 'z-ai/glm-5.3-flash-20260826',
      reasoningSupported: true,
      reasoningMandatory: true,
      reasoningDefaultEnabled: true,
      reasoningDefaultEffort: 'max',
      supportedReasoningEfforts: ['max', 'high', 'low'],
      reasoningEffort: 'low',
      catalogContextLength: 1_310_720,
      topProviderMaxCompletionTokens: 131_072,
      endpointsActive: true,
      minimumEndpointMaxCompletionTokens: 2048,
      capabilityRoutingMustPreserveRequestCap: true,
      maxOutputTokens: 4096,
      fallbackCount: 0,
    },
    promptSha256: preflight.promptSha256,
    runtime: EXPECTED_RUNTIME,
    observation,
    inferenceCount: 1,
    databaseCalls: 0,
    publicationCalls: 0,
    classification: classifyGlm53FlashWriterDiagnostic(observation),
  }
  assertGlm53FlashWriterDiagnosticSerialization(report)
  return report
}
