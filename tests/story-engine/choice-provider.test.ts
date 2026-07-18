import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { buildChapterBrief, type ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import {
  createDeterministicProvider,
  type ChoiceInput,
  type GenerationProvider,
} from '@/lib/ai-gateway/provider'
import {
  generateChoiceBranch,
  generatePlan,
  GatewayError,
} from '@/lib/ai-gateway/gateway'
import type { ChapterDraftParsed, ChoiceBranch } from '@/lib/ai-gateway/schemas'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'

const {
  streamTextMock,
  createOpenAICompatibleMock,
  recordGenerationProviderCallMock,
} = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  createOpenAICompatibleMock: vi.fn(),
  recordGenerationProviderCallMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('ai', () => ({
  streamText: streamTextMock,
}))
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: recordGenerationProviderCallMock,
}))

const telemetryContext = {
  userId: '10000000-0000-4000-8000-000000000001',
  storyId: 'fixture:warisan-terkubur',
  chapterNumber: 12,
  generationKind: 'standard',
  jobId: null,
  correlationId: '20000000-0000-4000-8000-000000000002',
  attemptNumber: null,
} as const

const executionOptions = {
  telemetryContext,
  workflowPhase: 'CHOICES_INITIAL',
} as const

function observedResult(text: string, modelId?: string) {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 120, outputTokens: 80, totalTokens: 200 }),
    finalStep: Promise.resolve({
      response: modelId === undefined ? {} : { modelId },
      providerMetadata: {},
    }),
  }
}

function validBranch(chapterNumber = 12): ChoiceBranch {
  return {
    choicePrompt: 'Apa yang Rani lakukan sekarang?',
    choices: [
      {
        id: 'open-safe',
        label: 'Buka brankas tua',
        hint: 'Suara langkah mendekat dari lorong',
      },
      {
        id: 'stop-ratna',
        label: 'Hadang Ratna di lorong',
      },
    ],
    outcomes: [
      {
        choiceId: 'open-safe',
        consequence: ['Rani menemukan surat lama.'],
        nextChapterNumber: chapterNumber + 1,
        isEnding: false,
        effect: {
          routeDeltas: { truth: 1 },
          trustDeltas: {},
          flagsSet: { opened_safe: true },
          evidenceAdded: ['surat lama'],
          endingBiasDeltas: {},
          threadTouches: ['thread:warisan'],
        },
      },
      {
        choiceId: 'stop-ratna',
        consequence: ['Ratna tertahan di ujung lorong.'],
        nextChapterNumber: chapterNumber + 1,
        isEnding: false,
        effect: {
          routeDeltas: { risk: 1 },
          trustDeltas: {},
          flagsSet: {},
          evidenceAdded: [],
          endingBiasDeltas: {},
          threadTouches: ['thread:warisan'],
        },
      },
    ],
  }
}

function fixtureDraft(chapterNumber: number): ChapterDraftParsed {
  return {
    storyId: 'fixture:warisan-terkubur',
    chapterNumber,
    title: `Bab ${chapterNumber}`,
    paragraphs: [
      'Rani menahan napas di depan brankas tua.',
      'Ratna mendekat dari lorong yang gelap.',
      'Kunci kecil itu terasa dingin di telapak tangannya.',
      'Suara langkah berhenti tepat di balik pintu.',
    ],
    wordCount: 35,
    sceneCount: 1,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
}

function choiceInput(chapterNumber = 12): ChoiceInput {
  const snapshot = buildFixtureSnapshot()
  const contractSnapshot = structuredClone(snapshot)
  contractSnapshot.storyId = misteriDramaContract.storyId
  const routeState = normalizeRouteState({
    truth: 4,
    risk: 2,
    flags: { provider_signal_server_only: true },
  })
  const choiceHistory: ChoiceHistoryEntry[] = [{
    chapterNumber: 11,
    choiceId: 'keep-key',
    label: 'Simpan kunci kecil',
    consequence: ['Rani menyembunyikan kunci itu.'],
    effectSummary: { truth: 1, flagsSet: ['kept_key'] },
    createdAt: '2026-07-14T10:30:00.000Z',
  }]
  const chapterBrief = buildChapterBrief({
    storyContract: misteriDramaContract,
    snapshot: contractSnapshot,
    readerState: { routeState, choiceHistory, lockedEndingKey: null },
    chapterNumber,
    previousChoice: null,
  })

  return {
    snapshot,
    chapterBrief,
    draft: fixtureDraft(chapterNumber),
    lastParagraphs: [
      'Ratna mendekat dari lorong yang gelap.',
      'Kunci kecil itu terasa dingin di telapak tangannya.',
      'Suara langkah berhenti tepat di balik pintu.',
    ],
    routeState,
    choiceHistory,
    lockedEndingKey: chapterBrief.lockedEndingKey,
  }
}

function expectGatewayError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(GatewayError)
  expect(error).toMatchObject({ code })
}

describe('generateChoiceBranch', () => {
  it('keeps legacy plan/write-only providers compatible', async () => {
    const base = createDeterministicProvider()
    const legacyProvider: GenerationProvider = {
      name: 'legacy-provider',
      generatePlan: (input) => base.generatePlan(input),
      writeChapter: (input) => base.writeChapter(input),
    }
    const snapshot = buildFixtureSnapshot()

    await expect(generatePlan(
      { provider: legacyProvider },
      { snapshot, blueprint: snapshot.blueprints[11], chapterNumber: 12 },
    )).resolves.toMatchObject({ chapterNumber: 12 })
  })

  it('calls provider once, returns validated branch, and preserves caller input', async () => {
    const input = choiceInput()
    const before = structuredClone(input)
    let received: Parameters<NonNullable<GenerationProvider['generateChoices']>>[0] | undefined
    const generateChoices = vi.fn(async (
      providerInput: Parameters<NonNullable<GenerationProvider['generateChoices']>>[0],
    ) => {
      received = providerInput
      providerInput.storyId = 'mutated-by-provider'
      providerInput.draft.lastParagraphs[0] = 'mutated paragraph'
      return validBranch()
    })
    const base = createDeterministicProvider()
    const provider: GenerationProvider = { ...base, generateChoices }

    await expect(generateChoiceBranch({ provider }, input, executionOptions)).resolves.toEqual(validBranch())
    expect(generateChoices).toHaveBeenCalledTimes(1)
    expect(received).not.toBe(input)
    expect(input).toEqual(before)
  })

  it('throws CHOICE_PROVIDER_UNAVAILABLE when optional method is absent', async () => {
    const base = createDeterministicProvider()
    const provider: GenerationProvider = {
      name: base.name,
      generatePlan: base.generatePlan,
      writeChapter: base.writeChapter,
    }

    await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_PROVIDER_UNAVAILABLE')
      return true
    })
  })

  it('builds a valid deterministic choice branch without a live model', async () => {
    const provider = createDeterministicProvider()
    const branch = await generateChoiceBranch({ provider }, choiceInput(), executionOptions)
    expect(branch).not.toBeNull()
    expect(branch?.choices.length).toBeGreaterThanOrEqual(2)
    expect(branch?.outcomes.map((outcome) => outcome.choiceId).sort()).toEqual(
      branch?.choices.map((choice) => choice.id).sort(),
    )
  })

  it('maps malformed provider output to CHOICE_INVALID', async () => {
    const base = createDeterministicProvider()
    const provider: GenerationProvider = {
      ...base,
      generateChoices: async () => ({ choices: 'broken' }),
    }

    await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INVALID')
      return true
    })
  })

  it('returns null for chapter 50 without calling provider', async () => {
    const generateChoices = vi.fn(async () => validBranch(49))
    const provider: GenerationProvider = {
      ...createDeterministicProvider(),
      generateChoices,
    }

    await expect(generateChoiceBranch({ provider }, choiceInput(50), executionOptions)).resolves.toBeNull()
    expect(generateChoices).not.toHaveBeenCalled()
  })

  it('rejects mismatched brief chapter before provider call', async () => {
    const input = choiceInput(12)
    input.chapterBrief = { ...input.chapterBrief, chapterNumber: 50 }
    const generateChoices = vi.fn(async () => validBranch())
    const provider: GenerationProvider = {
      ...createDeterministicProvider(),
      generateChoices,
    }

    await expect(generateChoiceBranch({ provider }, input, executionOptions)).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INPUT_INVALID')
      return true
    })
    expect(generateChoices).not.toHaveBeenCalled()
  })

  it('cannot bypass the chapter 50 guard with a mismatched brief chapter', async () => {
    const input = choiceInput(50)
    input.chapterBrief = { ...input.chapterBrief, chapterNumber: 49 }
    const generateChoices = vi.fn(async () => validBranch(49))
    const provider: GenerationProvider = {
      ...createDeterministicProvider(),
      generateChoices,
    }

    await expect(generateChoiceBranch({ provider }, input, executionOptions)).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INPUT_INVALID')
      return true
    })
    expect(generateChoices).not.toHaveBeenCalled()
  })

  it.each(['normal', 'special'] as const)(
    'supports chapter 49 %s validation flow',
    async (flow) => {
      const branch = validBranch(49)
      if (flow === 'special') {
        branch.outcomes.forEach((outcome) => {
          outcome.nextChapterNumber = null
          outcome.isEnding = true
        })
      }
      const provider: GenerationProvider = {
        ...createDeterministicProvider(),
        generateChoices: async () => branch,
      }

      await expect(generateChoiceBranch({ provider }, choiceInput(49), executionOptions)).resolves.toEqual(branch)
    },
  )
})

describe('createGatewayProvider choice adapter', () => {
  const envKeys = [
    'CUSTOM_LLM_BASE_URL',
    'CUSTOM_LLM_API_KEY',
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODELS',
    'NINEROUTER_BASE_URL',
    'NINEROUTER_API_KEY',
    'NARRATIVE_MODEL',
  ] as const
  const originalEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    streamTextMock.mockReset()
    createOpenAICompatibleMock.mockReset()
    recordGenerationProviderCallMock.mockReset()
    recordGenerationProviderCallMock.mockResolvedValue(undefined)
    createOpenAICompatibleMock.mockImplementation(({ name }: { name: string }) => (
      (modelId: string) => `${name}:${modelId}`
    ))
    for (const key of envKeys) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    originalEnv.clear()
  })

  it('uses dedicated choices route config and exact bounded prompt contract', async () => {
    const branch = validBranch()
    streamTextMock.mockReturnValue({
      text: Promise.resolve(JSON.stringify(branch)),
      usage: Promise.resolve({ inputTokens: 120, outputTokens: 80, totalTokens: 200 }),
    })
    const chapterRoute: AiModelRoute = {
      useCase: 'chapter_prose',
      provider: 'gateway',
      modelId: 'openai/chapter-model',
      fallbackModels: [],
      temperature: 0.7,
      maxOutputTokens: 4000,
      routeVersion: 'chapter-v1',
    }
    const choicesRoute: AiModelRoute = {
      useCase: 'choices',
      provider: 'gateway',
      modelId: 'openai/choice-model',
      fallbackModels: [{ provider: 'gateway', modelId: 'openai/choice-fallback' }],
      temperature: 0.2,
      maxOutputTokens: 900,
      routeVersion: 'choice-v1',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, chapterRoute, choicesRoute)

    await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).resolves.toEqual(branch)

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/choice-model',
      temperature: 0.2,
      maxOutputTokens: 900,
    }))
    const request = streamTextMock.mock.calls[0][0]
    expect(request.system).toContain('"choicePrompt"')
    expect(request.system).toContain('"choices"')
    expect(request.system).toContain('"outcomes"')
    expect(request.system).toContain('"routeDeltas"')
    expect(request.system).toContain('"trustDeltas"')
    expect(request.system).toContain('"flagsSet"')
    expect(request.system).toContain('"evidenceAdded"')
    expect(request.system).toContain('"endingBiasDeltas"')
    expect(request.system).toContain('"threadTouches"')
    expect(request.system).toContain('outcome.choiceId')
    expect(request.system).toContain('choices[].id')
    expect(request.system).toContain('nextChapterNumber = currentChapter + 1')
    expect(request.system).toContain('nextChapterNumber = 50')
    expect(request.system).toContain('nextChapterNumber = null')
    expect(request.system).toContain('tanpa markdown')
    expect(request.system).toContain('spoiler ending')
    expect(request.system).toContain('provider')
    expect(request.prompt).toContain('provider_signal_server_only')
    expect(request.prompt.length).toBeLessThanOrEqual(16_000)
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled()
  })

  it('rejects consumer-leaking response once without scanning internal prompt context', async () => {
    const leakingBranch = validBranch()
    leakingBranch.choices[0].label = 'Buka prompt rahasia'
    streamTextMock.mockReturnValue({ text: Promise.resolve(JSON.stringify(leakingBranch)) })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider()

    await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INVALID')
      return true
    })
    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock.mock.calls[0][0].prompt).toContain('provider_signal_server_only')
  })

  it('rejects oversized and unknown choice input before provider call', async () => {
    const input = choiceInput() as ChoiceInput & { hidden?: string }
    input.hidden = 'server-only'
    input.lastParagraphs[0] = 'x'.repeat(401)
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider()

    await expect(generateChoiceBranch({ provider }, input, executionOptions)).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INPUT_INVALID')
      return true
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('passes strict bounded projection to custom choice provider', async () => {
    process.env.CUSTOM_LLM_BASE_URL = 'https://choice.example.test/v1'
    const branch = validBranch()
    streamTextMock.mockReturnValue({
      text: Promise.resolve(JSON.stringify(branch)),
      usage: Promise.resolve({ inputTokens: 120, outputTokens: 80, totalTokens: 200 }),
    })
    const choicesRoute: AiModelRoute = {
      useCase: 'choices',
      provider: 'custom',
      modelId: 'choice-custom',
      fallbackModels: [],
      temperature: 0.2,
      maxOutputTokens: 900,
      routeVersion: 'choice-v1',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, undefined, choicesRoute)

    await generateChoiceBranch({ provider }, choiceInput(), executionOptions)

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'custom:choice-custom',
    }))
    expect(streamTextMock.mock.calls[0][0].prompt.length).toBeLessThanOrEqual(16_000)
  })

  it('executes dedicated primary then fallback model and logs successful usage', async () => {
    const branch = validBranch()
    const usage = { inputTokens: 120, outputTokens: 80, totalTokens: 200 }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    streamTextMock
      .mockImplementationOnce(() => { throw new Error('primary unavailable') })
      .mockReturnValueOnce({
        text: Promise.resolve(JSON.stringify(branch)),
        usage: Promise.resolve(usage),
      })
    const choicesRoute: AiModelRoute = {
      useCase: 'choices',
      provider: 'gateway',
      modelId: 'openai/choice-primary',
      fallbackModels: [{ provider: 'gateway', modelId: 'openai/choice-fallback' }],
      temperature: 0.2,
      maxOutputTokens: 900,
      routeVersion: 'choice-v1',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, undefined, choicesRoute)

    await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).resolves.toEqual(branch)

    expect(streamTextMock.mock.calls.map(([request]) => request.model)).toEqual([
      'openai/choice-primary',
      'openai/choice-fallback',
    ])
    expect(logSpy).toHaveBeenCalledWith('[v0] gateway-provider fallback', {
      workflowPhase: 'CHOICES_INITIAL',
      providerId: 'gateway',
      configuredModelId: 'openai/choice-primary',
      errorCode: 'PROVIDER_REQUEST_FAILED',
    })
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('primary unavailable')
    logSpy.mockRestore()
  })

  it('runs each OpenRouter env model as one explicit indexed request', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    process.env.OPENROUTER_MODELS = 'model-a, model-b'
    const branch = validBranch()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    streamTextMock
      .mockImplementationOnce(() => { throw new Error('model-a unavailable') })
      .mockReturnValueOnce({ text: Promise.resolve(JSON.stringify(branch)) })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider()

    await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).resolves.toEqual(branch)

    expect(streamTextMock.mock.calls.map(([request]) => request.model)).toEqual([
      'openrouter:model-a',
      'openrouter:model-b',
    ])
    expect(createOpenAICompatibleMock).toHaveBeenCalled()
    for (const [config] of createOpenAICompatibleMock.mock.calls) {
      expect(config).not.toHaveProperty('transformRequestBody')
    }
    expect(logSpy).toHaveBeenCalledWith('[v0] gateway-provider fallback', {
      workflowPhase: 'CHOICES_INITIAL',
      providerId: 'openrouter',
      configuredModelId: 'model-a',
      errorCode: 'PROVIDER_REQUEST_FAILED',
    })
    expect(recordGenerationProviderCallMock.mock.calls.at(-1)?.[0].candidate).toMatchObject({
      providerId: 'openrouter',
      configuredModelId: 'model-b',
      routeVersion: null,
      fallbackIndex: 1,
    })
    logSpy.mockRestore()
  })

  it.each(['usage rejection', 'logging throw'] as const)(
    'keeps successful choice text when telemetry has %s',
    async (failure) => {
      const branch = validBranch()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        if (failure === 'logging throw') throw new Error('telemetry sink unavailable')
      })
      streamTextMock.mockReturnValue({
        text: Promise.resolve(JSON.stringify(branch)),
        usage: failure === 'usage rejection'
          ? Promise.reject(new Error('usage unavailable'))
          : Promise.resolve({ totalTokens: 12 }),
      })
      const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
      const provider = createGatewayProvider()

      await expect(generateChoiceBranch({ provider }, choiceInput(), executionOptions)).resolves.toEqual(branch)
      expect(streamTextMock).toHaveBeenCalledOnce()
      logSpy.mockRestore()
    },
  )

  it('handles choice usage rejection before delayed successful text settles', async () => {
    const branch = validBranch()
    let resolveText: ((text: string) => void) | undefined
    const text = new Promise<string>((resolve) => {
      resolveText = resolve
    })
    streamTextMock.mockReturnValue({
      text,
      usage: Promise.reject(new Error('choice usage unavailable immediately')),
    })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider()

    const generation = generateChoiceBranch({ provider }, choiceInput(), executionOptions)
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolveText?.(JSON.stringify(branch))

    await expect(generation).resolves.toEqual(branch)
    expect(streamTextMock).toHaveBeenCalledOnce()
  })

  it('falls back to chapter route when no choices route is configured', async () => {
    streamTextMock.mockReturnValue({ text: Promise.resolve(JSON.stringify(validBranch())) })
    const chapterRoute: AiModelRoute = {
      useCase: 'chapter_prose',
      provider: 'gateway',
      modelId: 'openai/chapter-model',
      fallbackModels: [],
      temperature: 0.6,
      maxOutputTokens: 1200,
      routeVersion: 'chapter-v1',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, chapterRoute)

    await generateChoiceBranch({ provider }, choiceInput(), executionOptions)

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/chapter-model',
      temperature: 0.6,
      maxOutputTokens: 1200,
    }))
  })

  it('records invalid choice consume before fallback success with unique IDs', async () => {
    const invalidBranch = { ...validBranch(), choices: 'broken' }
    streamTextMock
      .mockReturnValueOnce(observedResult(JSON.stringify(invalidBranch), 'actual-choice-primary'))
      .mockReturnValueOnce(observedResult(JSON.stringify(validBranch()), 'actual-choice-fallback'))
    const choicesRoute: AiModelRoute = {
      useCase: 'choices',
      provider: 'gateway',
      modelId: 'openai/choice-primary',
      fallbackModels: [{ provider: 'gateway', modelId: 'openai/choice-fallback' }],
      temperature: 0.2,
      maxOutputTokens: 900,
      routeVersion: 'choice-v2',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, undefined, choicesRoute)

    await expect(generateChoiceBranch(
      { provider },
      choiceInput(),
      { telemetryContext, workflowPhase: 'CHOICES_INITIAL' },
    )).resolves.toEqual(validBranch())

    expect(recordGenerationProviderCallMock).toHaveBeenCalledTimes(2)
    const records = recordGenerationProviderCallMock.mock.calls
    expect(new Set(records.map(([start]) => start.providerCallId)).size).toBe(2)
    expect(records.map(([start, completion]) => ({
      phase: start.workflowPhase,
      fallbackIndex: start.candidate.fallbackIndex,
      actualModelId: completion.actualModelId,
      actualModelResolved: completion.actualModelResolved,
      outcome: completion.outcome,
    }))).toEqual([
      {
        phase: 'CHOICES_INITIAL',
        fallbackIndex: 0,
        actualModelId: 'actual-choice-primary',
        actualModelResolved: true,
        outcome: 'INVALID_RESPONSE',
      },
      {
        phase: 'CHOICES_INITIAL',
        fallbackIndex: 1,
        actualModelId: 'actual-choice-fallback',
        actualModelResolved: true,
        outcome: 'SUCCEEDED',
      },
    ])
  })

  it('records leaking choice content as CONTENT_REJECTED', async () => {
    const leakingBranch = validBranch()
    leakingBranch.choices[0].label = 'Buka prompt rahasia'
    streamTextMock.mockReturnValue(observedResult(JSON.stringify(leakingBranch), 'actual-choice-model'))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider()

    await expect(generateChoiceBranch(
      { provider },
      choiceInput(),
      { telemetryContext, workflowPhase: 'CHOICES_INITIAL' },
    )).rejects.toMatchObject({ code: 'CHOICE_INVALID' })

    expect(recordGenerationProviderCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPhase: 'CHOICES_INITIAL' }),
      expect.objectContaining({ outcome: 'CONTENT_REJECTED' }),
    )
  })
})
