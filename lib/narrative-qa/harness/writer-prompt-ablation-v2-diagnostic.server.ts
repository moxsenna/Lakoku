import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import {
  HISTORICAL_WRITER_AUTHORITY_VERSION,
  renderHistoricalWriterPrompt,
} from './historical-writer-prompt'
import { createDeterministicProvider, type GenerationProvider } from '@/lib/ai-gateway/provider'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'
import type { ProviderCallOutcome } from '@/lib/observability/generation-provider-call.contract'
import { stableStringify } from '@/lib/narrative-qa/scoring/canonical-serializer'
import { buildWriterLengthRepairDiagnosticFixture } from './writer-length-repair-diagnostic-fixture'

export const WRITER_PROMPT_ABLATION_V2_CONFIG = Object.freeze({
  track: 'WRITER_PROMPT_ABLATION_V2' as const,
  treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL' as const,
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
const TREATMENT_ENVELOPE_SHA256 = 'ca3341e81344463fc4e74cf2ef8a678677817e15e603ca6b49f4e03c31eaafb8'
const SHORT_PARAGRAPH_RULE = '- Mayoritas paragraf = 1 kalimat pendek (15–25 kata). Sesekali 2 kalimat (30–40 kata) untuk emosi penting.'
const RESTORATION_ANCHOR = [
  '- Target 38–48 paragraf (wajib dalam 35–50).',
  '- DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.',
].join('\n')

const NUMERIC_PARAGRAPH_CONTROLS = Object.freeze([
  '- Target 38–48 paragraf (wajib dalam 35–50).',
  '- Pembuka hook: 3–5 paragraf',
  '- Konflik awal: 8–10 paragraf',
  '- Dialog/konfrontasi utama: 15–20 paragraf',
  '- Reveal kecil / ubah emosi: 6–8 paragraf',
  '- Penutup cliffhanger: 4–6 paragraf',
  'Jumlah paragraf 38–48 (wajib 35–50).',
  'Pisahkan SETIAP paragraf dengan satu baris kosong (target 38–48 paragraf).',
])
const WORD_AUTHORITY = Object.freeze([
  'Target 850–950 kata (wajib dalam 800–1000).',
  'PANJANG WAJIB minimal 850 kata (target 850–950; jangan lewat 1000).',
])
const OTHER_RHYTHM = Object.freeze([
  '- DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.',
  '- Dialog: 1 baris ucapan = 1 paragraf. Selalu pisah per pembicara.',
  '- Twist/reveal: berdiri sendiri dalam 1 paragraf.',
  '- Satu beat per paragraf.',
  'Mayoritas 1 kalimat per paragraf. Dialog satu baris per paragraf.',
])

const EXPECTED_ROUTE = Object.freeze({
  useCase: 'chapter_prose',
  provider: 'openrouter',
  modelId: 'openai/gpt-5.6-sol',
  fallbackModels: [],
  temperature: null,
  maxOutputTokens: 4096,
  reasoningEffort: 'none',
  routeVersion: 'writer-prompt-ablation-v2-short-paragraph-rule-removal',
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

function countOccurrences(value: string, target: string): number {
  return value.split(target).length - 1
}

function removeShortParagraphRule(system: string): string {
  const line = `${SHORT_PARAGRAPH_RULE}\n`
  if (countOccurrences(system, SHORT_PARAGRAPH_RULE) !== 1 || !system.includes(line)) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_PROJECTION_SOURCE_MISMATCH')
  }
  return system.replace(line, '')
}

export function restoreWriterPromptShortParagraphRule(system: string): string {
  if (countOccurrences(system, RESTORATION_ANCHOR) !== 1) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_RESTORATION_SOURCE_MISMATCH')
  }
  return system.replace(
    RESTORATION_ANCHOR,
    `- Target 38–48 paragraf (wajib dalam 35–50).\n${SHORT_PARAGRAPH_RULE}\n- DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.`,
  )
}

function allEquivalent(
  values: readonly string[],
  baseline: Readonly<{ system: string; prompt: string }>,
  treatment: Readonly<{ system: string; prompt: string }>,
): boolean {
  const baselineEnvelope = `${baseline.system}\n${baseline.prompt}`
  const treatmentEnvelope = `${treatment.system}\n${treatment.prompt}`
  return values.every((value) => countOccurrences(baselineEnvelope, value) > 0
    && countOccurrences(baselineEnvelope, value) === countOccurrences(treatmentEnvelope, value))
}

export function createWriterPromptAblationV2Route(): AiModelRoute {
  return { ...EXPECTED_ROUTE, fallbackModels: [] }
}

export async function prepareWriterPromptAblationV2() {
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
  const baseline = { system: production.system, prompt: production.prompt }
  const treatment = {
    system: removeShortParagraphRule(production.system),
    prompt: production.prompt,
  }
  const restoredSystem = restoreWriterPromptShortParagraphRule(treatment.system)

  return {
    authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
    baseline: {
      ...baseline,
      systemSha256: sha256(baseline.system),
      promptSha256: sha256(baseline.prompt),
      envelopeSha256: sha256(`${baseline.system}\0${baseline.prompt}`),
    },
    treatment: {
      ...treatment,
      systemSha256: sha256(treatment.system),
      promptSha256: sha256(treatment.prompt),
      envelopeSha256: sha256(`${treatment.system}\0${treatment.prompt}`),
    },
    evidence: {
      removedRuleOccurrences: countOccurrences(baseline.system, SHORT_PARAGRAPH_RULE),
      userPromptEquivalent: treatment.prompt === baseline.prompt,
      numericParagraphControlsEquivalent: allEquivalent(NUMERIC_PARAGRAPH_CONTROLS, baseline, treatment),
      wordAuthorityEquivalent: allEquivalent(WORD_AUTHORITY, baseline, treatment),
      canonStoryBeatsEquivalent: treatment.prompt === baseline.prompt,
      otherRhythmEquivalent: allEquivalent(OTHER_RHYTHM, baseline, treatment),
      restorationExact: restoredSystem === baseline.system,
    },
    snapshot: context.snapshot,
    plan,
    continuation: context.continuation,
    brief: context.brief,
  }
}

type DiagnosticRuntime = Readonly<typeof EXPECTED_RUNTIME>
type PreflightInput = Readonly<{
  productionRepairFlag: string | undefined
  diagnosticChildFlag: string | undefined
  credentialAvailable: boolean
  expectedBaselinePromptSha256?: string
  expectedTreatmentEnvelopeSha256?: string
  route?: AiModelRoute
  runtime?: DiagnosticRuntime
}>

export async function preflightWriterPromptAblationV2(input: PreflightInput) {
  if (!input.credentialAvailable) throw new Error('WRITER_PROMPT_ABLATION_V2_CREDENTIAL_MISSING')
  if (input.diagnosticChildFlag !== '1') {
    throw new Error('WRITER_PROMPT_ABLATION_V2_CHILD_PROCESS_REQUIRED')
  }
  if (input.productionRepairFlag !== undefined) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  }
  const prepared = await prepareWriterPromptAblationV2()
  if (prepared.baseline.promptSha256
    !== (input.expectedBaselinePromptSha256 ?? BASELINE_PROMPT_SHA256)) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_BASELINE_PROMPT_HASH_MISMATCH')
  }
  if (prepared.treatment.envelopeSha256
    !== (input.expectedTreatmentEnvelopeSha256 ?? TREATMENT_ENVELOPE_SHA256)) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_TREATMENT_ENVELOPE_HASH_MISMATCH')
  }
  if (prepared.evidence.removedRuleOccurrences !== 1
    || !Object.entries(prepared.evidence)
      .filter(([key]) => key !== 'removedRuleOccurrences')
      .every(([, value]) => value === true)) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_PROJECTION_EVIDENCE_MISMATCH')
  }
  if (stableStringify(input.route ?? createWriterPromptAblationV2Route())
    !== stableStringify(EXPECTED_ROUTE)) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_ROUTE_MISMATCH')
  }
  if (stableStringify(input.runtime ?? EXPECTED_RUNTIME) !== stableStringify(EXPECTED_RUNTIME)) {
    throw new Error('WRITER_PROMPT_ABLATION_V2_RUNTIME_MISMATCH')
  }
  return {
    ok: true as const,
    providerCalls: 0 as const,
    baselinePromptSha256: prepared.baseline.promptSha256,
    baselineSystemSha256: prepared.baseline.systemSha256,
    treatmentSystemSha256: prepared.treatment.systemSha256,
    treatmentEnvelopeSha256: prepared.treatment.envelopeSha256,
  }
}

export type WriterPromptAblationV2Observation = Readonly<{
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

export type WriterPromptAblationV2Classification =
  | 'STRONG_SUPPORT_COMBINED_CONTROLLERS'
  | 'PARTIAL_SUPPORT_SHORT_PARAGRAPH_CONTROLLER'
  | 'SHORT_PARAGRAPH_CONTROLLER_WEAKENED'
  | 'SHORT_PARAGRAPH_CONTROLLER_CONFIRMED_OVERSHOOT'
  | 'STOP_CLASSIFY_LAYER'

export function classifyWriterPromptAblationV2(
  observation: WriterPromptAblationV2Observation,
): WriterPromptAblationV2Classification {
  const lengthOnly = observation.completenessPassed === false
    && observation.completenessCodes.length === 1
    && observation.completenessCodes[0] === 'WRITER_LENGTH_OUT_OF_RANGE'
  const healthyShape = (observation.transportOutcome === 'SUCCEEDED'
      || (observation.transportOutcome === 'INVALID_RESPONSE' && lengthOnly))
    && observation.parserOutcome === 'ACCEPTED'
    && observation.wordCount !== null
    && observation.requiredSectionsPresent === true
    && observation.terminalClosurePresent === true
    && observation.finishReason === 'stop'
  if (!healthyShape || observation.wordCount === null) return 'STOP_CLASSIFY_LAYER'
  if (observation.wordCount >= 800 && observation.wordCount <= 1000) {
    return observation.completenessPassed === true && observation.completenessCodes.length === 0
      ? 'STRONG_SUPPORT_COMBINED_CONTROLLERS'
      : 'STOP_CLASSIFY_LAYER'
  }
  if (observation.wordCount >= 750 && observation.wordCount <= 799 && lengthOnly) {
    return 'PARTIAL_SUPPORT_SHORT_PARAGRAPH_CONTROLLER'
  }
  if (observation.wordCount < 750 && lengthOnly) return 'SHORT_PARAGRAPH_CONTROLLER_WEAKENED'
  if (observation.wordCount > 1000 && lengthOnly) {
    return 'SHORT_PARAGRAPH_CONTROLLER_CONFIRMED_OVERSHOOT'
  }
  return 'STOP_CLASSIFY_LAYER'
}

export type WriterPromptAblationV2Report = Readonly<{
  track: 'WRITER_PROMPT_ABLATION_V2'
  treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL'
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
  hashes: Readonly<{
    baselinePromptSha256: string
    baselineSystemSha256: string
    treatmentSystemSha256: string
    treatmentEnvelopeSha256: string
  }>
  projectionEvidence: Readonly<{
    removedRuleOccurrences: number
    userPromptEquivalent: boolean
    numericParagraphControlsEquivalent: boolean
    wordAuthorityEquivalent: boolean
    canonStoryBeatsEquivalent: boolean
    otherRhythmEquivalent: boolean
    restorationExact: boolean
  }>
  runtime: DiagnosticRuntime
  observation: WriterPromptAblationV2Observation
  inferenceCount: 1
  databaseCalls: 0
  publicationCalls: 0
  classification: WriterPromptAblationV2Classification
}>

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  'prompt', 'system', 'title', 'prose', 'paragraph', 'paragraphs', 'rawresponse',
  'reasoning', 'reasoningtext', 'canon', 'snapshot', 'plan', 'continuation', 'brief',
])

export function assertWriterPromptAblationV2Serialization(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (FORBIDDEN_ARTIFACT_KEYS.has(normalized)) {
        throw new Error(`WRITER_PROMPT_ABLATION_V2_FORBIDDEN_ARTIFACT_KEY:${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

function authorityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WRITER_PROMPT_ABLATION_V2_')
}

export async function executeWriterPromptAblationV2(
  input: PreflightInput & Readonly<{ provider: GenerationProvider }>,
): Promise<WriterPromptAblationV2Report> {
  const preflight = await preflightWriterPromptAblationV2(input)
  const prepared = await prepareWriterPromptAblationV2()
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
    transportOutcome: 'NOT_COMPLETED', parserOutcome: 'NOT_REACHED',
    completenessPassed: null, completenessCodes: [], wordCount: null, paragraphCount: null,
    requiredSectionsPresent: null, terminalClosurePresent: null, finishReason: null,
    reasoningTokenCount: null, completionTokenCount: null, latencyMs: 0,
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
        invocation: 'WRITER_PROMPT_ABLATION_V2',
        system: prepared.treatment.system,
        prompt: prepared.treatment.prompt,
      },
      observeWriterRuntime: (runtime) => {
        runtimeCount += 1
        if (runtimeCount > 1 || stableStringify(runtime) !== stableStringify(EXPECTED_RUNTIME)) {
          throw new Error('WRITER_PROMPT_ABLATION_V2_RUNTIME_MISMATCH')
        }
      },
      observeModelCall: (completion) => {
        modelCallCount += 1
        const allowedModelIds: readonly string[] = [
          WRITER_PROMPT_ABLATION_V2_CONFIG.modelId,
          WRITER_PROMPT_ABLATION_V2_CONFIG.canonicalSlug,
        ]
        if (modelCallCount > 1 || completion.actualProviderId !== 'openrouter'
          || !allowedModelIds.includes(completion.actualModelId)) {
          throw new Error('WRITER_PROMPT_ABLATION_V2_MODEL_IDENTITY_MISMATCH')
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
    throw new Error('WRITER_PROMPT_ABLATION_V2_INFERENCE_ACCOUNTING_MISMATCH')
  }
  const observation: WriterPromptAblationV2Observation = Object.freeze({ ...mutable })
  const report: WriterPromptAblationV2Report = {
    track: 'WRITER_PROMPT_ABLATION_V2',
    treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL',
    experimentType: 'CAUSAL',
    qualificationAllowed: false,
    fixture: { fixtureClassification: 'SYNTHETIC', genre: 'MYSTERY', chapterNumber: 12 },
    modelPolicy: {
      provider: 'openrouter', requestedModel: 'openai/gpt-5.6-sol',
      modelId: 'openai/gpt-5.6-sol', canonicalSlug: 'openai/gpt-5.6-sol-20260709',
      reasoningEffort: 'none', maxOutputTokens: 4096, fallbackCount: 0,
    },
    hashes: {
      baselinePromptSha256: preflight.baselinePromptSha256,
      baselineSystemSha256: preflight.baselineSystemSha256,
      treatmentSystemSha256: preflight.treatmentSystemSha256,
      treatmentEnvelopeSha256: preflight.treatmentEnvelopeSha256,
    },
    projectionEvidence: prepared.evidence,
    runtime: EXPECTED_RUNTIME,
    observation,
    inferenceCount: 1,
    databaseCalls: 0,
    publicationCalls: 0,
    classification: classifyWriterPromptAblationV2(observation),
  }
  assertWriterPromptAblationV2Serialization(report)
  return report
}
