import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import type { GenerationProvider, ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'
import {
  WRITER_PROMPT_ABLATION_V2_CONFIG,
  assertWriterPromptAblationV2Serialization,
  classifyWriterPromptAblationV2,
  createWriterPromptAblationV2Route,
  executeWriterPromptAblationV2,
  prepareWriterPromptAblationV2,
  preflightWriterPromptAblationV2,
  restoreWriterPromptShortParagraphRule,
  type WriterPromptAblationV2Observation,
} from '@/lib/narrative-qa/harness/writer-prompt-ablation-v2-diagnostic.server'

const BASELINE_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'
const TREATMENT_ENVELOPE_SHA256 = 'ca3341e81344463fc4e74cf2ef8a678677817e15e603ca6b49f4e03c31eaafb8'
const REMOVED_RULE = '- Mayoritas paragraf = 1 kalimat pendek (15–25 kata). Sesekali 2 kalimat (30–40 kata) untuk emosi penting.'

function observation(
  wordCount: number | null,
  overrides: Partial<WriterPromptAblationV2Observation> = {},
): WriterPromptAblationV2Observation {
  const lengthOnly = wordCount !== null && (wordCount < 800 || wordCount > 1000)
  return {
    transportOutcome: lengthOnly ? 'INVALID_RESPONSE' : 'SUCCEEDED',
    parserOutcome: 'ACCEPTED',
    completenessPassed: !lengthOnly,
    completenessCodes: lengthOnly ? ['WRITER_LENGTH_OUT_OF_RANGE'] : [],
    wordCount,
    paragraphCount: wordCount === null ? null : 61,
    requiredSectionsPresent: true,
    terminalClosurePresent: true,
    finishReason: 'stop',
    reasoningTokenCount: 0,
    completionTokenCount: 1_400,
    latencyMs: 250,
    ...overrides,
  }
}

function fakeProvider(result: WriterPromptAblationV2Observation): GenerationProvider & {
  writeChapter: ReturnType<typeof vi.fn>
} {
  return {
    name: 'fake-writer-prompt-ablation-v2',
    generatePlan: vi.fn(),
    writeChapter: vi.fn(async (_input, options?: ModelCallExecutionOptions) => {
      if (!options?.callBudget || !options.writerInferenceBudget) throw new Error('missing budgets')
      if (options.callBudget.used >= options.callBudget.max
        || options.writerInferenceBudget.used >= options.writerInferenceBudget.max) {
        throw new Error('WRITER_PROMPT_ABLATION_V2_INFERENCE_BUDGET_EXHAUSTED')
      }
      options.callBudget.used += 1
      options.writerInferenceBudget.used += 1
      options.observeWriterRuntime?.({
        timeoutMs: 120_000,
        streaming: true,
        maxRetries: 0,
        maxOutputTokens: 4096,
        temperature: null,
      })
      options.observeReasoningBudget?.({
        reasoningTokenCount: result.reasoningTokenCount,
        reasoningFieldPresent: result.reasoningTokenCount !== null,
        reasoningDetailsPresent: false,
        visibleContentChars: 8_000,
        completionTokenCount: result.completionTokenCount,
        finishReason: result.finishReason ?? undefined,
      })
      options.observeWriterParserOutcome?.(
        result.parserOutcome === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
      )
      if (result.wordCount !== null && result.paragraphCount !== null) {
        options.observeWriterEvaluation?.({
          completenessPassed: result.completenessPassed === true,
          completenessCodes: [...result.completenessCodes],
          wordCount: result.wordCount,
          paragraphCount: result.paragraphCount,
          requiredSectionsPresent: result.requiredSectionsPresent === true,
          terminalClosurePresent: result.terminalClosurePresent === true,
        })
      }
      options.observeModelCall?.({
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
      if (result.transportOutcome !== 'SUCCEEDED') throw new Error('synthetic terminal result')
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

describe('WRITER_PROMPT_ABLATION_V2 / ABLATION_SHORT_PARAGRAPH_RULE_REMOVAL', () => {
  it('freezes control model, original fixture, and one-call topology', () => {
    expect(WRITER_PROMPT_ABLATION_V2_CONFIG).toMatchObject({
      track: 'WRITER_PROMPT_ABLATION_V2',
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
      maxProviderCalls: 1,
      maxWriterInferences: 1,
      writerLengthRepairEnabled: false,
      databaseAllowed: false,
      publicationAllowed: false,
    })
    expect(createWriterPromptAblationV2Route()).toMatchObject({
      provider: 'openrouter',
      modelId: 'openai/gpt-5.6-sol',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'none',
    })
  })

  it('removes one exact system rule and restores baseline byte-for-byte', async () => {
    const prepared = await prepareWriterPromptAblationV2()

    expect(prepared.baseline.promptSha256).toBe(BASELINE_PROMPT_SHA256)
    expect(prepared.treatment.envelopeSha256).toBe(TREATMENT_ENVELOPE_SHA256)
    expect(prepared.baseline.system.split(REMOVED_RULE)).toHaveLength(2)
    expect(prepared.treatment.system).not.toContain(REMOVED_RULE)
    expect(prepared.treatment.prompt).toBe(prepared.baseline.prompt)
    expect(restoreWriterPromptShortParagraphRule(prepared.treatment.system))
      .toBe(prepared.baseline.system)

    for (const preserved of [
      '- Target 38–48 paragraf (wajib dalam 35–50).',
      '- Pembuka hook: 3–5 paragraf',
      '- Konflik awal: 8–10 paragraf',
      '- Dialog/konfrontasi utama: 15–20 paragraf',
      '- Reveal kecil / ubah emosi: 6–8 paragraf',
      '- Penutup cliffhanger: 4–6 paragraf',
      'Jumlah paragraf 38–48 (wajib 35–50).',
      'Pisahkan SETIAP paragraf dengan satu baris kosong (target 38–48 paragraf).',
      'Target 850–950 kata (wajib dalam 800–1000).',
      'PANJANG WAJIB minimal 850 kata (target 850–950; jangan lewat 1000).',
      'DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.',
      'Dialog: 1 baris ucapan = 1 paragraf. Selalu pisah per pembicara.',
      'Satu beat per paragraf.',
    ]) {
      expect(`${prepared.baseline.system}\n${prepared.baseline.prompt}`).toContain(preserved)
      expect(`${prepared.treatment.system}\n${prepared.treatment.prompt}`).toContain(preserved)
    }
    expect(prepared.evidence).toEqual({
      removedRuleOccurrences: 1,
      userPromptEquivalent: true,
      numericParagraphControlsEquivalent: true,
      wordAuthorityEquivalent: true,
      canonStoryBeatsEquivalent: true,
      otherRhythmEquivalent: true,
      restorationExact: true,
    })
  })

  it('preflights with zero calls and fails closed on authority drift', async () => {
    await expect(preflightWriterPromptAblationV2(authorityInput)).resolves.toMatchObject({
      ok: true,
      providerCalls: 0,
      baselinePromptSha256: BASELINE_PROMPT_SHA256,
      treatmentEnvelopeSha256: TREATMENT_ENVELOPE_SHA256,
    })
    await expect(preflightWriterPromptAblationV2({
      ...authorityInput,
      credentialAvailable: false,
    })).rejects.toThrow('WRITER_PROMPT_ABLATION_V2_CREDENTIAL_MISSING')
    await expect(preflightWriterPromptAblationV2({
      ...authorityInput,
      diagnosticChildFlag: undefined,
    })).rejects.toThrow('WRITER_PROMPT_ABLATION_V2_CHILD_PROCESS_REQUIRED')
    await expect(preflightWriterPromptAblationV2({
      ...authorityInput,
      productionRepairFlag: '0',
    })).rejects.toThrow('WRITER_PROMPT_ABLATION_V2_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
  })

  it.each([
    [900, 'STRONG_SUPPORT_COMBINED_CONTROLLERS'],
    [750, 'PARTIAL_SUPPORT_SHORT_PARAGRAPH_CONTROLLER'],
    [799, 'PARTIAL_SUPPORT_SHORT_PARAGRAPH_CONTROLLER'],
    [749, 'SHORT_PARAGRAPH_CONTROLLER_WEAKENED'],
    [1118, 'SHORT_PARAGRAPH_CONTROLLER_CONFIRMED_OVERSHOOT'],
  ] as const)('classifies healthy %i-word output as %s', (wordCount, expected) => {
    expect(classifyWriterPromptAblationV2(observation(wordCount))).toBe(expected)
  })

  it('stops classification on bad parser, closure, or finish reason', () => {
    expect(classifyWriterPromptAblationV2(observation(null, {
      parserOutcome: 'REJECTED',
      completenessPassed: null,
      completenessCodes: [],
      paragraphCount: null,
      requiredSectionsPresent: null,
      terminalClosurePresent: null,
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyWriterPromptAblationV2(observation(900, {
      finishReason: 'length',
      completenessPassed: false,
      completenessCodes: ['WRITER_OUTPUT_CAPPED'],
    }))).toBe('STOP_CLASSIFY_LAYER')
  })

  it.each([
    ['strong', observation(900), 'STRONG_SUPPORT_COMBINED_CONTROLLERS'],
    ['partial', observation(780), 'PARTIAL_SUPPORT_SHORT_PARAGRAPH_CONTROLLER'],
    ['weakened', observation(700), 'SHORT_PARAGRAPH_CONTROLLER_WEAKENED'],
    ['overshoot', observation(1118), 'SHORT_PARAGRAPH_CONTROLLER_CONFIRMED_OVERSHOOT'],
  ] as const)('executes exactly once for %s and emits metadata only', async (_name, result, expected) => {
    const provider = fakeProvider(result)
    const report = await executeWriterPromptAblationV2({ ...authorityInput, provider })

    expect(provider.writeChapter).toHaveBeenCalledOnce()
    const options = provider.writeChapter.mock.calls[0]?.[1]
    expect(options).not.toHaveProperty('writerLengthRepairV1')
    expect(options?.callBudget).toEqual({ used: 1, max: 1 })
    expect(options?.writerInferenceBudget).toEqual({ used: 1, max: 1 })
    expect(options?.diagnosticChapterWriterPromptOverride).toMatchObject({
      invocation: 'WRITER_PROMPT_ABLATION_V2',
    })
    expect(report.inferenceCount).toBe(1)
    expect(report.databaseCalls).toBe(0)
    expect(report.publicationCalls).toBe(0)
    expect(report.classification).toBe(expected)
    expect(() => assertWriterPromptAblationV2Serialization(report)).not.toThrow()
  })

  it('keeps runner preflight artifact-free and rejects content keys', () => {
    const runner = readFileSync(path.resolve(
      process.cwd(),
      'scripts/writer-prompt-ablation-v2-diagnostic.ts',
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
      expect(() => assertWriterPromptAblationV2Serialization({ [key]: 'forbidden' }))
        .toThrow('WRITER_PROMPT_ABLATION_V2_FORBIDDEN_ARTIFACT_KEY')
    }
  })
})
