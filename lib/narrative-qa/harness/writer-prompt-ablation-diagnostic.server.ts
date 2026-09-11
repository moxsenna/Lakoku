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

export const WRITER_PROMPT_ABLATION_V1_CONFIG = Object.freeze({
  track: 'WRITER_PROMPT_ABLATION_V1' as const,
  treatment: 'ABLATION_PARAGRAPH_COUNT_REMOVAL' as const,
  experimentType: 'CAUSAL' as const,
  qualificationAllowed: false,
  fixtureClassification: 'SYNTHETIC' as const,
  genre: 'MYSTERY' as const,
  chapterNumber: 12,
  provider: 'openrouter' as const,
  requestedModel: 'openai/gpt-5.6-sol' as const,
  modelId: 'openai/gpt-5.6-sol' as const,
  canonicalSlug: 'openai/gpt-5.6-sol-20260709' as const,
  reasoningEffort: 'none' as const,
  promptTarget: '850–950' as const,
  hardAcceptance: '800–1000' as const,
  fallbackModels: [] as const,
  maxOutputTokens: 4096,
  timeoutMs: 120_000,
  streaming: true as const,
  maxRetries: 0,
  temperature: null,
  maxProviderCalls: 1,
  maxWriterInferences: 1,
  writerLengthRepairEnabled: false,
  databaseAllowed: false,
  publicationAllowed: false,
  contentRetentionAllowed: false,
})

const BASELINE_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'
const TREATMENT_PROMPT_SHA256 = 'f7f60fe1cc4bb88e52cd5ccfb49df9793b8586c127628ca2de4ff7a8ab2d4e32'

const SYSTEM_PROJECTION = Object.freeze([
  Object.freeze({
    baseline: '- Target 38–48 paragraf (wajib dalam 35–50).\n',
    treatment: '',
  }),
  Object.freeze({
    baseline: '- Ending bab: 3–5 paragraf pendek yang makin tajam (cliffhanger), kecuali bab terakhir cerita.',
    treatment: '- Ending bab: paragraf pendek yang makin tajam (cliffhanger), kecuali bab terakhir cerita.',
  }),
  Object.freeze({
    baseline: '- Pembuka hook: 3–5 paragraf',
    treatment: '- Pembuka hook',
  }),
  Object.freeze({
    baseline: '- Konflik awal: 8–10 paragraf',
    treatment: '- Konflik awal',
  }),
  Object.freeze({
    baseline: '- Dialog/konfrontasi utama: 15–20 paragraf',
    treatment: '- Dialog/konfrontasi utama',
  }),
  Object.freeze({
    baseline: '- Reveal kecil / ubah emosi: 6–8 paragraf',
    treatment: '- Reveal kecil / ubah emosi',
  }),
  Object.freeze({
    baseline: '- Penutup cliffhanger: 4–6 paragraf',
    treatment: '- Penutup cliffhanger',
  }),
])

const USER_PROJECTION = Object.freeze([
  Object.freeze({
    baseline: 'Jumlah paragraf 38–48 (wajib 35–50).\n',
    treatment: '',
  }),
  Object.freeze({
    baseline: 'Tutup dengan 3–5 paragraf cliffhanger pendek (kecuali bab akhir cerita).',
    treatment: 'Tutup dengan paragraf cliffhanger pendek (kecuali bab akhir cerita).',
  }),
  Object.freeze({
    baseline: 'Pisahkan SETIAP paragraf dengan satu baris kosong (target 38–48 paragraf).',
    treatment: 'Pisahkan SETIAP paragraf dengan satu baris kosong.',
  }),
])

const EXPECTED_ROUTE = Object.freeze({
  useCase: 'chapter_prose',
  provider: 'openrouter',
  modelId: 'openai/gpt-5.6-sol',
  fallbackModels: [],
  temperature: null,
  maxOutputTokens: 4096,
  reasoningEffort: 'none',
  routeVersion: 'writer-prompt-ablation-v1-paragraph-count-removal',
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

function replaceExactlyOnce(value: string, from: string, to: string, errorCode: string): string {
  if (value.split(from).length - 1 !== 1) throw new Error(errorCode)
  return value.replace(from, to)
}

function project(value: string, replacements: typeof SYSTEM_PROJECTION | typeof USER_PROJECTION): string {
  return replacements.reduce(
    (current, replacement) => replaceExactlyOnce(
      current,
      replacement.baseline,
      replacement.treatment,
      'WRITER_PROMPT_ABLATION_V1_PROJECTION_SOURCE_MISMATCH',
    ),
    value,
  )
}

function restoreNonEmpty(
  value: string,
  replacements: typeof SYSTEM_PROJECTION | typeof USER_PROJECTION,
): string {
  return [...replacements].reverse().filter((replacement) => replacement.treatment).reduce(
    (current, replacement) => replaceExactlyOnce(
      current,
      replacement.treatment,
      replacement.baseline,
      'WRITER_PROMPT_ABLATION_V1_RESTORATION_SOURCE_MISMATCH',
    ),
    value,
  )
}

export function restoreWriterPromptParagraphControls(input: Readonly<{
  system: string
  prompt: string
}>): Readonly<{ system: string; prompt: string }> {
  const system = restoreNonEmpty(input.system, SYSTEM_PROJECTION)
  const prompt = restoreNonEmpty(input.prompt, USER_PROJECTION)
  return {
    system: replaceExactlyOnce(
      system,
      '- Target 850–950 kata (wajib dalam 800–1000).\n- Mayoritas paragraf',
      '- Target 850–950 kata (wajib dalam 800–1000).\n- Target 38–48 paragraf (wajib dalam 35–50).\n- Mayoritas paragraf',
      'WRITER_PROMPT_ABLATION_V1_RESTORATION_SOURCE_MISMATCH',
    ),
    prompt: replaceExactlyOnce(
      prompt,
      'JANGAN meringkas atau mempercepat alur — jika terasa kurang dari 850 kata, tambahkan adegan atau perpanjang dialog, bukan filler.\nBuka dengan alur langsung',
      'JANGAN meringkas atau mempercepat alur — jika terasa kurang dari 850 kata, tambahkan adegan atau perpanjang dialog, bukan filler.\nJumlah paragraf 38–48 (wajib 35–50).\nBuka dengan alur langsung',
      'WRITER_PROMPT_ABLATION_V1_RESTORATION_SOURCE_MISMATCH',
    ),
  }
}

export function createWriterPromptAblationRoute(): AiModelRoute {
  return { ...EXPECTED_ROUTE, fallbackModels: [] }
}

export async function prepareWriterPromptAblation() {
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
  const treatment = {
    system: project(production.system, SYSTEM_PROJECTION),
    prompt: project(production.prompt, USER_PROJECTION),
  }
  const restored = restoreWriterPromptParagraphControls(treatment)
  const wordAuthority = [
    'Target 850–950 kata (wajib dalam 800–1000).',
    'PANJANG WAJIB minimal 850 kata (target 850–950; jangan lewat 1000).',
  ]

  return {
    authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
    baseline: {
      system: production.system,
      prompt: production.prompt,
      promptSha256: sha256(production.prompt),
    },
    treatment: {
      ...treatment,
      promptSha256: sha256(treatment.prompt),
    },
    fixtureEvidence: {
      fixtureEquivalent: true as const,
      canonEquivalent: true as const,
      storyEquivalent: true as const,
      beatsEquivalent: true as const,
      wordAuthorityEquivalent: wordAuthority.every(
        (text) => `${production.system}\n${production.prompt}`.includes(text)
          && `${treatment.system}\n${treatment.prompt}`.includes(text),
      ),
      restorationExact: restored.system === production.system && restored.prompt === production.prompt,
    },
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
  expectedBaselinePromptSha256?: string
  expectedTreatmentPromptSha256?: string
  route?: AiModelRoute
  runtime?: DiagnosticRuntime
}>

export async function preflightWriterPromptAblation(input: PreflightInput) {
  if (!input.credentialAvailable) throw new Error('WRITER_PROMPT_ABLATION_V1_CREDENTIAL_MISSING')
  if (input.diagnosticChildFlag !== '1') {
    throw new Error('WRITER_PROMPT_ABLATION_V1_CHILD_PROCESS_REQUIRED')
  }
  if (input.productionRepairFlag !== undefined) {
    throw new Error('WRITER_PROMPT_ABLATION_V1_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  }
  const prepared = await prepareWriterPromptAblation()
  if (prepared.baseline.promptSha256
    !== (input.expectedBaselinePromptSha256 ?? BASELINE_PROMPT_SHA256)) {
    throw new Error('WRITER_PROMPT_ABLATION_V1_BASELINE_PROMPT_HASH_MISMATCH')
  }
  if (prepared.treatment.promptSha256
    !== (input.expectedTreatmentPromptSha256 ?? TREATMENT_PROMPT_SHA256)) {
    throw new Error('WRITER_PROMPT_ABLATION_V1_TREATMENT_PROMPT_HASH_MISMATCH')
  }
  if (!Object.values(prepared.fixtureEvidence).every(Boolean)) {
    throw new Error('WRITER_PROMPT_ABLATION_V1_PROJECTION_EVIDENCE_MISMATCH')
  }
  if (stableStringify(input.route ?? createWriterPromptAblationRoute())
    !== stableStringify(EXPECTED_ROUTE)) {
    throw new Error('WRITER_PROMPT_ABLATION_V1_ROUTE_MISMATCH')
  }
  if (stableStringify(input.runtime ?? EXPECTED_RUNTIME) !== stableStringify(EXPECTED_RUNTIME)) {
    throw new Error('WRITER_PROMPT_ABLATION_V1_RUNTIME_MISMATCH')
  }
  return {
    ok: true as const,
    providerCalls: 0 as const,
    baselinePromptSha256: prepared.baseline.promptSha256,
    treatmentPromptSha256: prepared.treatment.promptSha256,
  }
}

export type WriterPromptAblationObservation = Readonly<{
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

export type WriterPromptAblationClassification =
  | 'STRONG_SUPPORT_H1'
  | 'PARTIAL_SUPPORT_H1'
  | 'H1_WEAKENED_OR_REJECTED'
  | 'STOP_CLASSIFY_LAYER'

export function classifyWriterPromptAblation(
  observation: WriterPromptAblationObservation,
): WriterPromptAblationClassification {
  const lengthOnly = observation.completenessPassed === false
    && observation.completenessCodes.length === 1
    && observation.completenessCodes[0] === 'WRITER_LENGTH_OUT_OF_RANGE'
  const transportAllowsEvaluation = observation.transportOutcome === 'SUCCEEDED'
    || (observation.transportOutcome === 'INVALID_RESPONSE' && lengthOnly)
  const healthyShape = transportAllowsEvaluation
    && observation.parserOutcome === 'ACCEPTED'
    && observation.wordCount !== null
    && observation.requiredSectionsPresent === true
    && observation.terminalClosurePresent === true
    && observation.finishReason === 'stop'
  if (!healthyShape || observation.wordCount === null) return 'STOP_CLASSIFY_LAYER'

  if (observation.wordCount >= 800 && observation.wordCount <= 1000) {
    return observation.completenessPassed === true && observation.completenessCodes.length === 0
      ? 'STRONG_SUPPORT_H1'
      : 'STOP_CLASSIFY_LAYER'
  }
  if (observation.wordCount >= 750 && observation.wordCount <= 799 && lengthOnly) {
    return 'PARTIAL_SUPPORT_H1'
  }
  if (observation.wordCount < 750 && lengthOnly) return 'H1_WEAKENED_OR_REJECTED'
  return 'STOP_CLASSIFY_LAYER'
}

export type WriterPromptAblationReport = Readonly<{
  track: 'WRITER_PROMPT_ABLATION_V1'
  treatment: 'ABLATION_PARAGRAPH_COUNT_REMOVAL'
  experimentType: 'CAUSAL'
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
    reasoningEffort: 'none'
    maxOutputTokens: 4096
    fallbackCount: 0
  }>
  baselinePromptSha256: string
  treatmentPromptSha256: string
  projectionEvidence: Readonly<{
    fixtureEquivalent: true
    canonEquivalent: true
    storyEquivalent: true
    beatsEquivalent: true
    wordAuthorityEquivalent: boolean
    restorationExact: boolean
    numericParagraphControlsAbsent: true
    qualitativeRhythmPreserved: true
  }>
  runtime: DiagnosticRuntime
  observation: WriterPromptAblationObservation
  inferenceCount: 1
  databaseCalls: 0
  publicationCalls: 0
  classification: WriterPromptAblationClassification
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
  'snapshot',
  'plan',
  'continuation',
  'brief',
])

export function assertWriterPromptAblationSerialization(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (FORBIDDEN_ARTIFACT_KEYS.has(normalized)) {
        throw new Error(`WRITER_PROMPT_ABLATION_V1_FORBIDDEN_ARTIFACT_KEY:${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

function authorityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WRITER_PROMPT_ABLATION_V1_')
}

export async function executeWriterPromptAblation(
  input: PreflightInput & Readonly<{ provider: GenerationProvider }>,
): Promise<WriterPromptAblationReport> {
  const preflight = await preflightWriterPromptAblation(input)
  const prepared = await prepareWriterPromptAblation()
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
        invocation: 'WRITER_PROMPT_ABLATION_V1',
        system: prepared.treatment.system,
        prompt: prepared.treatment.prompt,
      },
      observeWriterRuntime: (runtime) => {
        runtimeCount += 1
        if (runtimeCount > 1 || stableStringify(runtime) !== stableStringify(EXPECTED_RUNTIME)) {
          throw new Error('WRITER_PROMPT_ABLATION_V1_RUNTIME_MISMATCH')
        }
      },
      observeModelCall: (completion) => {
        modelCallCount += 1
        const allowedModelIds: readonly string[] = [
          WRITER_PROMPT_ABLATION_V1_CONFIG.modelId,
          WRITER_PROMPT_ABLATION_V1_CONFIG.canonicalSlug,
        ]
        if (modelCallCount > 1
          || completion.actualProviderId !== 'openrouter'
          || !allowedModelIds.includes(completion.actualModelId)) {
          throw new Error('WRITER_PROMPT_ABLATION_V1_MODEL_IDENTITY_MISMATCH')
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
    throw new Error('WRITER_PROMPT_ABLATION_V1_INFERENCE_ACCOUNTING_MISMATCH')
  }
  const observation: WriterPromptAblationObservation = Object.freeze({ ...mutable })
  const report: WriterPromptAblationReport = {
    track: 'WRITER_PROMPT_ABLATION_V1',
    treatment: 'ABLATION_PARAGRAPH_COUNT_REMOVAL',
    experimentType: 'CAUSAL',
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
      reasoningEffort: 'none',
      maxOutputTokens: 4096,
      fallbackCount: 0,
    },
    baselinePromptSha256: preflight.baselinePromptSha256,
    treatmentPromptSha256: preflight.treatmentPromptSha256,
    projectionEvidence: {
      ...prepared.fixtureEvidence,
      numericParagraphControlsAbsent: true,
      qualitativeRhythmPreserved: true,
    },
    runtime: EXPECTED_RUNTIME,
    observation,
    inferenceCount: 1,
    databaseCalls: 0,
    publicationCalls: 0,
    classification: classifyWriterPromptAblation(observation),
  }
  assertWriterPromptAblationSerialization(report)
  return report
}
