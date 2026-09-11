import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import type { GenerationProvider, ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'
import type { ProviderCallOutcome } from '@/lib/observability/generation-provider-call.contract'
import {
  WRITER_PROMPT_V2_GENERALIZATION_CONFIG,
  WRITER_PROMPT_V2_GENERALIZATION_FIXTURES,
  assertWriterPromptV2GeneralizationSerialization,
  classifyWriterPromptV2Generalization,
  createWriterPromptV2GeneralizationRoute,
  executeWriterPromptV2Generalization,
  prepareWriterPromptV2Generalization,
  preflightWriterPromptV2Generalization,
  type WriterPromptV2GeneralizationFixtureObservation,
} from '@/lib/narrative-qa/harness/writer-prompt-v2-generalization-diagnostic.server'

const REMOVED_RULE = '- Mayoritas paragraf = 1 kalimat pendek (15–25 kata). Sesekali 2 kalimat (30–40 kata) untuk emosi penting.'
const V2_MYSTERY_TREATMENT_ENVELOPE_SHA256 = 'ca3341e81344463fc4e74cf2ef8a678677817e15e603ca6b49f4e03c31eaafb8'
const MYSTERY_BASELINE_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'

const EXPECTED_MANIFEST = Object.freeze({
  EARLY: Object.freeze({
    baselinePromptSha256: 'a51dca65dfd84111ee81b70a3afb3e6d570f470bc443c3f87dced42bfa09bc7e',
    treatmentEnvelopeSha256: '4265026d5911190abc4eedf689daf8935500b24e0967c897297ac87433abcb19',
  }),
  DIALOGUE: Object.freeze({
    baselinePromptSha256: '580299448072941d22e8237ba22e2f0e13f371c808943019f7db875cdda56c10',
    treatmentEnvelopeSha256: '3482d7361438f67f2a7a7351176f58209d3c942734bbee1c14294936242d0bd0',
  }),
  MYSTERY: Object.freeze({
    baselinePromptSha256: MYSTERY_BASELINE_PROMPT_SHA256,
    treatmentEnvelopeSha256: V2_MYSTERY_TREATMENT_ENVELOPE_SHA256,
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

type ResultSpec = Readonly<{
  wordCount: number
  parserAccepted?: boolean
  sectionsPresent?: boolean
  closurePresent?: boolean
  finishReason?: string
  transportSucceeded?: boolean
}>

function observationFrom(spec: ResultSpec): WriterPromptV2GeneralizationFixtureObservation {
  const lengthOnly = spec.wordCount < 800 || spec.wordCount > 1000
  const healthy = spec.parserAccepted !== false
    && spec.sectionsPresent !== false
    && spec.closurePresent !== false
    && spec.finishReason !== 'length'
  const completenessPassed = !lengthOnly && healthy
  return {
    transportOutcome: (spec.transportSucceeded === false
      ? 'PROVIDER_ERROR'
      : lengthOnly || !healthy ? 'INVALID_RESPONSE' : 'SUCCEEDED') as ProviderCallOutcome,
    parserOutcome: spec.parserAccepted === false ? 'REJECTED' : 'ACCEPTED',
    completenessPassed,
    completenessCodes: lengthOnly && healthy ? ['WRITER_LENGTH_OUT_OF_RANGE'] : [],
    wordCount: spec.wordCount,
    paragraphCount: 70,
    requiredSectionsPresent: spec.sectionsPresent !== false,
    terminalClosurePresent: spec.closurePresent !== false,
    finishReason: spec.finishReason ?? 'stop',
    reasoningTokenCount: 0,
    completionTokenCount: 1_500,
    visibleContentChars: 8_000,
    latencyMs: 30_000,
  }
}

function fakeProvider(specs: readonly ResultSpec[]): GenerationProvider & {
  writeChapter: ReturnType<typeof vi.fn>
} {
  let index = 0
  return {
    name: 'fake-writer-prompt-v2-generalization',
    generatePlan: vi.fn(),
    writeChapter: vi.fn(async (_input, options?: ModelCallExecutionOptions) => {
      if (!options?.callBudget || !options.writerInferenceBudget) throw new Error('missing budgets')
      if (options.callBudget.used >= options.callBudget.max
        || options.writerInferenceBudget.used >= options.writerInferenceBudget.max) {
        throw new Error('WRITER_PROMPT_V2_GENERALIZATION_INFERENCE_BUDGET_EXHAUSTED')
      }
      options.callBudget.used += 1
      options.writerInferenceBudget.used += 1
      const result = observationFrom(specs[index] ?? specs[specs.length - 1])
      index += 1
      options.observeWriterRuntime?.({
        timeoutMs: 120_000,
        streaming: true,
        maxRetries: 0,
        maxOutputTokens: 4096,
        temperature: null,
      })
      options.observeReasoningBudget?.({
        reasoningTokenCount: result.reasoningTokenCount,
        reasoningFieldPresent: true,
        reasoningDetailsPresent: false,
        visibleContentChars: result.visibleContentChars ?? 0,
        completionTokenCount: result.completionTokenCount,
        finishReason: result.finishReason ?? undefined,
      })
      options.observeWriterParserOutcome?.(result.parserOutcome === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED')
      options.observeWriterEvaluation?.({
        completenessPassed: result.completenessPassed === true,
        completenessCodes: [...result.completenessCodes],
        wordCount: result.wordCount ?? 0,
        paragraphCount: result.paragraphCount ?? undefined,
        requiredSectionsPresent: result.requiredSectionsPresent === true,
        terminalClosurePresent: result.terminalClosurePresent === true,
      })
      options.observeModelCall?.({
        actualProviderId: 'openrouter',
        actualModelId: 'openai/gpt-5.6-sol',
        actualModelResolved: true,
        endedAt: '2026-09-03T00:00:00.000Z',
        elapsedMs: result.latencyMs,
        outcome: (result.transportOutcome === 'PROVIDER_ERROR'
          ? 'PROVIDER_ERROR'
          : result.transportOutcome) as ProviderCallOutcome,
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
      if (result.transportOutcome !== 'SUCCEEDED' || !result.completenessPassed) {
        throw new Error('synthetic terminal result')
      }
      return { discarded: true }
    }),
  }
}

const authorityInput = {
  productionRepairFlag: undefined,
  diagnosticChildFlag: '1',
  credentialAvailable: true,
} as const

describe('WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1', () => {
  it('freezes five sequential fixtures and control model topology', () => {
    expect(WRITER_PROMPT_V2_GENERALIZATION_CONFIG).toMatchObject({
      track: 'WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1',
      treatment: 'ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL',
      modelId: 'openai/gpt-5.6-sol',
      reasoningEffort: 'none',
      promptTarget: '850–950',
      hardAcceptance: '800–1000',
      maxOutputTokens: 4096,
      timeoutMs: 120_000,
      streaming: true,
      maxRetries: 0,
      temperature: null,
      maxProviderCalls: 5,
      maxWriterInferencesPerFixture: 1,
      writerLengthRepairEnabled: false,
      databaseAllowed: false,
      publicationAllowed: false,
    })
    expect(WRITER_PROMPT_V2_GENERALIZATION_FIXTURES).toEqual([
      { key: 'EARLY', chapterNumber: 1 },
      { key: 'DIALOGUE', chapterNumber: 8 },
      { key: 'MYSTERY', chapterNumber: 12 },
      { key: 'EMOTIONAL', chapterNumber: 25 },
      { key: 'LATER_ACT', chapterNumber: 45 },
    ])
    expect(createWriterPromptV2GeneralizationRoute()).toMatchObject({
      provider: 'openrouter',
      modelId: 'openai/gpt-5.6-sol',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'none',
    })
  })

  it('freezes manifest hashes and proves exact projection for every fixture', async () => {
    const prepared = await prepareWriterPromptV2Generalization()
    expect(prepared.fixtures.map((fixture) => fixture.key)).toEqual([
      'EARLY', 'DIALOGUE', 'MYSTERY', 'EMOTIONAL', 'LATER_ACT',
    ])
    for (const fixture of prepared.fixtures) {
      const expected = EXPECTED_MANIFEST[fixture.key]
      expect(fixture.baseline.promptSha256).toBe(expected.baselinePromptSha256)
      expect(fixture.treatment.envelopeSha256).toBe(expected.treatmentEnvelopeSha256)
      expect(fixture.baseline.system.split(REMOVED_RULE)).toHaveLength(2)
      expect(fixture.treatment.system).not.toContain(REMOVED_RULE)
      expect(fixture.treatment.prompt).toBe(fixture.baseline.prompt)
      expect(fixture.evidence).toEqual({
        removedRuleOccurrences: 1,
        userPromptEquivalent: true,
        numericParagraphControlsEquivalent: true,
        wordAuthorityEquivalent: true,
        canonStoryBeatsEquivalent: true,
        otherRhythmEquivalent: true,
        restorationExact: true,
      })
    }
  })

  it('preflights with zero calls and fails closed on authority drift', async () => {
    const preflight = await preflightWriterPromptV2Generalization(authorityInput)
    expect(preflight.ok).toBe(true)
    expect(preflight.providerCalls).toBe(0)
    expect(preflight.fixtures).toHaveLength(5)
    expect(preflight.fixtures.find((fixture) => fixture.key === 'MYSTERY'))
      .toMatchObject({
        baselinePromptSha256: MYSTERY_BASELINE_PROMPT_SHA256,
        treatmentEnvelopeSha256: V2_MYSTERY_TREATMENT_ENVELOPE_SHA256,
      })
    await expect(preflightWriterPromptV2Generalization({
      ...authorityInput,
      credentialAvailable: false,
    })).rejects.toThrow('WRITER_PROMPT_V2_GENERALIZATION_CREDENTIAL_MISSING')
    await expect(preflightWriterPromptV2Generalization({
      ...authorityInput,
      diagnosticChildFlag: undefined,
    })).rejects.toThrow('WRITER_PROMPT_V2_GENERALIZATION_CHILD_PROCESS_REQUIRED')
    await expect(preflightWriterPromptV2Generalization({
      ...authorityInput,
      productionRepairFlag: '0',
    })).rejects.toThrow('WRITER_PROMPT_V2_GENERALIZATION_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  })

  it.each([
    [5, 'STRONG_GENERALIZATION'],
    [4, 'STRONG_GENERALIZATION'],
    [3, 'MIXED_GENERALIZATION'],
    [2, 'MIXED_GENERALIZATION'],
    [1, 'NEGATIVE_GENERALIZATION'],
    [0, 'NEGATIVE_GENERALIZATION'],
  ] as const)('classifies %i/5 writer passes as %s', (passes, expected) => {
    const verdicts = Array.from({ length: 5 }, (_, index) => (
      index < passes ? 'WRITER_PASS' as const : 'WRITER_FAIL_LENGTH' as const
    ))
    expect(classifyWriterPromptV2Generalization(verdicts)).toBe(expected)
  })

  it('rejects V2 on any new failure shape even with four passes', () => {
    expect(classifyWriterPromptV2Generalization([
      'WRITER_PASS', 'WRITER_PASS', 'WRITER_PASS', 'WRITER_PASS', 'NEW_FAILURE_SHAPE',
    ])).toBe('NEGATIVE_GENERALIZATION')
  })

  it('executes exactly five sequential calls in frozen fixture order', async () => {
    const provider = fakeProvider([
      { wordCount: 900 }, { wordCount: 880 }, { wordCount: 832 },
      { wordCount: 910 }, { wordCount: 870 },
    ])
    const report = await executeWriterPromptV2Generalization({ ...authorityInput, provider })

    expect(provider.writeChapter).toHaveBeenCalledTimes(5)
    const chapterOrder = provider.writeChapter.mock.calls.map(
      (call) => (call[1] as ModelCallExecutionOptions).telemetryContext.chapterNumber,
    )
    expect(chapterOrder).toEqual([1, 8, 12, 25, 45])
    for (const call of provider.writeChapter.mock.calls) {
      const options = call[1] as ModelCallExecutionOptions
      expect(options).not.toHaveProperty('writerLengthRepairV1')
      expect(options.writerInferenceBudget).toEqual({ used: 1, max: 1 })
      expect(options.diagnosticChapterWriterPromptOverride)
        .toMatchObject({ invocation: 'WRITER_PROMPT_V2_GENERALIZATION_DIAGNOSTIC_V1' })
    }
    const options = provider.writeChapter.mock.calls[4]?.[1] as ModelCallExecutionOptions
    expect(options.callBudget).toEqual({ used: 5, max: 5 })
    expect(report.inferenceCount).toBe(5)
    expect(report.databaseCalls).toBe(0)
    expect(report.publicationCalls).toBe(0)
    expect(report.classification).toBe('STRONG_GENERALIZATION')
    expect(report.fixtures.map((fixture) => fixture.verdict)).toEqual([
      'WRITER_PASS', 'WRITER_PASS', 'WRITER_PASS', 'WRITER_PASS', 'WRITER_PASS',
    ])
    expect(report.fixtures[2]?.hashes.treatmentEnvelopeSha256)
      .toBe(V2_MYSTERY_TREATMENT_ENVELOPE_SHA256)
    expect(() => assertWriterPromptV2GeneralizationSerialization(report)).not.toThrow()
  })

  it('classifies three length failures as mixed without a sixth call', async () => {
    const provider = fakeProvider([
      { wordCount: 900 }, { wordCount: 720 }, { wordCount: 832 },
      { wordCount: 700 }, { wordCount: 1118 },
    ])
    const report = await executeWriterPromptV2Generalization({ ...authorityInput, provider })
    expect(provider.writeChapter).toHaveBeenCalledTimes(5)
    expect(report.inferenceCount).toBe(5)
    expect(report.classification).toBe('MIXED_GENERALIZATION')
    expect(report.fixtures.map((fixture) => fixture.verdict)).toEqual([
      'WRITER_PASS', 'WRITER_FAIL_LENGTH', 'WRITER_PASS', 'WRITER_FAIL_LENGTH', 'WRITER_FAIL_LENGTH',
    ])
  })

  it('classifies parser failure as negative new failure shape', async () => {
    const provider = fakeProvider([
      { wordCount: 900 }, { wordCount: 880 }, { wordCount: 832 },
      { wordCount: 910 }, { wordCount: 870, parserAccepted: false },
    ])
    const report = await executeWriterPromptV2Generalization({ ...authorityInput, provider })
    expect(report.inferenceCount).toBe(5)
    expect(report.classification).toBe('NEGATIVE_GENERALIZATION')
    expect(report.fixtures[4]?.verdict).toBe('NEW_FAILURE_SHAPE')
  })

  it('keeps runner preflight artifact-free and rejects content keys', () => {
    const runner = readFileSync(path.resolve(
      process.cwd(),
      'scripts/writer-prompt-v2-generalization-diagnostic.ts',
    ), 'utf8')
    const preflightBranch = runner.slice(
      runner.indexOf('if (preflightOnly)'),
      runner.indexOf('const route ='),
    )
    expect(preflightBranch).not.toMatch(/mkdirSync|writeFileSync/)
    expect(runner.match(/writeFileSync\(/g)).toHaveLength(1)
    for (const key of [
      'prompt', 'system', 'prose', 'paragraphs', 'title', 'rawresponse',
      'reasoningText', 'canon', 'snapshot', 'plan', 'continuation', 'brief',
    ]) {
      expect(() => assertWriterPromptV2GeneralizationSerialization({ [key]: 'forbidden' }))
        .toThrow('WRITER_PROMPT_V2_GENERALIZATION_FORBIDDEN_ARTIFACT_KEY')
    }
  })
})
