import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type {
  GenerationProvider,
  ModelCallExecutionOptions,
} from '@lakoku/ai-gateway'
import type { ProviderCallOutcome } from '@/lib/observability/generation-provider-call.contract'
import {
  WRITER_V2_FLAGSHIP_CONTROL_CONFIG,
  assertWriterV2FlagshipControlSerialization,
  classifyWriterV2FlagshipControl,
  createWriterV2FlagshipControlRoute,
  executeWriterV2FlagshipControl,
  prepareWriterV2FlagshipControl,
  preflightWriterV2FlagshipControl,
  type WriterV2ControlObservation,
} from '@/lib/narrative-qa/harness/writer-v2-flagship-control.server'

const EXPECTED_PROJECTION_HASH = '149ccdf1ecf1c3093748e5087ae5be66a55bcdd3032c3e0a11671732856e0a0d'
const authorityInput = {
  childFlag: '1',
  credentialAvailable: true,
  expectedProjectionHash: EXPECTED_PROJECTION_HASH,
} as const

type FakeSpec = Readonly<{
  transport?: ProviderCallOutcome
  responseModel?: string
  finishReason?: string
  parserOutcome?: 'ACCEPTED' | 'REJECTED'
  completenessPassed?: boolean
  completenessCodes?: string[]
  wordCount?: number
  paragraphCount?: number
  sections?: boolean
  closure?: boolean
  scheduledReveal?: boolean
  layerA?: boolean
  leak?: boolean
  internalIdCount?: number
  throwAfterObservation?: boolean
}>

function fakeProvider(spec: FakeSpec = {}): GenerationProvider & {
  writeChapter: ReturnType<typeof vi.fn>
} {
  return {
    name: 'writer-v2-flagship-fake',
    generatePlan: vi.fn(),
    writeChapter: vi.fn(async (_input, options?: ModelCallExecutionOptions) => {
      if (!options?.callBudget || !options.writerInferenceBudget) throw new Error('budgets missing')
      options.callBudget.used += 1
      options.writerInferenceBudget.used += 1
      options.observeWriterRuntime?.({
        timeoutMs: 120_000,
        streaming: true,
        maxRetries: 0,
        maxOutputTokens: 4096,
        temperature: null,
      })
      const wordCount = spec.wordCount ?? 900
      const paragraphCount = spec.paragraphCount ?? 20
      const completenessPassed = spec.completenessPassed ?? (wordCount >= 800 && wordCount <= 1000)
      options.observeReasoningBudget?.({
        reasoningTokenCount: 0,
        reasoningFieldPresent: false,
        reasoningDetailsPresent: false,
        visibleContentChars: 7_500,
        completionTokenCount: 1_300,
        finishReason: spec.finishReason ?? 'stop',
      })
      options.observeWriterParserOutcome?.(spec.parserOutcome ?? 'ACCEPTED')
      options.observeWriterEvaluation?.({
        completenessPassed,
        completenessCodes: spec.completenessCodes
          ?? (completenessPassed ? [] : ['WRITER_LENGTH_OUT_OF_RANGE']),
        wordCount,
        paragraphCount,
        requiredSectionsPresent: spec.sections ?? true,
        terminalClosurePresent: spec.closure ?? true,
      })
      options.observeWriterDeterministicEvaluation?.({
        layerAPassed: spec.layerA ?? true,
        layerACodes: spec.layerA === false ? ['REVEAL_BEFORE_GATE'] : [],
        leakPassed: spec.leak ?? true,
        writerVisibleInternalIdCount: spec.internalIdCount ?? 0,
        scheduledRevealObligationCount: 1,
        scheduledRevealValidationPassed: spec.scheduledReveal ?? true,
      })
      const transport = spec.transport ?? (completenessPassed ? 'SUCCEEDED' : 'INVALID_RESPONSE')
      options.observeModelCall?.({
        actualProviderId: 'openrouter',
        actualModelId: spec.responseModel ?? 'openai/gpt-5.6-sol-20260709',
        actualModelResolved: true,
        endedAt: '2026-09-05T00:00:00.000Z',
        elapsedMs: 24_000,
        outcome: transport,
        errorCode: transport === 'SUCCEEDED' ? null : 'PROVIDER_INVALID_RESPONSE',
        inputTokenCount: 800,
        outputTokenCount: 1_300,
        totalTokenCount: 2_100,
        providerActualCostAmount: null,
        providerActualCostCurrency: null,
        validationStage: null,
        validationCodes: null,
        finishReason: spec.finishReason ?? 'stop',
      })
      if (spec.throwAfterObservation || transport !== 'SUCCEEDED') throw new Error('synthetic terminal')
      return { discarded: true }
    }),
  }
}

function observation(overrides: Partial<WriterV2ControlObservation> = {}): WriterV2ControlObservation {
  return {
    providerTransportOutcome: 'SUCCEEDED',
    requestedModel: 'openai/gpt-5.6-sol',
    configuredModel: 'openai/gpt-5.6-sol',
    responseModel: 'openai/gpt-5.6-sol-20260709',
    finishReason: 'stop',
    parserOutcome: 'ACCEPTED',
    requiredSections: true,
    terminalClosure: true,
    wordCount: 900,
    paragraphCount: 20,
    wordsPerParagraph: 45,
    writerCompletenessOutcome: 'PASSED',
    completenessCodes: [],
    scheduledReveal: { obligationCount: 1, validationOutcome: 'PASSED' },
    layerADeterministicResult: { outcome: 'PASSED', codes: [] },
    leakInternalIdResult: { outcome: 'PASSED', writerVisibleInternalIdCount: 0 },
    reasoningTokens: 0,
    completionTokens: 1_300,
    visibleContentChars: 7_500,
    latencyMs: 24_000,
    writerInferenceCount: 1,
    ...overrides,
  }
}

describe('WRITER_V2_FLAGSHIP_CONTROL_V1', () => {
  it('freezes exact Fixture V2 authority, current projection, and route', async () => {
    expect(WRITER_V2_FLAGSHIP_CONTROL_CONFIG).toMatchObject({
      fixtureKey: 'MYSTERY', genre: 'MYSTERY', chapterNumber: 12,
      authorityMode: 'CHAPTER_BRIEF_V2',
      provisionalCorpusManifestHash: '712d46e7b9a06394b98593ee537fab43c376cea4aebcc951d48b654d51ca6a2a',
      readyAuthorityManifestHash: 'be4216adc5d1b1306aef13186eddcc294fa53d4abd8bba681889c7762bde4b99',
      expectedProjectionHash: EXPECTED_PROJECTION_HASH,
      provider: 'openrouter', requestedModel: 'openai/gpt-5.6-sol',
      configuredModel: 'openai/gpt-5.6-sol',
      expectedResponseModel: 'openai/gpt-5.6-sol-20260709',
      reasoningEffort: 'none', maxOutputTokens: 4096, temperature: null,
      stream: true, timeoutMs: 120000, maxRetries: 0, fallbackModels: [],
      globalInferenceBudget: 1, repairRewriteBudget: 0,
      writerLengthRepairEnabled: false, databaseObservationEnabled: false,
      publicationAllowed: false, artifactWritingAllowed: false,
    })
    const prepared = await prepareWriterV2FlagshipControl()
    expect(prepared.projectionHash).toBe(EXPECTED_PROJECTION_HASH)
    expect(prepared.evidence).toMatchObject({
      fixtureKey: 'MYSTERY', chapterNumber: 12, qualificationAllowed: true,
      authorityMode: 'CHAPTER_BRIEF_V2', briefBindingExact: true,
      legacyFallbackUsed: false, writerVisibleInternalIdCount: 0,
      scheduledRevealProjected: true, numericParagraphControllersAbsent: true,
      targetBandPresent: true, hardBandPresent: true,
    })
    expect(createWriterV2FlagshipControlRoute()).toEqual({
      useCase: 'chapter_prose', provider: 'openrouter', modelId: 'openai/gpt-5.6-sol',
      fallbackModels: [], temperature: null, maxOutputTokens: 4096,
      reasoningEffort: 'none', routeVersion: 'writer-v2-flagship-control-v1',
    })
  })

  it('preflights all frozen gates with zero calls and no artifact', async () => {
    const result = await preflightWriterV2FlagshipControl(authorityInput)
    expect(result).toMatchObject({
      ok: true, credentialAvailable: true, providerCalls: 0,
      artifactWritten: false, projectionHash: EXPECTED_PROJECTION_HASH,
    })
    await expect(preflightWriterV2FlagshipControl({
      ...authorityInput, expectedProjectionHash: '0'.repeat(64),
    })).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_PROJECTION_HASH_MISMATCH')
    await expect(preflightWriterV2FlagshipControl({
      ...authorityInput, credentialAvailable: false,
    })).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_CREDENTIAL_MISSING')
    await expect(preflightWriterV2FlagshipControl({
      ...authorityInput, childFlag: undefined,
    })).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_CHILD_PROCESS_REQUIRED')
    await expect(preflightWriterV2FlagshipControl({
      ...authorityInput, globalInferenceBudget: 2,
    })).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_INFERENCE_BUDGET_MISMATCH')
    await expect(preflightWriterV2FlagshipControl({
      ...authorityInput, artifactWritten: true,
    })).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_PREFLIGHT_SIDE_EFFECT_MISMATCH')
  })

  it('classifies exact PM taxonomy fail closed', () => {
    expect(classifyWriterV2FlagshipControl(observation())).toBe('CONTROL_PASS')
    expect(classifyWriterV2FlagshipControl(observation({
      providerTransportOutcome: 'INVALID_RESPONSE', wordCount: 760,
      writerCompletenessOutcome: 'FAILED', completenessCodes: ['WRITER_LENGTH_OUT_OF_RANGE'],
    }))).toBe('CONTROL_LENGTH_MISS')
    expect(classifyWriterV2FlagshipControl(observation({
      scheduledReveal: { obligationCount: 1, validationOutcome: 'FAILED' },
    }))).toBe('CONTROL_AUTHORITY_MISS')
    expect(classifyWriterV2FlagshipControl(observation({
      responseModel: 'openai/gpt-5.6-sol',
    }))).toBe('CONTROL_PIPELINE_FAIL')
    expect(classifyWriterV2FlagshipControl(observation({
      parserOutcome: 'REJECTED',
    }))).toBe('CONTROL_PIPELINE_FAIL')
  })

  it('executes one provider.writeChapter with no repair and returns metadata only', async () => {
    const provider = fakeProvider()
    const report = await executeWriterV2FlagshipControl({ ...authorityInput, provider })
    expect(provider.writeChapter).toHaveBeenCalledTimes(1)
    const options = provider.writeChapter.mock.calls[0]?.[1] as ModelCallExecutionOptions
    expect(options.callBudget).toEqual({ used: 1, max: 1 })
    expect(options.writerInferenceBudget).toEqual({ used: 1, max: 1 })
    expect(options).not.toHaveProperty('writerLengthRepairV1')
    expect(options.diagnosticChapterWriterPromptOverride?.invocation)
      .toBe('WRITER_V2_FLAGSHIP_CONTROL_V1')
    expect(report.classification).toBe('CONTROL_PASS')
    expect(report.providerCalls).toBe(1)
    expect(report.observation).toMatchObject({
      providerTransportOutcome: 'SUCCEEDED',
      requestedModel: 'openai/gpt-5.6-sol', configuredModel: 'openai/gpt-5.6-sol',
      responseModel: 'openai/gpt-5.6-sol-20260709', finishReason: 'stop',
      parserOutcome: 'ACCEPTED', requiredSections: true, terminalClosure: true,
      wordCount: 900, paragraphCount: 20, wordsPerParagraph: 45,
      writerCompletenessOutcome: 'PASSED', completenessCodes: [],
      reasoningTokens: 0, completionTokens: 1300, visibleContentChars: 7500,
      latencyMs: 24000, writerInferenceCount: 1,
    })
    expect(() => assertWriterV2FlagshipControlSerialization(report)).not.toThrow()
  })

  it('returns terminal classification after inferred length or authority failure', async () => {
    const length = await executeWriterV2FlagshipControl({
      ...authorityInput,
      provider: fakeProvider({ wordCount: 760, completenessPassed: false }),
    })
    expect(length.classification).toBe('CONTROL_LENGTH_MISS')
    expect(length.observation.writerInferenceCount).toBe(1)

    const authority = await executeWriterV2FlagshipControl({
      ...authorityInput,
      provider: fakeProvider({ scheduledReveal: false, throwAfterObservation: true }),
    })
    expect(authority.classification).toBe('CONTROL_AUTHORITY_MISS')
    expect(authority.observation.writerInferenceCount).toBe(1)
  })

  it('rejects response alias and prevents unsafe report or runner output', async () => {
    await expect(executeWriterV2FlagshipControl({
      ...authorityInput,
      provider: fakeProvider({ responseModel: 'openai/gpt-5.6-sol' }),
    })).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_MODEL_IDENTITY_MISMATCH')
    for (const key of ['system', 'prompt', 'title', 'prose', 'rawResponse', 'canon', 'brief']) {
      expect(() => assertWriterV2FlagshipControlSerialization({ [key]: 'forbidden' }))
        .toThrow('WRITER_V2_FLAGSHIP_CONTROL_FORBIDDEN_REPORT_KEY')
    }
    const runner = readFileSync(path.resolve(process.cwd(), 'scripts/writer-v2-flagship-control.ts'), 'utf8')
    expect(runner).not.toMatch(/mkdirSync|writeFileSync/)
    expect(runner).toContain('--preflight-only')
    expect(runner).toContain('LAKOKU_WRITER_V2_FLAGSHIP_CONTROL_CHILD')
    expect(runner).not.toMatch(/console\.(?:log|error)\([^\n]*(?:prompt|prose|title|system)/i)
  })
})
