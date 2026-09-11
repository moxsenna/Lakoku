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

export const WRITER_PROMPT_V2_GENERALIZATION_CONFIG = Object.freeze({
  track: 'WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1' as const,
  treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL' as const,
  experimentType: 'CAUSAL_GENERALIZATION' as const,
  qualificationAllowed: false,
  fixtureClassification: 'SYNTHETIC' as const,
  genre: 'MYSTERY' as const,
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
  maxProviderCalls: 5,
  maxWriterInferencesPerFixture: 1,
  writerLengthRepairEnabled: false,
  databaseAllowed: false,
  publicationAllowed: false,
  contentRetentionAllowed: false,
})

export const WRITER_PROMPT_V2_GENERALIZATION_FIXTURES = Object.freeze([
  Object.freeze({ key: 'EARLY' as const, chapterNumber: 1 }),
  Object.freeze({ key: 'DIALOGUE' as const, chapterNumber: 8 }),
  Object.freeze({ key: 'MYSTERY' as const, chapterNumber: 12 }),
  Object.freeze({ key: 'EMOTIONAL' as const, chapterNumber: 25 }),
  Object.freeze({ key: 'LATER_ACT' as const, chapterNumber: 45 }),
])

export type WriterPromptV2GeneralizationFixtureKey =
  (typeof WRITER_PROMPT_V2_GENERALIZATION_FIXTURES)[number]['key']

const FROZEN_MANIFEST: Readonly<Record<WriterPromptV2GeneralizationFixtureKey, Readonly<{
  baselinePromptSha256: string
  treatmentEnvelopeSha256: string
}>>> = Object.freeze({
  EARLY: Object.freeze({
    baselinePromptSha256: 'a51dca65dfd84111ee81b70a3afb3e6d570f470bc443c3f87dced42bfa09bc7e',
    treatmentEnvelopeSha256: '4265026d5911190abc4eedf689daf8935500b24e0967c897297ac87433abcb19',
  }),
  DIALOGUE: Object.freeze({
    baselinePromptSha256: '580299448072941d22e8237ba22e2f0e13f371c808943019f7db875cdda56c10',
    treatmentEnvelopeSha256: '3482d7361438f67f2a7a7351176f58209d3c942734bbee1c14294936242d0bd0',
  }),
  MYSTERY: Object.freeze({
    baselinePromptSha256: '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a',
    treatmentEnvelopeSha256: 'ca3341e81344463fc4e74cf2ef8a678677817e15e603ca6b49f4e03c31eaafb8',
  }),
  EMOTIONAL: Object.freeze({
    baselinePromptSha256: '2f619f7218f52a5deed7b85c2a8eea3feffc10aea0d0c7f27ed335889dd17ddd',
    treatmentEnvelopeSha256: 'a4871bf651ec0cf3751e0df00fb4f6990148b3a600fbc38849aa3f5919543718',
  }),
  LATER_ACT: Object.freeze({
    baselinePromptSha256: '70b62d5c6b8f7f64c17a81c7cf0d04125b648434501939027d10cc1ffb023794',
    treatmentEnvelopeSha256: '3a73a46643b3d14a7a96c5cc14f7ef97663ea8067df8b00206442b62e07b6966',
  }),
})

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
  routeVersion: 'writer-prompt-v2-generalization-diagnostic-v1',
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
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_PROJECTION_SOURCE_MISMATCH')
  }
  return system.replace(line, '')
}

function restoreShortParagraphRule(system: string): string {
  if (countOccurrences(system, RESTORATION_ANCHOR) !== 1) {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_RESTORATION_SOURCE_MISMATCH')
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

export function createWriterPromptV2GeneralizationRoute(): AiModelRoute {
  return { ...EXPECTED_ROUTE, fallbackModels: [] }
}

async function prepareFixture(fixture: Readonly<{ key: WriterPromptV2GeneralizationFixtureKey; chapterNumber: number }>) {
  const context = buildWriterLengthRepairDiagnosticFixture(fixture.chapterNumber)
  const plan = await createDeterministicProvider({
    targetWordsMin: 850,
    targetWordsMax: 950,
    targetScenes: 3,
  }).generatePlan({
    snapshot: context.snapshot,
    blueprint: context.blueprint,
    chapterNumber: fixture.chapterNumber,
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
  const restoredSystem = restoreShortParagraphRule(treatment.system)

  return {
    key: fixture.key,
    chapterNumber: fixture.chapterNumber,
    baseline: {
      ...baseline,
      systemSha256: sha256(baseline.system),
      promptSha256: sha256(baseline.prompt),
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

export type WriterPromptV2GeneralizationPrepared = Awaited<
  ReturnType<typeof prepareWriterPromptV2Generalization>
>

export async function prepareWriterPromptV2Generalization() {
  const fixtures = []
  for (const fixture of WRITER_PROMPT_V2_GENERALIZATION_FIXTURES) {
    fixtures.push(await prepareFixture(fixture))
  }
  return {
    authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
    fixtures,
  }
}

function manifestMismatch(fixture: Readonly<{
  key: WriterPromptV2GeneralizationFixtureKey
  baseline: Readonly<{ promptSha256: string }>
  treatment: Readonly<{ envelopeSha256: string }>
}>): boolean {
  const frozen = FROZEN_MANIFEST[fixture.key]
  return fixture.baseline.promptSha256 !== frozen.baselinePromptSha256
    || fixture.treatment.envelopeSha256 !== frozen.treatmentEnvelopeSha256
}

type DiagnosticRuntime = Readonly<typeof EXPECTED_RUNTIME>
type PreflightInput = Readonly<{
  productionRepairFlag: string | undefined
  diagnosticChildFlag: string | undefined
  credentialAvailable: boolean
  route?: AiModelRoute
  runtime?: DiagnosticRuntime
}>

export async function preflightWriterPromptV2Generalization(input: PreflightInput) {
  if (!input.credentialAvailable) {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_CREDENTIAL_MISSING')
  }
  if (input.diagnosticChildFlag !== '1') {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_CHILD_PROCESS_REQUIRED')
  }
  if (input.productionRepairFlag !== undefined) {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  }
  const prepared = await prepareWriterPromptV2Generalization()
  for (const fixture of prepared.fixtures) {
    if (manifestMismatch(fixture)) {
      throw new Error(`WRITER_PROMPT_V2_GENERALIZATION_MANIFEST_HASH_MISMATCH:${fixture.key}`)
    }
    if (fixture.evidence.removedRuleOccurrences !== 1
      || !Object.entries(fixture.evidence)
        .filter(([key]) => key !== 'removedRuleOccurrences')
        .every(([, value]) => value === true)) {
      throw new Error(`WRITER_PROMPT_V2_GENERALIZATION_PROJECTION_EVIDENCE_MISMATCH:${fixture.key}`)
    }
  }
  if (stableStringify(input.route ?? createWriterPromptV2GeneralizationRoute())
    !== stableStringify(EXPECTED_ROUTE)) {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_ROUTE_MISMATCH')
  }
  if (stableStringify(input.runtime ?? EXPECTED_RUNTIME) !== stableStringify(EXPECTED_RUNTIME)) {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_RUNTIME_MISMATCH')
  }
  return {
    ok: true as const,
    providerCalls: 0 as const,
    fixtures: prepared.fixtures.map((fixture) => ({
      key: fixture.key,
      chapterNumber: fixture.chapterNumber,
      baselinePromptSha256: fixture.baseline.promptSha256,
      baselineSystemSha256: fixture.baseline.systemSha256,
      treatmentSystemSha256: fixture.treatment.systemSha256,
      treatmentEnvelopeSha256: fixture.treatment.envelopeSha256,
    })),
  }
}

export type WriterPromptV2GeneralizationFixtureObservation = Readonly<{
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
  visibleContentChars: number | null
  latencyMs: number
}>

export type WriterPromptV2FixtureVerdict =
  | 'WRITER_PASS'
  | 'WRITER_FAIL_LENGTH'
  | 'NEW_FAILURE_SHAPE'

export type WriterPromptV2GeneralizationClassification =
  | 'STRONG_GENERALIZATION'
  | 'MIXED_GENERALIZATION'
  | 'NEGATIVE_GENERALIZATION'

function classifyFixture(
  observation: WriterPromptV2GeneralizationFixtureObservation,
): WriterPromptV2FixtureVerdict {
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
  if (!healthyShape) return 'NEW_FAILURE_SHAPE'
  if (observation.completenessPassed === true && observation.completenessCodes.length === 0
    && observation.wordCount !== null
    && observation.wordCount >= 800 && observation.wordCount <= 1000) {
    return 'WRITER_PASS'
  }
  return lengthOnly ? 'WRITER_FAIL_LENGTH' : 'NEW_FAILURE_SHAPE'
}

export function classifyWriterPromptV2Generalization(
  verdicts: readonly WriterPromptV2FixtureVerdict[],
): WriterPromptV2GeneralizationClassification {
  const passCount = verdicts.filter((verdict) => verdict === 'WRITER_PASS').length
  if (verdicts.includes('NEW_FAILURE_SHAPE') || passCount <= 1) {
    return 'NEGATIVE_GENERALIZATION'
  }
  if (passCount >= 4) return 'STRONG_GENERALIZATION'
  return 'MIXED_GENERALIZATION'
}

export type WriterPromptV2GeneralizationReport = Readonly<{
  track: 'WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1'
  treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL'
  experimentType: 'CAUSAL_GENERALIZATION'
  qualificationAllowed: false
  modelPolicy: Readonly<{
    provider: 'openrouter'
    requestedModel: 'openai/gpt-5.6-sol'
    modelId: 'openai/gpt-5.6-sol'
    canonicalSlug: 'openai/gpt-5.6-sol-20260709'
    reasoningEffort: 'none'
    maxOutputTokens: 4096
    fallbackCount: 0
  }>
  runtime: DiagnosticRuntime
  fixtures: readonly Readonly<{
    key: WriterPromptV2GeneralizationFixtureKey
    chapterNumber: number
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
    observation: WriterPromptV2GeneralizationFixtureObservation
    wordsPerParagraph: number | null
    verdict: WriterPromptV2FixtureVerdict
  }>[]
  inferenceCount: 5
  databaseCalls: 0
  publicationCalls: 0
  classification: WriterPromptV2GeneralizationClassification
}>

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  'prompt', 'system', 'title', 'prose', 'paragraph', 'paragraphs', 'rawresponse',
  'reasoning', 'reasoningtext', 'canon', 'snapshot', 'plan', 'continuation', 'brief',
])

export function assertWriterPromptV2GeneralizationSerialization(value: unknown): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (FORBIDDEN_ARTIFACT_KEYS.has(normalized)) {
        throw new Error(`WRITER_PROMPT_V2_GENERALIZATION_FORBIDDEN_ARTIFACT_KEY:${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

function authorityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WRITER_PROMPT_V2_GENERALIZATION_')
}

export async function executeWriterPromptV2Generalization(
  input: PreflightInput & Readonly<{ provider: GenerationProvider }>,
): Promise<WriterPromptV2GeneralizationReport> {
  await preflightWriterPromptV2Generalization(input)
  const prepared = await prepareWriterPromptV2Generalization()
  const callBudget = { used: 0, max: 5 }
  let runtimeCount = 0
  let modelCallCount = 0
  const results: Array<{
    prepared: WriterPromptV2GeneralizationPrepared['fixtures'][number]
    observation: WriterPromptV2GeneralizationFixtureObservation
  }> = []

  for (const fixture of prepared.fixtures) {
    const writerInferenceBudget = { used: 0, max: 1 as const }
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
      visibleContentChars: number | null
      latencyMs: number
    } = {
      transportOutcome: 'NOT_COMPLETED', parserOutcome: 'NOT_REACHED',
      completenessPassed: null, completenessCodes: [], wordCount: null, paragraphCount: null,
      requiredSectionsPresent: null, terminalClosurePresent: null, finishReason: null,
      reasoningTokenCount: null, completionTokenCount: null, visibleContentChars: null,
      latencyMs: 0,
    }
    let executionError: unknown

    try {
      await input.provider.writeChapter({
        snapshot: fixture.snapshot,
        plan: fixture.plan,
        continuation: fixture.continuation,
        brief: fixture.brief,
      }, {
        telemetryContext: {
          userId: '00000000-0000-4000-8000-000000000001',
          storyId: fixture.snapshot.storyId,
          chapterNumber: fixture.chapterNumber,
          generationKind: 'standard',
          jobId: null,
          correlationId: randomUUID(),
          attemptNumber: null,
        },
        workflowPhase: 'CHAPTER_PROSE_FIRST_PASS',
        callBudget,
        writerInferenceBudget,
        diagnosticChapterWriterPromptOverride: {
          invocation: 'WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1',
          system: fixture.treatment.system,
          prompt: fixture.treatment.prompt,
        },
        observeWriterRuntime: (runtime) => {
          runtimeCount += 1
          if (stableStringify(runtime) !== stableStringify(EXPECTED_RUNTIME)) {
            throw new Error('WRITER_PROMPT_V2_GENERALIZATION_RUNTIME_MISMATCH')
          }
        },
        observeModelCall: (completion) => {
          modelCallCount += 1
          const allowedModelIds: readonly string[] = [
            WRITER_PROMPT_V2_GENERALIZATION_CONFIG.modelId,
            WRITER_PROMPT_V2_GENERALIZATION_CONFIG.canonicalSlug,
          ]
          if (completion.actualProviderId !== 'openrouter'
            || !allowedModelIds.includes(completion.actualModelId)) {
            throw new Error('WRITER_PROMPT_V2_GENERALIZATION_MODEL_IDENTITY_MISMATCH')
          }
          mutable.transportOutcome = completion.outcome
          mutable.finishReason = completion.finishReason ?? null
          mutable.completionTokenCount = completion.outputTokenCount
          mutable.latencyMs = completion.elapsedMs
        },
        observeReasoningBudget: (budget) => {
          mutable.reasoningTokenCount = budget.reasoningTokenCount
          mutable.completionTokenCount = budget.completionTokenCount
          mutable.visibleContentChars = budget.visibleContentChars
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
    if (writerInferenceBudget.used > 1) {
      throw new Error('WRITER_PROMPT_V2_GENERALIZATION_INFERENCE_ACCOUNTING_MISMATCH')
    }
    results.push({
      prepared: fixture,
      observation: Object.freeze({ ...mutable }),
    })
  }

  const inferenceCount = Math.max(callBudget.used, runtimeCount, modelCallCount)
  if (inferenceCount !== 5 || callBudget.used > 5 || results.length !== 5) {
    throw new Error('WRITER_PROMPT_V2_GENERALIZATION_INFERENCE_ACCOUNTING_MISMATCH')
  }
  const fixtures = results.map(({ prepared, observation }) => ({
    key: prepared.key,
    chapterNumber: prepared.chapterNumber,
    hashes: {
      baselinePromptSha256: prepared.baseline.promptSha256,
      baselineSystemSha256: prepared.baseline.systemSha256,
      treatmentSystemSha256: prepared.treatment.systemSha256,
      treatmentEnvelopeSha256: prepared.treatment.envelopeSha256,
    },
    projectionEvidence: prepared.evidence,
    observation,
    wordsPerParagraph: observation.wordCount !== null
      && observation.paragraphCount !== null
      && observation.paragraphCount > 0
      ? Math.round((observation.wordCount / observation.paragraphCount) * 10) / 10
      : null,
    verdict: classifyFixture(observation),
  }))
  const report: WriterPromptV2GeneralizationReport = {
    track: 'WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1',
    treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL',
    experimentType: 'CAUSAL_GENERALIZATION',
    qualificationAllowed: false,
    modelPolicy: {
      provider: 'openrouter', requestedModel: 'openai/gpt-5.6-sol',
      modelId: 'openai/gpt-5.6-sol', canonicalSlug: 'openai/gpt-5.6-sol-20260709',
      reasoningEffort: 'none', maxOutputTokens: 4096, fallbackCount: 0,
    },
    runtime: EXPECTED_RUNTIME,
    fixtures,
    inferenceCount: 5,
    databaseCalls: 0,
    publicationCalls: 0,
    classification: classifyWriterPromptV2Generalization(
      fixtures.map((fixture) => fixture.verdict),
    ),
  }
  assertWriterPromptV2GeneralizationSerialization(report)
  return report
}
