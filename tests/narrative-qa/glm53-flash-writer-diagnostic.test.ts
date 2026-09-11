import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import type { GenerationProvider, ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'
import {
  GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG,
  GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY,
  assertGlm53FlashWriterDiagnosticSerialization,
  classifyGlm53FlashWriterDiagnostic,
  createGlm53FlashWriterDiagnosticRoute,
  executeGlm53FlashWriterDiagnostic,
  prepareGlm53FlashWriterDiagnostic,
  preflightGlm53FlashWriterDiagnostic,
  type Glm53FlashWriterDiagnosticObservation,
} from '@/lib/narrative-qa/harness/glm53-flash-writer-diagnostic.server'

const EXPECTED_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'

function observation(
  wordCount: number | null,
  overrides: Partial<Glm53FlashWriterDiagnosticObservation> = {},
): Glm53FlashWriterDiagnosticObservation {
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

function fakeProvider(result: Glm53FlashWriterDiagnosticObservation): GenerationProvider & {
  writeChapter: ReturnType<typeof vi.fn>
} {
  return {
    name: 'fake-glm53-diagnostic',
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
        actualModelId: 'z-ai/glm-5.3-flash',
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

describe('GLM53_FLASH_WRITER_DIAGNOSTIC_V1', () => {
  it('freezes exact catalog authority, model policy, topology, and runtime', () => {
    expect(GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG).toEqual({
      track: 'GLM53_FLASH_WRITER_DIAGNOSTIC_V1',
      fixtureClassification: 'SYNTHETIC',
      genre: 'MYSTERY',
      chapterNumber: 12,
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
    expect(GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY.source)
      .toBe('OpenRouter GET /api/v1/models + /api/v1/models/z-ai/glm-5.3-flash/endpoints')
    expect(GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY.observedOn).toBe('2026-09-03')
    expect(createGlm53FlashWriterDiagnosticRoute()).toEqual({
      useCase: 'chapter_prose',
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.3-flash',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'low',
      routeVersion: 'glm53-flash-writer-diagnostic-v1',
    })
  })

  it('builds only unchanged production MYSTERY Bab 12 prompt with frozen hash', async () => {
    const prepared = await prepareGlm53FlashWriterDiagnostic()

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
    await expect(preflightGlm53FlashWriterDiagnostic(authorityInput)).resolves.toMatchObject({
      ok: true,
      providerCalls: 0,
      promptSha256: EXPECTED_PROMPT_SHA256,
    })
    expect(providerCall).not.toHaveBeenCalled()

    await expect(preflightGlm53FlashWriterDiagnostic({
      ...authorityInput, credentialAvailable: false,
    })).rejects.toThrow('GLM53_DIAGNOSTIC_CREDENTIAL_MISSING')
    await expect(preflightGlm53FlashWriterDiagnostic({
      ...authorityInput, diagnosticChildFlag: undefined,
    })).rejects.toThrow('GLM53_DIAGNOSTIC_CHILD_PROCESS_REQUIRED')
    for (const productionRepairFlag of ['', '0', 'false', '1', 'true']) {
      await expect(preflightGlm53FlashWriterDiagnostic({
        ...authorityInput, productionRepairFlag,
      })).rejects.toThrow('GLM53_DIAGNOSTIC_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
    }
    await expect(preflightGlm53FlashWriterDiagnostic({
      ...authorityInput, expectedPromptSha256: 'wrong',
    })).rejects.toThrow('GLM53_DIAGNOSTIC_PROMPT_HASH_MISMATCH')
    await expect(preflightGlm53FlashWriterDiagnostic({
      ...authorityInput,
      metadataAuthority: { ...GLM53_FLASH_WRITER_DIAGNOSTIC_METADATA_AUTHORITY, canonicalSlug: 'wrong' },
    })).rejects.toThrow('GLM53_DIAGNOSTIC_METADATA_AUTHORITY_MISMATCH')
    await expect(preflightGlm53FlashWriterDiagnostic({
      ...authorityInput,
      route: { ...createGlm53FlashWriterDiagnosticRoute(), fallbackModels: [{ provider: 'openrouter', modelId: 'x/y' }] },
    })).rejects.toThrow('GLM53_DIAGNOSTIC_ROUTE_MISMATCH')
    await expect(preflightGlm53FlashWriterDiagnostic({
      ...authorityInput,
      runtime: { timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 2048, temperature: null },
    })).rejects.toThrow('GLM53_DIAGNOSTIC_RUNTIME_MISMATCH')
  })

  it.each([
    [900, 'PASS_ADVANCE_TO_5_FIXTURE'],
    [750, 'NEAR_MISS_5_FIXTURE_ALLOWED'],
    [799, 'NEAR_MISS_5_FIXTURE_ALLOWED'],
    [1001, 'NEAR_MISS_5_FIXTURE_ALLOWED'],
    [1050, 'NEAR_MISS_5_FIXTURE_ALLOWED'],
    [749, 'STOP_MODEL_WRITER_TRACK'],
    [1051, 'STOP_MODEL_WRITER_TRACK'],
  ] as const)('classifies completed %i-word output as %s', (wordCount, expected) => {
    expect(classifyGlm53FlashWriterDiagnostic(observation(wordCount))).toBe(expected)
  })

  it('classifies cap, empty, parser, transport, closure, and non-length findings as layer stops', () => {
    expect(classifyGlm53FlashWriterDiagnostic(observation(null, {
      parserOutcome: 'REJECTED', completenessPassed: null, completenessCodes: [],
      paragraphCount: null, requiredSectionsPresent: null, terminalClosurePresent: null,
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyGlm53FlashWriterDiagnostic(observation(900, {
      finishReason: 'length', completenessPassed: false,
      completenessCodes: ['WRITER_OUTPUT_CAPPED'],
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyGlm53FlashWriterDiagnostic(observation(900, {
      terminalClosurePresent: false, completenessPassed: false,
      completenessCodes: ['WRITER_TERMINAL_CLOSURE_MISSING'],
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyGlm53FlashWriterDiagnostic(observation(null, {
      transportOutcome: 'PROVIDER_ERROR', parserOutcome: 'NOT_REACHED',
      completenessPassed: null, completenessCodes: [], paragraphCount: null,
      requiredSectionsPresent: null, terminalClosurePresent: null, finishReason: null,
    }))).toBe('STOP_CLASSIFY_LAYER')
  })

  it.each([
    ['accepted', observation(900), 'PASS_ADVANCE_TO_5_FIXTURE'],
    ['near miss', observation(780), 'NEAR_MISS_5_FIXTURE_ALLOWED'],
    ['severe miss', observation(700), 'STOP_MODEL_WRITER_TRACK'],
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
    const report = await executeGlm53FlashWriterDiagnostic({ ...authorityInput, provider })

    expect(provider.writeChapter).toHaveBeenCalledOnce()
    const options = provider.writeChapter.mock.calls[0]?.[1]
    expect(options).not.toHaveProperty('writerLengthRepairV1')
    expect(options?.callBudget).toEqual({ used: 1, max: 1 })
    expect(options?.writerInferenceBudget).toEqual({ used: 1, max: 1 })
    expect(options?.diagnosticChapterWriterPromptOverride).toMatchObject({
      invocation: 'GLM53_FLASH_WRITER_DIAGNOSTIC_V1',
    })
    expect(report.inferenceCount).toBe(1)
    expect(report.databaseCalls).toBe(0)
    expect(report.publicationCalls).toBe(0)
    expect(report.classification).toBe(classification)
    expect(() => assertGlm53FlashWriterDiagnosticSerialization(report)).not.toThrow()
  })

  it('blocks any attempted second inference before provider transport', async () => {
    const prepared = await prepareGlm53FlashWriterDiagnostic()
    const transport = vi.fn()
    const provider = fakeProvider(observation(900))
    provider.writeChapter.mockImplementationOnce(async (_input, options?: ModelCallExecutionOptions) => {
      const callBudget = options?.callBudget
      const writerBudget = options?.writerInferenceBudget
      if (!callBudget || !writerBudget) throw new Error('missing budgets')
      const invoke = () => {
        if (callBudget.used >= callBudget.max || writerBudget.used >= writerBudget.max) {
          throw new Error('GLM53_DIAGNOSTIC_INFERENCE_BUDGET_EXHAUSTED')
        }
        callBudget.used += 1
        writerBudget.used += 1
        transport()
      }
      invoke()
      expect(() => invoke()).toThrow('GLM53_DIAGNOSTIC_INFERENCE_BUDGET_EXHAUSTED')
      options?.observeWriterRuntime?.({ timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 4096, temperature: null })
      options?.observeWriterParserOutcome?.('ACCEPTED')
      options?.observeWriterEvaluation?.({ completenessPassed: true, completenessCodes: [], wordCount: 900, paragraphCount: 20, requiredSectionsPresent: true, terminalClosurePresent: true })
      options?.observeModelCall?.({ actualProviderId: 'openrouter', actualModelId: 'z-ai/glm-5.3-flash', actualModelResolved: true, endedAt: '2026-09-03T00:00:00.000Z', elapsedMs: 1, outcome: 'SUCCEEDED', errorCode: null, inputTokenCount: 1, outputTokenCount: 1, totalTokenCount: 2, providerActualCostAmount: null, providerActualCostCurrency: null, validationStage: null, validationCodes: null, finishReason: 'stop' })
      return prepared.fixture
    })

    await executeGlm53FlashWriterDiagnostic({ ...authorityInput, provider })
    expect(transport).toHaveBeenCalledOnce()
  })

  it('rejects runtime/model authority errors and forbidden serialization keys', async () => {
    const runtimeMismatch = fakeProvider(observation(900))
    runtimeMismatch.writeChapter.mockImplementationOnce(async (_input, options?: ModelCallExecutionOptions) => {
      options?.observeWriterRuntime?.({ timeoutMs: 120_000, streaming: true, maxRetries: 0, maxOutputTokens: 2048, temperature: null })
      return {}
    })
    await expect(executeGlm53FlashWriterDiagnostic({ ...authorityInput, provider: runtimeMismatch }))
      .rejects.toThrow('GLM53_DIAGNOSTIC_RUNTIME_MISMATCH')

    expect(() => assertGlm53FlashWriterDiagnosticSerialization({
      track: 'GLM53_FLASH_WRITER_DIAGNOSTIC_V1', raw_response: 'forbidden',
    })).toThrow('GLM53_DIAGNOSTIC_FORBIDDEN_ARTIFACT_KEY')
    for (const key of ['prompt', 'system', 'prose', 'paragraphs', 'title', 'rawresponse', 'reasoningText', 'canon']) {
      expect(() => assertGlm53FlashWriterDiagnosticSerialization({ [key]: 'forbidden' }))
        .toThrow('GLM53_DIAGNOSTIC_FORBIDDEN_ARTIFACT_KEY')
    }
  })
})
