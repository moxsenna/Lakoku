import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import type { GenerationProvider, ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'
import {
  WRITER_PROMPT_ABLATION_V1_CONFIG,
  assertWriterPromptAblationSerialization,
  classifyWriterPromptAblation,
  createWriterPromptAblationRoute,
  executeWriterPromptAblation,
  prepareWriterPromptAblation,
  preflightWriterPromptAblation,
  restoreWriterPromptParagraphControls,
  type WriterPromptAblationObservation,
} from '@/lib/narrative-qa/harness/writer-prompt-ablation-diagnostic.server'

const BASELINE_PROMPT_SHA256 = '96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a'
const TREATMENT_PROMPT_SHA256 = 'f7f60fe1cc4bb88e52cd5ccfb49df9793b8586c127628ca2de4ff7a8ab2d4e32'

function observation(
  wordCount: number | null,
  overrides: Partial<WriterPromptAblationObservation> = {},
): WriterPromptAblationObservation {
  const lengthOnly = wordCount !== null && (wordCount < 800 || wordCount > 1000)
  return {
    transportOutcome: lengthOnly ? 'INVALID_RESPONSE' : 'SUCCEEDED',
    parserOutcome: 'ACCEPTED',
    completenessPassed: !lengthOnly,
    completenessCodes: lengthOnly ? ['WRITER_LENGTH_OUT_OF_RANGE'] : [],
    wordCount,
    paragraphCount: wordCount === null ? null : 40,
    requiredSectionsPresent: true,
    terminalClosurePresent: true,
    finishReason: 'stop',
    reasoningTokenCount: 0,
    completionTokenCount: 1_200,
    latencyMs: 250,
    ...overrides,
  }
}

function fakeProvider(result: WriterPromptAblationObservation): GenerationProvider & {
  writeChapter: ReturnType<typeof vi.fn>
} {
  return {
    name: 'fake-writer-prompt-ablation',
    generatePlan: vi.fn(),
    writeChapter: vi.fn(async (_input, options?: ModelCallExecutionOptions) => {
      if (!options?.callBudget || !options.writerInferenceBudget) throw new Error('missing budgets')
      if (options.callBudget.used >= options.callBudget.max
        || options.writerInferenceBudget.used >= options.writerInferenceBudget.max) {
        throw new Error('WRITER_PROMPT_ABLATION_V1_INFERENCE_BUDGET_EXHAUSTED')
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

describe('WRITER_PROMPT_ABLATION_V1 / ABLATION_PARAGRAPH_COUNT_REMOVAL', () => {
  it('freezes exact control model, fixture, word authority, and one-call topology', () => {
    expect(WRITER_PROMPT_ABLATION_V1_CONFIG).toEqual({
      track: 'WRITER_PROMPT_ABLATION_V1',
      treatment: 'ABLATION_PARAGRAPH_COUNT_REMOVAL',
      experimentType: 'CAUSAL',
      qualificationAllowed: false,
      fixtureClassification: 'SYNTHETIC',
      genre: 'MYSTERY',
      chapterNumber: 12,
      provider: 'openrouter',
      requestedModel: 'openai/gpt-5.6-sol',
      modelId: 'openai/gpt-5.6-sol',
      canonicalSlug: 'openai/gpt-5.6-sol-20260709',
      reasoningEffort: 'none',
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
      writerLengthRepairEnabled: false,
      databaseAllowed: false,
      publicationAllowed: false,
      contentRetentionAllowed: false,
    })
    expect(createWriterPromptAblationRoute()).toEqual({
      useCase: 'chapter_prose',
      provider: 'openrouter',
      modelId: 'openai/gpt-5.6-sol',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'none',
      routeVersion: 'writer-prompt-ablation-v1-paragraph-count-removal',
    })
  })

  it('projects from exact production prompt and restores baseline byte-for-byte', async () => {
    const prepared = await prepareWriterPromptAblation()

    expect(prepared.baseline.promptSha256).toBe(BASELINE_PROMPT_SHA256)
    expect(prepared.treatment.promptSha256).toBe(TREATMENT_PROMPT_SHA256)
    expect(prepared.treatment.system).not.toBe(prepared.baseline.system)
    expect(restoreWriterPromptParagraphControls({
      system: prepared.treatment.system,
      prompt: prepared.treatment.prompt,
    })).toEqual({
      system: prepared.baseline.system,
      prompt: prepared.baseline.prompt,
    })

    const baselineCombined = `${prepared.baseline.system}\n${prepared.baseline.prompt}`
    const treatmentCombined = `${prepared.treatment.system}\n${prepared.treatment.prompt}`
    for (const numericController of [
      'Target 38–48 paragraf',
      'wajib dalam 35–50',
      'Jumlah paragraf 38–48',
      'target 38–48 paragraf',
      'Pembuka hook: 3–5 paragraf',
      'Konflik awal: 8–10 paragraf',
      'Dialog/konfrontasi utama: 15–20 paragraf',
      'Reveal kecil / ubah emosi: 6–8 paragraf',
      'Penutup cliffhanger: 4–6 paragraf',
      '3–5 paragraf pendek',
      '3–5 paragraf cliffhanger pendek',
    ]) {
      expect(baselineCombined).toContain(numericController)
      expect(treatmentCombined).not.toContain(numericController)
    }

    for (const preserved of [
      'Target 850–950 kata (wajib dalam 800–1000).',
      'PANJANG WAJIB minimal 850 kata (target 850–950; jangan lewat 1000).',
      'Mayoritas paragraf = 1 kalimat pendek (15–25 kata).',
      'DILARANG paragraf 4–6 kalimat. DILARANG dinding teks.',
      'Dialog: 1 baris ucapan = 1 paragraf. Selalu pisah per pembicara.',
      'Satu beat per paragraf.',
      'Mayoritas 1 kalimat per paragraf. Dialog satu baris per paragraf.',
    ]) {
      expect(baselineCombined).toContain(preserved)
      expect(treatmentCombined).toContain(preserved)
    }

    expect(treatmentCombined).not.toContain('Jaga paragraf relatif pendek dan mobile-friendly.')
    expect(treatmentCombined).not.toContain('Jaga ritme paragraf pendek dan nyaman dibaca di layar ponsel.')
    expect(prepared.fixtureEvidence).toEqual({
      fixtureEquivalent: true,
      canonEquivalent: true,
      storyEquivalent: true,
      beatsEquivalent: true,
      wordAuthorityEquivalent: true,
      restorationExact: true,
    })
  })

  it('preflights with zero calls and fails closed on authority drift', async () => {
    await expect(preflightWriterPromptAblation(authorityInput)).resolves.toMatchObject({
      ok: true,
      providerCalls: 0,
      baselinePromptSha256: BASELINE_PROMPT_SHA256,
      treatmentPromptSha256: TREATMENT_PROMPT_SHA256,
    })
    await expect(preflightWriterPromptAblation({
      ...authorityInput,
      credentialAvailable: false,
    })).rejects.toThrow('WRITER_PROMPT_ABLATION_V1_CREDENTIAL_MISSING')
    await expect(preflightWriterPromptAblation({
      ...authorityInput,
      diagnosticChildFlag: undefined,
    })).rejects.toThrow('WRITER_PROMPT_ABLATION_V1_CHILD_PROCESS_REQUIRED')
    for (const productionRepairFlag of ['', '0', 'false', '1', 'true']) {
      await expect(preflightWriterPromptAblation({
        ...authorityInput,
        productionRepairFlag,
      })).rejects.toThrow('WRITER_PROMPT_ABLATION_V1_PRODUCTION_REPAIR_FLAG_MUST_BE_UNDEFINED')
    }
  })

  it.each([
    [870, 'STRONG_SUPPORT_H1'],
    [800, 'STRONG_SUPPORT_H1'],
    [1000, 'STRONG_SUPPORT_H1'],
    [750, 'PARTIAL_SUPPORT_H1'],
    [799, 'PARTIAL_SUPPORT_H1'],
    [749, 'H1_WEAKENED_OR_REJECTED'],
  ] as const)('classifies healthy %i-word output as %s', (wordCount, expected) => {
    expect(classifyWriterPromptAblation(observation(wordCount))).toBe(expected)
  })

  it('stops classification on unhealthy shape, cap, or out-of-scope length', () => {
    expect(classifyWriterPromptAblation(observation(null, {
      parserOutcome: 'REJECTED',
      completenessPassed: null,
      completenessCodes: [],
      paragraphCount: null,
      requiredSectionsPresent: null,
      terminalClosurePresent: null,
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyWriterPromptAblation(observation(900, {
      finishReason: 'length',
      completenessPassed: false,
      completenessCodes: ['WRITER_OUTPUT_CAPPED'],
    }))).toBe('STOP_CLASSIFY_LAYER')
    expect(classifyWriterPromptAblation(observation(1001))).toBe('STOP_CLASSIFY_LAYER')
  })

  it.each([
    ['strong', observation(870), 'STRONG_SUPPORT_H1'],
    ['partial', observation(780), 'PARTIAL_SUPPORT_H1'],
    ['weakened', observation(700), 'H1_WEAKENED_OR_REJECTED'],
  ] as const)('executes exactly once for %s result and emits metadata only', async (_name, result, expected) => {
    const provider = fakeProvider(result)
    const report = await executeWriterPromptAblation({ ...authorityInput, provider })

    expect(provider.writeChapter).toHaveBeenCalledOnce()
    const options = provider.writeChapter.mock.calls[0]?.[1]
    expect(options).not.toHaveProperty('writerLengthRepairV1')
    expect(options?.callBudget).toEqual({ used: 1, max: 1 })
    expect(options?.writerInferenceBudget).toEqual({ used: 1, max: 1 })
    expect(options?.diagnosticChapterWriterPromptOverride).toMatchObject({
      invocation: 'WRITER_PROMPT_ABLATION_V1',
    })
    expect(report.inferenceCount).toBe(1)
    expect(report.databaseCalls).toBe(0)
    expect(report.publicationCalls).toBe(0)
    expect(report.classification).toBe(expected)
    expect(() => assertWriterPromptAblationSerialization(report)).not.toThrow()
  })

  it('keeps runner preflight artifact-free and terminal output result-only', () => {
    const runner = readFileSync(path.resolve(
      process.cwd(),
      'scripts/writer-prompt-ablation-diagnostic.ts',
    ), 'utf8')
    const preflightBranch = runner.slice(
      runner.indexOf('if (preflightOnly)'),
      runner.indexOf('const route ='),
    )

    expect(preflightBranch).not.toMatch(/mkdirSync|writeFileSync/)
    expect(runner.match(/writeFileSync\(/g)).toHaveLength(1)
    expect(runner).toContain("path.join(ARTIFACT_DIR, 'result.json')")
  })

  it('rejects forbidden content keys in persisted artifacts', () => {
    for (const key of [
      'prompt', 'system', 'prose', 'paragraphs', 'title', 'rawresponse',
      'reasoningText', 'canon', 'snapshot', 'plan', 'continuation', 'brief',
    ]) {
      expect(() => assertWriterPromptAblationSerialization({ [key]: 'forbidden' }))
        .toThrow('WRITER_PROMPT_ABLATION_V1_FORBIDDEN_ARTIFACT_KEY')
    }
  })
})
