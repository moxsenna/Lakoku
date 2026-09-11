import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import type { GenerationProvider, ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'
import {
  GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG,
  GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY,
  assertGpt56SolWriterControlDiagnosticSerialization,
  classifyGpt56SolWriterControlDiagnostic,
  createGpt56SolWriterControlDiagnosticRoute,
  executeGpt56SolWriterControlDiagnostic,
  prepareGpt56SolWriterControlDiagnostic,
  preflightGpt56SolWriterControlDiagnostic,
  type Gpt56SolWriterControlDiagnosticObservation,
} from '@/lib/narrative-qa/harness/gpt56-sol-writer-control-diagnostic.server'

const EXPECTED_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'

function observation(
  wordCount: number | null,
  overrides: Partial<Gpt56SolWriterControlDiagnosticObservation> = {},
): Gpt56SolWriterControlDiagnosticObservation {
  const lengthOnly = wordCount !== null && (wordCount < 800 || wordCount > 1000)
  return {
    transportOutcome: 'SUCCEEDED',
    parserOutcome: 'ACCEPTED',
    completenessPassed: !lengthOnly,
    completenessCodes: lengthOnly ? ['WRITER_LENGTH_OUT_OF_RANGE'] : [],
    wordCount,
    paragraphCount: wordCount === null ? null : 20,
    requiredSectionsPresent: true,
    terminalClosurePresent: true,
    finishReason: 'stop',
    reasoningTokenCount: 120,
    completionTokenCount: 1_100,
    latencyMs: 250,
    ...overrides,
  }
}

function fakeProvider(result: Gpt56SolWriterControlDiagnosticObservation): GenerationProvider & {
  writeChapter: ReturnType<typeof vi.fn>
} {
  return {
    name: 'fake-gpt56-sol-diagnostic',
    generatePlan: vi.fn(),
    writeChapter: vi.fn(async (_input, options?: ModelCallExecutionOptions) => {
      if (!options?.callBudget || !options.writerInferenceBudget) throw new Error('missing budgets')
      options.callBudget.used += 1
      options.writerInferenceBudget.used += 1
      options.observeWriterRuntime?.({
        timeoutMs: 120_000,
        streaming: true,
        maxRetries: 0,
        maxOutputTokens: 4096,
        temperature: null,
      })
      options?.observeReasoningBudget?.({
        reasoningTokenCount: result.reasoningTokenCount,
        reasoningFieldPresent: result.reasoningTokenCount !== null,
        reasoningDetailsPresent: result.reasoningTokenCount !== null,
        visibleContentChars: 8_000,
        completionTokenCount: result.completionTokenCount,
        finishReason: result.finishReason ?? undefined,
      })
      options?.observeWriterParserOutcome?.(
        result.parserOutcome === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
      )
      if (result.wordCount !== null && result.paragraphCount !== null) {
        options?.observeWriterEvaluation?.({
          completenessPassed: result.completenessPassed === true,
          completenessCodes: [...result.completenessCodes],
          wordCount: result.wordCount,
          paragraphCount: result.paragraphCount,
          requiredSectionsPresent: result.requiredSectionsPresent === true,
          terminalClosurePresent: result.terminalClosurePresent === true,
        })
      }
      options?.observeModelCall?.({
        actualProviderId: 'openrouter',
        actualModelId: 'openai/gpt-5.6-sol',
        actualModelResolved: true,
        endedAt: '2026-09-03T00:00:00.000Z',
        elapsedMs: result.latencyMs,
        outcome: result.transportOutcome === 'NOT_COMPLETED' ? 'PROVIDER_ERROR' : result.transportOutcome,
        errorCode: result.transportOutcome === 'SUCCEEDED' ? null : 'PROVIDER_REQUEST_FAILED',
        inputTokenCount: 500,
        outputTokenCount: result.completionTokenCount,
        totalTokenCount: null,
        providerActualCostAmount: null,
        providerActualCostCurrency: null,
        validationStage: null,
        validationCodes: null,
        finishReason: result.finishReason ?? undefined,
      })
      if (result.transportOutcome !== 'SUCCEEDED') throw new Error('synthetic transport failure')
      if (result.parserOutcome !== 'ACCEPTED') throw new Error('synthetic parser failure')
      if (!result.completenessPassed) throw new Error('synthetic completeness failure')
      return { discarded: true }
    }),
  }
}

const authorityInput = {
  productionRepairFlag: undefined,
  diagnosticChildFlag: '1',
  credentialAvailable: true,
} as const

describe('GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1', () => {
  it('freezes exact catalog authority, model policy, topology, and runtime', () => {
    expect(GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG).toEqual({
      track: 'GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1',
      experimentType: 'CONTROL',
      qualificationAllowed: false,
      fixtureClassification: 'SYNTHETIC',
      genre: 'MYSTERY',
      chapterNumber: 12,
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
      promptTarget: '850–950',
      hardAcceptance: '800–1000',
      fallbackModels: [],
      maxOutputTokens: 4096,
      timeoutMs: 120_000,
      streaming: true,
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
    expect(GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY.source)
      .toBe('OpenRouter GET /api/v1/models + /api/v1/models/openai/gpt-5.6-sol/endpoints')
    expect(GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY.observedOn).toBe('2026-09-03')
    expect(createGpt56SolWriterControlDiagnosticRoute()).toEqual({
      useCase: 'chapter_prose',
      provider: 'openrouter',
      modelId: 'openai/gpt-5.6-sol',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'none',
      routeVersion: 'gpt56-sol-writer-control-diagnostic-v1',
    })
  })

  it('keeps runner preflight artifact-free and terminal output result-only', () => {
    const runner = readFileSync(path.resolve(
      process.cwd(),
      'scripts/gpt56-sol-writer-control-diagnostic.ts',
    ), 'utf8')
    const preflightBranch = runner.slice(
      runner.indexOf('if (preflightOnly)'),
      runner.indexOf('const route ='),
    )

    expect(preflightBranch).not.toMatch(/mkdirSync|writeFileSync/)
    expect(runner.match(/writeFileSync\(/g)).toHaveLength(1)
    expect(runner).toContain("path.join(ARTIFACT_DIR, 'result.json')")
  })

  it('builds only unchanged production MYSTERY Bab 12 prompt with frozen hash', async () => {
    const prepared = await prepareGpt56SolWriterControlDiagnostic()

    expect(prepared.fixture).toMatchObject({
      fixtureClassification: 'SYNTHETIC',
      genre: 'MYSTERY',
      chapterNumber: 12,
      promptSha256: EXPECTED_PROMPT_SHA256,
    })
    expect(prepared.prompt).toContain('target 850–950;')
    expect(prepared.prompt).not.toContain('target 950–1050;')
  })

  it('preflights with zero calls and fails closed on every authority input', async () => {
    const providerCall = vi.fn()
    await expect(preflightGpt56SolWriterControlDiagnostic(authorityInput)).resolves.toMatchObject({
      ok: true,
      providerCalls: 0,
      promptSha256: EXPECTED_PROMPT_SHA256,
    })
    expect(providerCall).not.toHaveBeenCalled()

    await expect(preflightGpt56SolWriterControlDiagnostic({
      ...authorityInput, credentialAvailable: false,
    })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_CREDENTIAL_MISSING')
    await expect(preflightGpt56SolWriterControlDiagnostic({
      ...authorityInput, diagnosticChildFlag: undefined,
    })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_CHILD_PROCESS_REQUIRED')
    for (const productionRepairFlag of ['', '0', 'false', '1', 'true']) {
      await expect(preflightGpt56SolWriterControlDiagnostic({
        ...authorityInput, productionRepairFlag,
      })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
    }
    await expect(preflightGpt56SolWriterControlDiagnostic({
      ...authorityInput, expectedPromptSha256: 'wrong',
    })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_PROMPT_HASH_MISMATCH')
    await expect(preflightGpt56SolWriterControlDiagnostic({
      ...authorityInput,
      metadataAuthority: { ...GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY, canonicalSlug: 'wrong' },
    })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_METADATA_AUTHORITY_MISMATCH')
    await expect(preflightGpt56SolWriterControlDiagnostic({
      ...authorityInput,
      route: { ...createGpt56SolWriterControlDiagnosticRoute(), fallbackModels: [{ provider: 'openrouter', modelId: 'x/y' }] },
    })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_ROUTE_MISMATCH')
    await expect(preflightGpt56SolWriterControlDiagnostic({
      ...authorityInput,
      runtime: { timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 2048, temperature: null },
    })).rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_RUNTIME_MISMATCH')
  })

  it.each([
    [900, 'PRODUCTION_PROMPT_IS_CAPABLE'],
    [750, 'NEAR_MISS_REVIEW_REQUIRED'],
    [799, 'NEAR_MISS_REVIEW_REQUIRED'],
    [1001, 'NEAR_MISS_REVIEW_REQUIRED'],
    [1050, 'NEAR_MISS_REVIEW_REQUIRED'],
    [749, 'WRITER_PROMPT_ARCHITECTURE_REVIEW'],
    [1051, 'WRITER_PROMPT_ARCHITECTURE_REVIEW'],
  ] as const)('classifies completed %i-word output as %s', (wordCount, expected) => {
    expect(classifyGpt56SolWriterControlDiagnostic(observation(wordCount))).toBe(expected)
  })

  it('classifies gateway INVALID_RESPONSE length-only evaluations by word count', () => {
    expect(classifyGpt56SolWriterControlDiagnostic(observation(780, {
      transportOutcome: 'INVALID_RESPONSE',
    }))).toBe('NEAR_MISS_REVIEW_REQUIRED')
    expect(classifyGpt56SolWriterControlDiagnostic(observation(700, {
      transportOutcome: 'INVALID_RESPONSE',
    }))).toBe('WRITER_PROMPT_ARCHITECTURE_REVIEW')
  })

  it('classifies cap, empty, parser, transport, closure, and non-length findings as layer stops', () => {
    expect(classifyGpt56SolWriterControlDiagnostic(observation(null, {
      parserOutcome: 'REJECTED', completenessPassed: null, completenessCodes: [],
      paragraphCount: null, requiredSectionsPresent: null, terminalClosurePresent: null,
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyGpt56SolWriterControlDiagnostic(observation(900, {
      finishReason: 'length', completenessPassed: false,
      completenessCodes: ['WRITER_OUTPUT_CAPPED'],
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyGpt56SolWriterControlDiagnostic(observation(900, {
      terminalClosurePresent: false, completenessPassed: false,
      completenessCodes: ['WRITER_TERMINAL_CLOSURE_MISSING'],
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyGpt56SolWriterControlDiagnostic(observation(null, {
      transportOutcome: 'PROVIDER_ERROR', parserOutcome: 'NOT_REACHED',
      completenessPassed: null, completenessCodes: [], paragraphCount: null,
      requiredSectionsPresent: null, terminalClosurePresent: null, finishReason: null,
    }))).toBe('STOP_CLASSIFY_LAYER')
  })

  it.each([
    ['accepted', observation(900), 'PRODUCTION_PROMPT_IS_CAPABLE'],
    ['near miss', observation(780), 'NEAR_MISS_REVIEW_REQUIRED'],
    ['severe miss', observation(700), 'WRITER_PROMPT_ARCHITECTURE_REVIEW'],
    ['parser anomaly', observation(null, {
      parserOutcome: 'REJECTED', completenessPassed: null, completenessCodes: [],
      paragraphCount: null, requiredSectionsPresent: null, terminalClosurePresent: null,
    }), 'STOP_CLASSIFY_LAYER'],
    ['transport anomaly', observation(null, {
      transportOutcome: 'PROVIDER_ERROR', parserOutcome: 'NOT_REACHED',
      completenessPassed: null, completenessCodes: [], paragraphCount: null,
      requiredSectionsPresent: null, terminalClosurePresent: null, finishReason: null,
    }), 'STOP_CLASSIFY_LAYER'],
  ] as const)('executes exactly once for %s and returns terminal metadata', async (_name, terminal, classification) => {
    const provider = fakeProvider(terminal)
    const report = await executeGpt56SolWriterControlDiagnostic({ ...authorityInput, provider })

    expect(provider.writeChapter).toHaveBeenCalledOnce()
    const options = provider.writeChapter.mock.calls[0]?.[1]
    expect(options).not.toHaveProperty('writerLengthRepairV1')
    expect(options?.callBudget).toEqual({ used: 1, max: 1 })
    expect(options?.writerInferenceBudget).toEqual({ used: 1, max: 1 })
    expect(options?.diagnosticChapterWriterPromptOverride).toMatchObject({
      invocation: 'GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1',
    })
    expect(report.inferenceCount).toBe(1)
    expect(report.databaseCalls).toBe(0)
    expect(report.publicationCalls).toBe(0)
    expect(report.classification).toBe(classification)
    expect(() => assertGpt56SolWriterControlDiagnosticSerialization(report)).not.toThrow()
  })

  it('blocks any attempted second inference before provider transport', async () => {
    const prepared = await prepareGpt56SolWriterControlDiagnostic()
    const transport = vi.fn()
    const provider = fakeProvider(observation(900))
    provider.writeChapter.mockImplementationOnce(async (_input, options?: ModelCallExecutionOptions) => {
      const callBudget = options?.callBudget
      const writerBudget = options?.writerInferenceBudget
      if (!callBudget || !writerBudget) throw new Error('missing budgets')
      const invoke = () => {
        if (callBudget.used >= callBudget.max || writerBudget.used >= writerBudget.max) {
          throw new Error('GPT56_SOL_CONTROL_DIAGNOSTIC_INFERENCE_BUDGET_EXHAUSTED')
        }
        callBudget.used += 1
        writerBudget.used += 1
        transport()
      }
      invoke()
      expect(() => invoke()).toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_INFERENCE_BUDGET_EXHAUSTED')
      options?.observeWriterRuntime?.({ timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 4096, temperature: null })
      options?.observeWriterParserOutcome?.('ACCEPTED')
      options?.observeWriterEvaluation?.({ completenessPassed: true, completenessCodes: [], wordCount: 900, paragraphCount: 20, requiredSectionsPresent: true, terminalClosurePresent: true })
      options?.observeModelCall?.({ actualProviderId: 'openrouter', actualModelId: 'openai/gpt-5.6-sol', actualModelResolved: true, endedAt: '2026-09-03T00:00:00.000Z', elapsedMs: 1, outcome: 'SUCCEEDED', errorCode: null, inputTokenCount: 1, outputTokenCount: 1, totalTokenCount: 2, providerActualCostAmount: null, providerActualCostCurrency: null, validationStage: null, validationCodes: null, finishReason: 'stop' })
      return prepared.fixture
    })

    await executeGpt56SolWriterControlDiagnostic({ ...authorityInput, provider })
    expect(transport).toHaveBeenCalledOnce()
  })

  it('rejects runtime/model authority errors and forbidden serialization keys', async () => {
    const runtimeMismatch = fakeProvider(observation(900))
    runtimeMismatch.writeChapter.mockImplementationOnce(async (_input, options?: ModelCallExecutionOptions) => {
      options?.observeWriterRuntime?.({ timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 2048, temperature: null })
      return {}
    })
    await expect(executeGpt56SolWriterControlDiagnostic({ ...authorityInput, provider: runtimeMismatch }))
      .rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_RUNTIME_MISMATCH')

    const modelMismatch = fakeProvider(observation(900))
    modelMismatch.writeChapter.mockImplementationOnce(async (_input, options?: ModelCallExecutionOptions) => {
      if (options?.callBudget) options.callBudget.used += 1
      if (options?.writerInferenceBudget) options.writerInferenceBudget.used += 1
      options?.observeWriterRuntime?.({ timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 4096, temperature: null })
      options?.observeModelCall?.({ actualProviderId: 'openrouter', actualModelId: 'inferred/model', actualModelResolved: true, endedAt: '2026-09-03T00:00:00.000Z', elapsedMs: 1, outcome: 'SUCCEEDED', errorCode: null, inputTokenCount: 1, outputTokenCount: 1, totalTokenCount: 2, providerActualCostAmount: null, providerActualCostCurrency: null, validationStage: null, validationCodes: null, finishReason: 'stop' })
      return {}
    })
    await expect(executeGpt56SolWriterControlDiagnostic({ ...authorityInput, provider: modelMismatch }))
      .rejects.toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_MODEL_IDENTITY_MISMATCH')

    expect(() => assertGpt56SolWriterControlDiagnosticSerialization({
      track: 'GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1',
      experimentType: 'CONTROL',
      qualificationAllowed: false,
      raw_response: 'forbidden',
    })).toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_FORBIDDEN_ARTIFACT_KEY')
    for (const key of ['prompt', 'system', 'prose', 'paragraphs', 'title', 'rawresponse', 'reasoningText', 'canon']) {
      expect(() => assertGpt56SolWriterControlDiagnosticSerialization({ [key]: 'forbidden' }))
        .toThrow('GPT56_SOL_CONTROL_DIAGNOSTIC_FORBIDDEN_ARTIFACT_KEY')
    }
  })
})
