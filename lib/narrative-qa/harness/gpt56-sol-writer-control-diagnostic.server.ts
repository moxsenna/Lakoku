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

export const GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY = Object.freeze({
  source: 'OpenRouter GET /api/v1/models + /api/v1/models/openai/gpt-5.6-sol/endpoints',
  observedOn: '2026-09-03',
  requestedModel: 'openai/gpt-5.6-sol',
  modelId: 'openai/gpt-5.6-sol',
  canonicalSlug: 'openai/gpt-5.6-sol-20260709',
  reasoningSupported: true,
  reasoningMandatory: false,
  reasoningDefaultEnabled: true,
  reasoningDefaultEffort: 'medium',
  supportedReasoningEfforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] as const,
  catalogContextLength: 1_050_000,
  topProviderMaxCompletionTokens: 128_000,
  endpointsActive: true,
  activeProviders: ['OpenAI', 'Amazon Bedrock', 'Azure'] as const,
  activeEndpointMaxCompletionTokens: Object.freeze({
    OpenAI: 128_000,
    'Amazon Bedrock': 128_000,
    Azure: 128_000,
  }),
})

export const GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG = Object.freeze({
  track: 'GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1' as const,
  experimentType: 'CONTROL' as const,
  qualificationAllowed: false,
  fixtureClassification: 'SYNTHETIC' as const,
  genre: 'MYSTERY' as const,
  chapterNumber: 12,
  provider: 'openrouter' as const,
  requestedModel: GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY.requestedModel,
  modelId: GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY.modelId,
  canonicalSlug: GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY.canonicalSlug,
  reasoningSupported: true,
  reasoningMandatory: false,
  reasoningDefaultEnabled: true,
  reasoningDefaultEffort: 'medium' as const,
  supportedReasoningEfforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] as const,
  reasoningEffort: 'none' as const,
  catalogContextLength: 1_050_000,
  topProviderMaxCompletionTokens: 128_000,
  endpointsActive: true,
  activeProviders: ['OpenAI', 'Amazon Bedrock', 'Azure'] as const,
  activeEndpointMaxCompletionTokens: Object.freeze({
    OpenAI: 128_000,
    'Amazon Bedrock': 128_000,
    Azure: 128_000,
  }),
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
  modelId: 'openai/gpt-5.6-sol',
  fallbackModels: [],
  temperature: null,
  maxOutputTokens: 4096,
  reasoningEffort: 'none',
  routeVersion: 'gpt56-sol-writer-control-diagnostic-v1',
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

export function createGpt56SolWriterControlDiagnosticRoute(): AiModelRoute {
  return { ...EXPECTED_ROUTE, fallbackModels: [] }
}

export async function prepareGpt56SolWriterControlDiagnostic() {
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

export async function preflightGpt56SolWriterControlDiagnostic(input: PreflightInput) {
  if (!input.credentialAvailable) throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_CREDENTIAL_MISSING')
  if (input.diagnosticChildFlag !== '1') {
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_CHILD_PROCESS_REQUIRED')
  }
  if (input.productionRepairFlag !== undefined) {
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  }
  const prepared = await prepareGpt56SolWriterControlDiagnostic()
  const expectedPromptSha256 = input.expectedPromptSha256 ?? EXPECTED_PROMPT_SHA256
  if (prepared.fixture.promptSha256 !== expectedPromptSha256) {
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_PROMPT_HASH_MISMATCH')
  }
  if (stableStringify(input.metadataAuthority ?? GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY)
    !== stableStringify(GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY)) {
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY_MISMATCH')
  }
  if (stableStringify(input.route ?? createGpt56SolWriterControlDiagnosticRoute())
    !== stableStringify(EXPECTED_ROUTE)) {
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_ROUTE_MISMATCH')
  }
  if (stableStringify(input.runtime ?? EXPECTED_RUNTIME) !== stableStringify(EXPECTED_RUNTIME)) {
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_RUNTIME_MISMATCH')
  }
  return {
    ok: true as const,
    providerCalls: 0 as const,
    promptSha256: prepared.fixture.promptSha256,
  }
}

export type Gpt56SolWriterControlDiagnosticObservation = Readonly<{
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

export type Gpt56SolWriterControlDiagnosticClassification =
  | 'PRODUCTION_PROMPT_IS_CAPABLE'
  | 'NEAR_MISS_REVIEW_REQUIRED'
  | 'WRITER_PROMPT_ARCHITECTURE_REVIEW'
  | 'STOP_CLASSIFY_LAYER'

export function classifyGpt56SolWriterControlDiagnostic(
  observation: Gpt56SolWriterControlDiagnosticObservation,
): Gpt56SolWriterControlDiagnosticClassification {
  const lengthOnly = observation.completenessPassed === false
    && observation.completenessCodes.length === 1
    && observation.completenessCodes[0] === 'WRITER_LENGTH_OUT_OF_RANGE'
  const transportAllowsEvaluation = observation.transportOutcome === 'SUCCEEDED'
    || (observation.transportOutcome === 'INVALID_RESPONSE' && lengthOnly)
  const completedEvaluation = transportAllowsEvaluation
    && observation.parserOutcome === 'ACCEPTED'
    && observation.wordCount !== null
    && observation.requiredSectionsPresent === true
    && observation.terminalClosurePresent === true
    && observation.finishReason === 'stop'
  if (!completedEvaluation) return 'STOP_CLASSIFY_LAYER'

  const noFindings = observation.completenessCodes.length === 0
  if (observation.wordCount >= 800 && observation.wordCount <= 1000) {
    return observation.completenessPassed === true && noFindings
      ? 'PRODUCTION_PROMPT_IS_CAPABLE'
      : 'STOP_CLASSIFY_LAYER'
  }
  if (
    ((observation.wordCount >= 750 && observation.wordCount <= 799)
      || (observation.wordCount >= 1001 && observation.wordCount <= 1050))
    && observation.completenessPassed === false
    && lengthOnly
  ) return 'NEAR_MISS_REVIEW_REQUIRED'
  if (observation.completenessPassed === false && lengthOnly) {
    return 'WRITER_PROMPT_ARCHITECTURE_REVIEW'
  }
  return 'STOP_CLASSIFY_LAYER'
}

export type Gpt56SolWriterControlDiagnosticReport = Readonly<{
  track: 'GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1'
  experimentType: 'CONTROL'
  qualificationAllowed: false
  fixture: Readonly<{
    fixtureClassification: 'SYNTHETIC'
    genre: 'MYSTERY'
    chapterNumber: 12
  }>
  modelPolicy: Readonly<{
    provider: 'openrouter'
    requestedModel: 'openai/gpt-5.6-sol'
    modelId: 'openai/gpt-5.6-sol'
    canonicalSlug: 'openai/gpt-5.6-sol-20260709'
    reasoningSupported: true
    reasoningMandatory: false
    reasoningDefaultEnabled: true
    reasoningDefaultEffort: 'medium'
    supportedReasoningEfforts: readonly ['max', 'xhigh', 'high', 'medium', 'low', 'none']
    reasoningEffort: 'none'
    catalogContextLength: 1_050_000
    topProviderMaxCompletionTokens: 128_000
    endpointsActive: true
    activeProviders: readonly ['OpenAI', 'Amazon Bedrock', 'Azure']
    activeEndpointMaxCompletionTokens: Readonly<{
      OpenAI: 128_000
      'Amazon Bedrock': 128_000
      Azure: 128_000
    }>
    capabilityRoutingMustPreserveRequestCap: true
    maxOutputTokens: 4096
    fallbackCount: 0
  }>
  promptSha256: string
  runtime: DiagnosticRuntime
  observation: Gpt56SolWriterControlDiagnosticObservation
  inferenceCount: 1
  databaseCalls: 0
  publicationCalls: 0
  classification: Gpt56SolWriterControlDiagnosticClassification
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

export function assertGpt56SolWriterControlDiagnosticSerialization(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (FORBIDDEN_ARTIFACT_KEYS.has(normalized)) {
        throw new Error(`GPT56_SOL_CONTROL_DIAGNOSTIC_FORBIDDEN_ARTIFACT_KEY:${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

function authorityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('GPT56_SOL_CONTROL_DIAGNOSTIC_')
}

export async function executeGpt56SolWriterControlDiagnostic(
  input: PreflightInput & Readonly<{ provider: GenerationProvider }>,
): Promise<Gpt56SolWriterControlDiagnosticReport> {
  const preflight = await preflightGpt56SolWriterControlDiagnostic(input)
  const prepared = await prepareGpt56SolWriterControlDiagnostic()
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
        invocation: GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG.track,
        system: prepared.system,
        prompt: prepared.prompt,
      },
      observeWriterRuntime: (runtime) => {
        runtimeCount += 1
        if (runtimeCount > 1 || stableStringify(runtime) !== stableStringify(EXPECTED_RUNTIME)) {
          throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_RUNTIME_MISMATCH')
        }
      },
      observeModelCall: (completion) => {
        modelCallCount += 1
        const allowedModelIds: readonly string[] = [
          GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG.modelId,
          GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG.canonicalSlug,
        ]
        if (modelCallCount > 1
          || completion.actualProviderId !== 'openrouter'
          || !allowedModelIds.includes(completion.actualModelId)) {
          throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_MODEL_IDENTITY_MISMATCH')
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
    throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_INFERENCE_ACCOUNTING_MISMATCH')
  }
  const observation: Gpt56SolWriterControlDiagnosticObservation = Object.freeze({ ...mutable })
  const report: Gpt56SolWriterControlDiagnosticReport = {
    track: GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG.track,
    experimentType: 'CONTROL',
    qualificationAllowed: false,
    fixture: {
      fixtureClassification: 'SYNTHETIC',
      genre: 'MYSTERY',
      chapterNumber: 12,
    },
    modelPolicy: {
      provider: 'openrouter',
      requestedModel: 'openai/gpt-5.6-sol',
      modelId: 'openai/gpt-5.6-sol',
      canonicalSlug: 'openai/gpt-5.6-sol-20260709',
      reasoningSupported: true,
      reasoningMandatory: false,
      reasoningDefaultEnabled: true,
      reasoningDefaultEffort: 'medium',
      supportedReasoningEfforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
      reasoningEffort: 'none',
      catalogContextLength: 1_050_000,
      topProviderMaxCompletionTokens: 128_000,
      endpointsActive: true,
      activeProviders: ['OpenAI', 'Amazon Bedrock', 'Azure'],
      activeEndpointMaxCompletionTokens: {
        OpenAI: 128_000,
        'Amazon Bedrock': 128_000,
        Azure: 128_000,
      },
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
    classification: classifyGpt56SolWriterControlDiagnostic(observation),
  }
  assertGpt56SolWriterControlDiagnosticSerialization(report)
  return report
}
