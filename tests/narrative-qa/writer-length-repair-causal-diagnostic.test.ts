import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import { executeObservedModelCall } from '@/lib/ai-gateway/observed-model-call.server'
import {
  WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG,
  classifyWriterLengthRepairDiagnostic,
  executeWriterLengthRepairDiagnosticOperation,
  prepareWriterLengthRepairCausalDiagnostic,
  preflightWriterLengthRepairCausalDiagnostic,
  runWriterLengthRepairCausalDiagnostic,
  type WriterLengthRepairDiagnosticOperation,
} from '@/lib/narrative-qa/harness/writer-length-repair-causal-diagnostic.server'

const EXPECTED_HASHES = {
  EARLY: '3330b14cf078a72d34f75aedc1174230815e4df7a4518a3a6a56927a99bd0191',
  DIALOGUE: '31da8bd439d92fe542481deec26be94ac7eb75afcfe718bc54ca3b02674e1049',
  MYSTERY: '0d68bb177163d8a44328a978e4d59e4d405b3418c05390f28290853a12a86644',
  EMOTIONAL: '66b73f79d745594de5bf2ebd0d64a933a245cad2aa5c6b028727e5fb91838699',
  LATER_ACT: '3e1d568effd4f438f4047c5dce67e1047ae5baa787d4ef9bf445e5b122e73ae4',
} as const

function operation(overrides: Partial<WriterLengthRepairDiagnosticOperation> = {}): WriterLengthRepairDiagnosticOperation {
  return {
    firstPassWordCount: 760,
    firstPassOutcome: 'LENGTH_REPAIR_ELIGIBLE',
    repairEligible: true,
    repairAttempted: true,
    repairWordCount: 900,
    repairOutcome: 'ACCEPTED',
    finalWriterOutcome: 'ACCEPTED',
    writerInferenceCount: 2,
    calls: [
      {
        phase: 'FIRST_PASS',
        transportOutcome: 'SUCCEEDED',
        parserOutcome: 'ACCEPTED',
        requiredSectionsPresent: true,
        terminalClosurePresent: true,
        reasoningTokenCount: 100,
        completionTokenCount: 1_000,
        latencyMs: 200,
      },
      {
        phase: 'LENGTH_REPAIR_1',
        transportOutcome: 'SUCCEEDED',
        parserOutcome: 'ACCEPTED',
        requiredSectionsPresent: true,
        terminalClosurePresent: true,
        reasoningTokenCount: 80,
        completionTokenCount: 1_100,
        latencyMs: 250,
      },
    ],
    ...overrides,
  }
}

function noRepairOperation(): WriterLengthRepairDiagnosticOperation {
  const first = operation().calls[0]!
  return operation({
    firstPassWordCount: 900,
    firstPassOutcome: 'ACCEPTED',
    repairEligible: false,
    repairAttempted: false,
    repairWordCount: null,
    repairOutcome: 'NOT_ATTEMPTED',
    writerInferenceCount: 1,
    calls: [first],
  })
}

describe('WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1', () => {
  it('freezes five synthetic operations, exact candidate, runtime, budgets, and no side effects', () => {
    expect(WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG).toEqual({
      track: 'WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1',
      modelId: 'meta/muse-spark-1.2-contributor',
      fixtureClassification: 'SYNTHETIC',
      reasoningEffort: 'minimal',
      maxOutputTokens: 4096,
      timeoutMs: 120_000,
      streaming: true,
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
  })

  it('recreates chapter-safe fixtures and exact frozen prompt hashes', async () => {
    const prepared = await prepareWriterLengthRepairCausalDiagnostic()

    expect(prepared.fixtures.map(({ key, chapterNumber }) => [key, chapterNumber])).toEqual([
      ['EARLY', 1],
      ['DIALOGUE', 8],
      ['MYSTERY', 12],
      ['EMOTIONAL', 25],
      ['LATER_ACT', 45],
    ])
    expect(Object.fromEntries(prepared.fixtures.map((fixture) => [fixture.key, fixture.promptSha256])))
      .toEqual(EXPECTED_HASHES)
    expect(prepared.manifestSha256)
      .toBe('9b10a0b8f878b877ddfa1c8174ad22d114736c0482945a6cdef7ac21addd5e22')
    expect(prepared.fixtures[0]?.previousChapterNumber).toBeNull()
    expect(prepared.fixtures[1]?.contextSafety).toBe('PRE_GATE_NOTARY_ONLY')
    expect(prepared.fixtures[2]?.contextSafety).toBe('REVEAL_AWARE')
    expect(prepared.fixtures[4]?.completedActRollupCount).toBe(6)
  })

  it('preflights with zero provider calls and fails closed unless production flag is off', async () => {
    const provider = { writeChapter: vi.fn() }
    const pass = await preflightWriterLengthRepairCausalDiagnostic({
      productionRepairFlag: undefined,
      diagnosticChildFlag: '1',
      credentialAvailable: true,
    })

    expect(pass.ok).toBe(true)
    expect(pass.providerCalls).toBe(0)
    expect(pass.credentialAvailable).toBe(true)
    expect(provider.writeChapter).not.toHaveBeenCalled()
    for (const productionRepairFlag of ['1', 'true', 'false', '0', '']) {
      await expect(preflightWriterLengthRepairCausalDiagnostic({
        productionRepairFlag,
        diagnosticChildFlag: '1',
        credentialAvailable: true,
      })).rejects.toThrow('CAUSAL_DIAGNOSTIC_PRODUCTION_FLAG_MUST_BE_OFF')
    }
    await expect(preflightWriterLengthRepairCausalDiagnostic({
      productionRepairFlag: undefined,
      diagnosticChildFlag: undefined,
      credentialAvailable: true,
    })).rejects.toThrow('CAUSAL_DIAGNOSTIC_CHILD_PROCESS_REQUIRED')
  })

  it('runs exactly five operations sequentially and reports metadata only', async () => {
    let active = 0
    let maxActive = 0
    const seen: Array<[string, number]> = []
    const executeOperation = vi.fn(async (input: { fixtureKey: string; chapterNumber: number }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      seen.push([input.fixtureKey, input.chapterNumber])
      await Promise.resolve()
      active -= 1
      return operation()
    })

    const report = await runWriterLengthRepairCausalDiagnostic({
      productionRepairFlag: undefined,
      diagnosticChildFlag: '1',
      credentialAvailable: true,
      executeOperation,
    })

    expect(executeOperation).toHaveBeenCalledTimes(5)
    expect(maxActive).toBe(1)
    expect(seen).toEqual([
      ['EARLY', 1], ['DIALOGUE', 8], ['MYSTERY', 12], ['EMOTIONAL', 25], ['LATER_ACT', 45],
    ])
    expect(report.classification).toBe('STRONG_POSITIVE')
    expect(report.aggregate).toMatchObject({
      operationCount: 5,
      FIRST_PASS_WRITER_SUCCESS: 0,
      FINAL_WRITER_SUCCESS: 5,
      REPAIR_ELIGIBLE_COUNT: 5,
      REPAIR_ATTEMPT_COUNT: 5,
      REPAIR_SUCCESS_RATE: 1,
      TOTAL_INFERENCE_COUNT: 10,
      maxTwoInferenceCount: 5,
      parserRegressionCount: 0,
      closureRegressionCount: 0,
      databaseCalls: 0,
      publicationCalls: 0,
    })
    const serialized = JSON.stringify(report).toLowerCase()
    for (const forbidden of ['prompt', 'paragraphs', 'prose', 'title', 'canon', 'rawresponse', 'raw_response']) {
      expect(serialized).not.toContain(`"${forbidden}`)
    }
  })

  it('calls provider.writeChapter with treatment prompt and repair policy, never generateChapter', async () => {
    const prepared = await prepareWriterLengthRepairCausalDiagnostic()
    const provider = {
      name: 'fake-gateway',
      generatePlan: vi.fn(),
      writeChapter: vi.fn(async (_input, options) => {
        options?.observeWriterRuntime?.({
          timeoutMs: 120_000,
          streaming: true,
          maxRetries: 0,
          maxOutputTokens: 4096,
          temperature: null,
        })
        options?.observeModelCall?.({
          actualProviderId: 'openrouter',
          actualModelId: 'meta/muse-spark-1.2-contributor',
          actualModelResolved: true,
          endedAt: '2026-09-03T00:00:00.000Z',
          elapsedMs: 200,
          outcome: 'SUCCEEDED',
          errorCode: null,
          inputTokenCount: 500,
          outputTokenCount: 1_000,
          totalTokenCount: 1_500,
          providerActualCostAmount: null,
          providerActualCostCurrency: null,
          validationStage: null,
          validationCodes: null,
          finishReason: 'stop',
        })
        options?.observeWriterParserOutcome?.('ACCEPTED')
        options?.observeWriterEvaluation?.({
          completenessPassed: true,
          completenessCodes: [],
          wordCount: 900,
          requiredSectionsPresent: true,
          terminalClosurePresent: true,
        })
        options?.observeWriterLengthRepair?.({
          firstPassOutcome: 'ACCEPTED',
          repairAttempted: false,
          repairOutcome: 'NOT_ATTEMPTED',
          finalWriterOutcome: 'ACCEPTED',
        })
        return {}
      }),
    }

    const result = await executeWriterLengthRepairDiagnosticOperation({
      fixture: prepared.fixtures[0]!,
      provider,
    })

    expect(provider.writeChapter).toHaveBeenCalledOnce()
    const options = provider.writeChapter.mock.calls[0]?.[1]
    expect(options?.writerLengthRepairV1).toEqual({ enabled: true })
    expect(options?.callBudget).toEqual({ used: 0, max: 2 })
    expect(options?.writerInferenceBudget).toEqual({ used: 0, max: 2 })
    expect(options?.diagnosticChapterWriterPromptOverride?.prompt)
      .toBe(prepared.fixtures[0]?.prompt)
    expect(result).toMatchObject({ writerInferenceCount: 1, finalWriterOutcome: 'ACCEPTED' })
  })

  it('can disable provider-call persistence for offline diagnostic observation', async () => {
    const record = vi.fn()
    const input = {
      context: {
        userId: '00000000-0000-4000-8000-000000000001',
        storyId: 'fixture:synthetic',
        chapterNumber: 1,
        generationKind: 'standard' as const,
        jobId: null,
        correlationId: '00000000-0000-4000-8000-000000000002',
        attemptNumber: null,
      },
      candidate: {
        providerId: 'openrouter',
        configuredModelId: 'meta/muse-spark-1.2-contributor',
        routeVersion: 'diagnostic-v1',
        fallbackIndex: 0,
      },
      useCase: 'chapter_prose',
      workflowPhase: 'FIRST_PASS',
      call: () => ({
        text: Promise.resolve('visible'),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        finalStep: Promise.resolve({ finishReason: 'stop', response: {} }),
      }) as never,
      consume: (text: string) => text,
      persistObservation: false,
    }

    await executeObservedModelCall(input, {
      createId: () => 'provider-call-id',
      now: () => new Date('2026-09-03T00:00:00.000Z'),
      monotonicNow: () => 1,
      record,
      recorderTimeoutMs: 10,
    })

    expect(record).not.toHaveBeenCalled()
  })

  it('classifies insufficient and negative thresholds without optimistic gaps', () => {
    expect(classifyWriterLengthRepairDiagnostic([
      noRepairOperation(),
      noRepairOperation(),
      noRepairOperation(),
      noRepairOperation(),
      noRepairOperation(),
    ])).toBe('INSUFFICIENT_REPAIR_OPPORTUNITY')

    const failedRepair = operation({
      repairWordCount: 760,
      repairOutcome: 'REJECTED',
      finalWriterOutcome: 'REJECTED',
    })
    expect(classifyWriterLengthRepairDiagnostic([
      operation(), operation(), failedRepair, failedRepair, noRepairOperation(),
    ])).toBe('NEGATIVE')
  })

  it('fails negative on parser or closure damage and rejects invalid inference accounting', () => {
    const damaged = operation({
      repairOutcome: 'REJECTED',
      finalWriterOutcome: 'REJECTED',
      calls: [operation().calls[0]!, {
        ...operation().calls[1]!,
        parserOutcome: 'REJECTED',
        terminalClosurePresent: false,
      }],
    })
    expect(classifyWriterLengthRepairDiagnostic([damaged, operation(), operation(), operation(), operation()]))
      .toBe('NEGATIVE')
    expect(() => classifyWriterLengthRepairDiagnostic([
      operation({ writerInferenceCount: 3 }), operation(), operation(), operation(), operation(),
    ])).toThrow('CAUSAL_DIAGNOSTIC_INFERENCE_BUDGET_BREACH')
    expect(() => classifyWriterLengthRepairDiagnostic([
      operation({ writerInferenceCount: 0, calls: [] }), operation(), operation(), operation(), operation(),
    ])).toThrow('CAUSAL_DIAGNOSTIC_INFERENCE_ACCOUNTING_MISMATCH')
    expect(() => classifyWriterLengthRepairDiagnostic([
      operation({ writerInferenceCount: 1 }), operation(), operation(), operation(), operation(),
    ])).toThrow('CAUSAL_DIAGNOSTIC_INFERENCE_ACCOUNTING_MISMATCH')
    expect(() => classifyWriterLengthRepairDiagnostic([
      operation({ repairAttempted: false, repairOutcome: 'NOT_ATTEMPTED', writerInferenceCount: 1, calls: [operation().calls[0]!] }),
      operation(), operation(), operation(), operation(),
    ])).toThrow('CAUSAL_DIAGNOSTIC_ELIGIBLE_REPAIR_MISSING')
  })
})
