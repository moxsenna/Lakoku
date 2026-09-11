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

export const WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG = Object.freeze({
  track: 'WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1' as const,
  modelId: 'meta/muse-spark-1.2-contributor',
  fixtureClassification: 'SYNTHETIC' as const,
  reasoningEffort: 'minimal',
  maxOutputTokens: 4096,
  timeoutMs: 120_000,
  streaming: true as const,
  maxRetries: 0,
  fallbackCount: 0,
  replacementCount: 0,
  temperature: null,
  firstPromptTarget: '950–1050',
  hardAcceptance: '800–1000',
  repairTarget: '850–950',
  operations: 5,
  maxInferencePerOperation: 2,
  maxInferenceTotal: 10,
  databaseAllowed: false,
  publicationAllowed: false,
  proseRetentionAllowed: false,
})

export type WriterLengthRepairFixtureKey =
  | 'EARLY'
  | 'DIALOGUE'
  | 'MYSTERY'
  | 'EMOTIONAL'
  | 'LATER_ACT'

const FIXTURES = Object.freeze([
  Object.freeze({ key: 'EARLY' as const, chapterNumber: 1 }),
  Object.freeze({ key: 'DIALOGUE' as const, chapterNumber: 8 }),
  Object.freeze({ key: 'MYSTERY' as const, chapterNumber: 12 }),
  Object.freeze({ key: 'EMOTIONAL' as const, chapterNumber: 25 }),
  Object.freeze({ key: 'LATER_ACT' as const, chapterNumber: 45 }),
])

const EXPECTED_PROMPT_HASHES: Record<WriterLengthRepairFixtureKey, string> = {
  EARLY: '3330b14cf078a72d34f75aedc1174230815e4df7a4518a3a6a56927a99bd0191',
  DIALOGUE: '31da8bd439d92fe542481deec26be94ac7eb75afcfe718bc54ca3b02674e1049',
  MYSTERY: '0d68bb177163d8a44328a978e4d59e4d405b3418c05390f28290853a12a86644',
  EMOTIONAL: '66b73f79d745594de5bf2ebd0d64a933a245cad2aa5c6b028727e5fb91838699',
  LATER_ACT: '3e1d568effd4f438f4047c5dce67e1047ae5baa787d4ef9bf445e5b122e73ae4',
}
const EXPECTED_MANIFEST_HASH = '9b10a0b8f878b877ddfa1c8174ad22d114736c0482945a6cdef7ac21addd5e22'
const BASELINE_TARGET = 'target 850–950;'
const TREATMENT_TARGET = 'target 950–1050;'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export type PreparedWriterLengthRepairFixture = Readonly<{
  key: WriterLengthRepairFixtureKey
  chapterNumber: number
  system: string
  prompt: string
  promptSha256: string
  snapshot: ReturnType<typeof buildWriterLengthRepairDiagnosticFixture>['snapshot']
  blueprint: ReturnType<typeof buildWriterLengthRepairDiagnosticFixture>['blueprint']
  continuation: ReturnType<typeof buildWriterLengthRepairDiagnosticFixture>['continuation']
  brief: ReturnType<typeof buildWriterLengthRepairDiagnosticFixture>['brief']
  plan: Record<string, unknown>
  previousChapterNumber: number | null
  contextSafety: 'OPENING_NO_PREVIOUS' | 'PRE_GATE_NOTARY_ONLY' | 'REVEAL_AWARE'
  completedActRollupCount: number
}>

export async function prepareWriterLengthRepairCausalDiagnostic(): Promise<Readonly<{
  authorityVersion: typeof HISTORICAL_WRITER_AUTHORITY_VERSION
  fixtures: readonly PreparedWriterLengthRepairFixture[]
  manifestSha256: string
}>> {
  const deterministic = createDeterministicProvider({
    targetWordsMin: 950,
    targetWordsMax: 1050,
    targetScenes: 3,
  })
  const fixtures: PreparedWriterLengthRepairFixture[] = []
  for (const definition of FIXTURES) {
    const context = buildWriterLengthRepairDiagnosticFixture(definition.chapterNumber)
    const plan = await deterministic.generatePlan({
      snapshot: context.snapshot,
      blueprint: context.blueprint,
      chapterNumber: definition.chapterNumber,
      continuation: context.continuation,
      brief: context.brief,
    }) as Record<string, unknown>
    const baseline = renderHistoricalWriterPrompt({
      snapshot: context.snapshot,
      plan,
      continuation: context.continuation,
    })
    const occurrences = baseline.prompt.split(BASELINE_TARGET).length - 1
    if (occurrences !== 1) throw new Error('CAUSAL_DIAGNOSTIC_TARGET_REPLACEMENT_MISMATCH')
    const prompt = baseline.prompt.replace(BASELINE_TARGET, TREATMENT_TARGET)
    fixtures.push({
      ...definition,
      system: baseline.system,
      prompt,
      promptSha256: sha256(prompt),
      snapshot: context.snapshot,
      blueprint: context.blueprint,
      continuation: context.continuation,
      brief: context.brief,
      plan,
      previousChapterNumber: context.previousChapterNumber,
      contextSafety: context.contextSafety,
      completedActRollupCount: context.completedActRollupCount,
    })
  }
  const manifestSha256 = sha256(stableStringify(fixtures.map((fixture) => ({
    key: fixture.key,
    chapterNumber: fixture.chapterNumber,
    treatmentPromptSha256: fixture.promptSha256,
  }))))
  return {
    authorityVersion: HISTORICAL_WRITER_AUTHORITY_VERSION,
    fixtures,
    manifestSha256,
  }
}

export type WriterLengthRepairDiagnosticCall = Readonly<{
  phase: 'FIRST_PASS' | 'LENGTH_REPAIR_1'
  transportOutcome: string
  parserOutcome: 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED'
  requiredSectionsPresent: boolean | null
  terminalClosurePresent: boolean | null
  reasoningTokenCount: number | null
  completionTokenCount: number | null
  latencyMs: number
}>

export type WriterLengthRepairDiagnosticOperation = Readonly<{
  firstPassWordCount: number | null
  firstPassOutcome: 'ACCEPTED' | 'LENGTH_REPAIR_ELIGIBLE' | 'REJECTED'
  repairEligible: boolean
  repairAttempted: boolean
  repairWordCount: number | null
  repairOutcome: 'NOT_ATTEMPTED' | 'ACCEPTED' | 'REJECTED'
  finalWriterOutcome: 'ACCEPTED' | 'REJECTED'
  writerInferenceCount: number
  calls: readonly WriterLengthRepairDiagnosticCall[]
}>

export type WriterLengthRepairDiagnosticClassification =
  | 'STRONG_POSITIVE'
  | 'INSUFFICIENT_REPAIR_OPPORTUNITY'
  | 'NEGATIVE'

function assertOperationBudgets(operations: readonly WriterLengthRepairDiagnosticOperation[]): void {
  if (operations.length !== WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG.operations) {
    throw new Error('CAUSAL_DIAGNOSTIC_OPERATION_COUNT_MISMATCH')
  }
  const totalInferenceCount = operations.reduce(
    (sum, operation) => sum + operation.writerInferenceCount,
    0,
  )
  if (
    operations.some(
      (operation) => operation.writerInferenceCount > 2 || operation.calls.length > 2,
    )
    || totalInferenceCount > 10
  ) {
    throw new Error('CAUSAL_DIAGNOSTIC_INFERENCE_BUDGET_BREACH')
  }
  if (
    operations.some(
      (operation) => operation.writerInferenceCount < 1
        || operation.calls.length !== operation.writerInferenceCount
        || operation.calls[0]?.phase !== 'FIRST_PASS'
        || (operation.repairAttempted
          ? operation.calls[1]?.phase !== 'LENGTH_REPAIR_1'
          : operation.calls.length !== 1),
    )
    || totalInferenceCount < 5
  ) {
    throw new Error('CAUSAL_DIAGNOSTIC_INFERENCE_ACCOUNTING_MISMATCH')
  }
  if (operations.some((operation) => operation.repairAttempted && !operation.repairEligible)) {
    throw new Error('CAUSAL_DIAGNOSTIC_INELIGIBLE_REPAIR_ATTEMPT')
  }
  if (operations.some((operation) => operation.repairEligible && !operation.repairAttempted)) {
    throw new Error('CAUSAL_DIAGNOSTIC_ELIGIBLE_REPAIR_MISSING')
  }
}

export function classifyWriterLengthRepairDiagnostic(
  operations: readonly WriterLengthRepairDiagnosticOperation[],
): WriterLengthRepairDiagnosticClassification {
  assertOperationBudgets(operations)
  const repairs = operations.filter((operation) => operation.repairAttempted)
  if (repairs.length <= 1) return 'INSUFFICIENT_REPAIR_OPPORTUNITY'

  const damage = repairs.some((operation) => {
    const first = operation.calls[0]
    const repaired = operation.calls[1]
    return Boolean(
      repaired
      && first
      && (
        (first.parserOutcome === 'ACCEPTED' && repaired.parserOutcome !== 'ACCEPTED')
        || (first.terminalClosurePresent === true && repaired.terminalClosurePresent !== true)
        || repaired.transportOutcome === 'CONTENT_REJECTED'
      )
    )
  })
  if (damage) return 'NEGATIVE'

  const successes = repairs.filter((operation) => operation.repairOutcome === 'ACCEPTED').length
  const successRate = successes / repairs.length
  const finalPasses = operations.filter((operation) => operation.finalWriterOutcome === 'ACCEPTED').length
  const maxTwoAll = operations.every((operation) => operation.writerInferenceCount <= 2)
  if (finalPasses >= 4 && successRate >= 0.75 && maxTwoAll) return 'STRONG_POSITIVE'
  return 'NEGATIVE'
}

export async function preflightWriterLengthRepairCausalDiagnostic(input: Readonly<{
  productionRepairFlag: string | undefined
  diagnosticChildFlag: string | undefined
  credentialAvailable: boolean
}>): Promise<Readonly<{
  ok: true
  providerCalls: 0
  credentialAvailable: boolean
  manifestSha256: string
}>> {
  if (input.productionRepairFlag !== undefined) {
    throw new Error('CAUSAL_DIAGNOSTIC_PRODUCTION_FLAG_MUST_BE_OFF')
  }
  if (input.diagnosticChildFlag !== '1') {
    throw new Error('CAUSAL_DIAGNOSTIC_CHILD_PROCESS_REQUIRED')
  }
  const prepared = await prepareWriterLengthRepairCausalDiagnostic()
  for (const fixture of prepared.fixtures) {
    if (fixture.promptSha256 !== EXPECTED_PROMPT_HASHES[fixture.key]) {
      throw new Error(`CAUSAL_DIAGNOSTIC_PROMPT_HASH_MISMATCH:${fixture.key}`)
    }
    if (fixture.contextSafety === 'PRE_GATE_NOTARY_ONLY' && fixture.chapterNumber >= 12) {
      throw new Error('CAUSAL_DIAGNOSTIC_SYNTHETIC_CONTEXT_GUARD_FAILED')
    }
  }
  if (prepared.manifestSha256 !== EXPECTED_MANIFEST_HASH) {
    throw new Error('CAUSAL_DIAGNOSTIC_MANIFEST_HASH_MISMATCH')
  }
  if (!input.credentialAvailable) throw new Error('CAUSAL_DIAGNOSTIC_CREDENTIAL_MISSING')
  return {
    ok: true,
    providerCalls: 0,
    credentialAvailable: input.credentialAvailable,
    manifestSha256: prepared.manifestSha256,
  }
}

export type WriterLengthRepairDiagnosticReport = Readonly<{
  track: 'WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1'
  manifestSha256: string
  operations: ReadonlyArray<Readonly<{
    index: number
    fixtureKey: WriterLengthRepairFixtureKey
    chapterNumber: number
  }> & WriterLengthRepairDiagnosticOperation>
  aggregate: Readonly<{
    operationCount: number
    FIRST_PASS_WRITER_SUCCESS: number
    FINAL_WRITER_SUCCESS: number
    REPAIR_ELIGIBLE_COUNT: number
    REPAIR_ATTEMPT_COUNT: number
    REPAIR_SUCCESS_RATE: number
    TOTAL_INFERENCE_COUNT: number
    repairSuccessCount: number
    maxTwoInferenceCount: number
    transportFailureCount: number
    parserRegressionCount: number
    closureRegressionCount: number
    databaseCalls: 0
    publicationCalls: 0
  }>
  classification: WriterLengthRepairDiagnosticClassification
}>

export async function runWriterLengthRepairCausalDiagnostic(input: Readonly<{
  productionRepairFlag: string | undefined
  diagnosticChildFlag: string | undefined
  credentialAvailable: boolean
  executeOperation: (input: Readonly<{
    index: number
    fixtureKey: WriterLengthRepairFixtureKey
    chapterNumber: number
    fixture: PreparedWriterLengthRepairFixture
  }>) => Promise<WriterLengthRepairDiagnosticOperation>
}>): Promise<WriterLengthRepairDiagnosticReport> {
  const preflight = await preflightWriterLengthRepairCausalDiagnostic(input)
  const prepared = await prepareWriterLengthRepairCausalDiagnostic()
  const operations: Array<Readonly<{
    index: number
    fixtureKey: WriterLengthRepairFixtureKey
    chapterNumber: number
  }> & WriterLengthRepairDiagnosticOperation> = []
  for (let index = 0; index < prepared.fixtures.length; index += 1) {
    const fixture = prepared.fixtures[index]!
    const result = await input.executeOperation({
      index: index + 1,
      fixtureKey: fixture.key,
      chapterNumber: fixture.chapterNumber,
      fixture,
    })
    operations.push({
      index: index + 1,
      fixtureKey: fixture.key,
      chapterNumber: fixture.chapterNumber,
      ...result,
    })
  }
  const classification = classifyWriterLengthRepairDiagnostic(operations)
  const repaired = operations.filter((operation) => operation.repairAttempted)
  const repairSuccessCount = repaired.filter((operation) => operation.repairOutcome === 'ACCEPTED').length
  return {
    track: WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG.track,
    manifestSha256: preflight.manifestSha256,
    operations,
    aggregate: {
      operationCount: operations.length,
      FIRST_PASS_WRITER_SUCCESS: operations.filter(
        (operation) => operation.firstPassOutcome === 'ACCEPTED',
      ).length,
      FINAL_WRITER_SUCCESS: operations.filter(
        (operation) => operation.finalWriterOutcome === 'ACCEPTED',
      ).length,
      REPAIR_ELIGIBLE_COUNT: operations.filter(
        (operation) => operation.repairEligible,
      ).length,
      REPAIR_ATTEMPT_COUNT: repaired.length,
      REPAIR_SUCCESS_RATE: repaired.length === 0 ? 0 : repairSuccessCount / repaired.length,
      TOTAL_INFERENCE_COUNT: operations.reduce(
        (sum, operation) => sum + operation.writerInferenceCount,
        0,
      ),
      repairSuccessCount,
      maxTwoInferenceCount: operations.filter((operation) => operation.writerInferenceCount <= 2).length,
      transportFailureCount: operations.flatMap((operation) => operation.calls)
        .filter((call) => call.transportOutcome !== 'SUCCEEDED').length,
      parserRegressionCount: repaired.filter((operation) => (
        operation.calls[0]?.parserOutcome === 'ACCEPTED'
        && operation.calls[1]?.parserOutcome !== 'ACCEPTED'
      )).length,
      closureRegressionCount: repaired.filter((operation) => (
        operation.calls[0]?.terminalClosurePresent === true
        && operation.calls[1]?.terminalClosurePresent !== true
      )).length,
      databaseCalls: 0,
      publicationCalls: 0,
    },
    classification,
  }
}

export function createWriterLengthRepairDiagnosticRoute(): AiModelRoute {
  return {
    useCase: 'chapter_prose',
    provider: 'openrouter',
    modelId: WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG.modelId,
    fallbackModels: [],
    temperature: null,
    maxOutputTokens: 4096,
    reasoningEffort: 'minimal',
    routeVersion: 'writer-length-repair-causal-diagnostic-v1',
  }
}

export async function executeWriterLengthRepairDiagnosticOperation(input: Readonly<{
  fixture: PreparedWriterLengthRepairFixture
  provider: GenerationProvider
}>): Promise<WriterLengthRepairDiagnosticOperation> {
  const calls: Array<{
    phase: 'FIRST_PASS' | 'LENGTH_REPAIR_1'
    transportOutcome: string
    parserOutcome: 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED'
    requiredSectionsPresent: boolean | null
    terminalClosurePresent: boolean | null
    reasoningTokenCount: number | null
    completionTokenCount: number | null
    latencyMs: number
    wordCount: number | null
  }> = []
  type TerminalTelemetry = Readonly<{
    firstPassOutcome: 'ACCEPTED' | 'LENGTH_REPAIR_ELIGIBLE' | 'REJECTED'
    repairAttempted: boolean
    repairOutcome: 'NOT_ATTEMPTED' | 'ACCEPTED' | 'REJECTED'
    finalWriterOutcome: 'ACCEPTED' | 'REJECTED'
  }>
  const terminalState: { value: TerminalTelemetry | null } = { value: null }
  let activeCall = -1
  let operationError: unknown = null
  const ensureCall = () => {
    if (!calls[activeCall]) {
      calls[activeCall] = {
        phase: activeCall === 0 ? 'FIRST_PASS' : 'LENGTH_REPAIR_1',
        transportOutcome: 'NOT_COMPLETED',
        parserOutcome: 'NOT_REACHED',
        requiredSectionsPresent: null,
        terminalClosurePresent: null,
        reasoningTokenCount: null,
        completionTokenCount: null,
        latencyMs: 0,
        wordCount: null,
      }
    }
    return calls[activeCall]!
  }

  try {
    await input.provider.writeChapter({
      snapshot: input.fixture.snapshot,
      plan: input.fixture.plan,
      continuation: input.fixture.continuation,
      brief: input.fixture.brief,
    }, {
      telemetryContext: {
        userId: '00000000-0000-4000-8000-000000000001',
        storyId: input.fixture.snapshot.storyId,
        chapterNumber: input.fixture.chapterNumber,
        generationKind: 'standard',
        jobId: null,
        correlationId: randomUUID(),
        attemptNumber: null,
      },
      workflowPhase: 'CHAPTER_PROSE_FIRST_PASS',
      callBudget: { used: 0, max: 2 },
      writerInferenceBudget: { used: 0, max: 2 },
      writerLengthRepairV1: { enabled: true },
      diagnosticChapterWriterPromptOverride: {
        invocation: WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG.track,
        system: input.fixture.system,
        prompt: input.fixture.prompt,
      },
      observeWriterRuntime: (runtime) => {
        activeCall += 1
        if (
          runtime.timeoutMs !== 120_000
          || runtime.streaming !== true
          || runtime.maxRetries !== 0
          || runtime.maxOutputTokens !== 4096
          || runtime.temperature !== null
        ) throw new Error('CAUSAL_DIAGNOSTIC_RUNTIME_MISMATCH')
        ensureCall()
      },
      observeModelCall: (completion) => {
        const call = ensureCall()
        call.transportOutcome = completion.outcome
        call.completionTokenCount = completion.outputTokenCount
        call.latencyMs = completion.elapsedMs
        if (
          completion.actualProviderId !== 'openrouter'
          || (completion.actualModelResolved
            && completion.actualModelId !== WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG.modelId)
        ) throw new Error('CAUSAL_DIAGNOSTIC_MODEL_IDENTITY_MISMATCH')
      },
      observeReasoningBudget: (budget) => {
        const call = ensureCall()
        call.reasoningTokenCount = budget.reasoningTokenCount
        call.completionTokenCount = budget.completionTokenCount
      },
      observeWriterParserOutcome: (outcome) => {
        ensureCall().parserOutcome = outcome
      },
      observeWriterEvaluation: (evaluation) => {
        const call = ensureCall()
        call.wordCount = evaluation.wordCount
        call.requiredSectionsPresent = evaluation.requiredSectionsPresent
        call.terminalClosurePresent = evaluation.terminalClosurePresent
      },
      observeWriterLengthRepair: (value) => {
        terminalState.value = value
      },
    })
  } catch (error) {
    operationError = error
  }
  const terminalResult = terminalState.value
  if (!terminalResult) throw new Error('CAUSAL_DIAGNOSTIC_TERMINAL_OBSERVER_MISSING')
  if (operationError instanceof Error && operationError.message.startsWith('CAUSAL_DIAGNOSTIC_')) {
    throw operationError
  }
  const first = calls[0]
  const repair = calls[1]
  return {
    firstPassWordCount: first?.wordCount ?? null,
    firstPassOutcome: terminalResult.firstPassOutcome,
    repairEligible: terminalResult.firstPassOutcome === 'LENGTH_REPAIR_ELIGIBLE',
    repairAttempted: terminalResult.repairAttempted,
    repairWordCount: repair?.wordCount ?? null,
    repairOutcome: terminalResult.repairOutcome,
    finalWriterOutcome: terminalResult.finalWriterOutcome,
    writerInferenceCount: calls.length,
    calls: calls.map(({ wordCount: _wordCount, ...call }) => call),
  }
}
