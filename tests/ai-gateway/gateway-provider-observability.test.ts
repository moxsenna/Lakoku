import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { createDeterministicProvider, type GenerationProvider } from '@/lib/ai-gateway/provider'
import { generateChapter } from '@/lib/ai-gateway/generate'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'

const {
  streamTextMock,
  generateTextMock,
  createOpenAICompatibleMock,
  recordGenerationProviderCallMock,
} = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  generateTextMock: vi.fn(),
  createOpenAICompatibleMock: vi.fn(),
  recordGenerationProviderCallMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/narrative-core', async () => {
  const actual = await import('@/lib/narrative/index')
  return actual
})
vi.mock('ai', () => ({
  streamText: streamTextMock,
  generateText: generateTextMock,
  Output: { object: vi.fn((value) => value) },
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

const envKeys = [
  'CUSTOM_LLM_BASE_URL',
  'CUSTOM_LLM_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODELS',
  'NINEROUTER_BASE_URL',
  'NINEROUTER_API_KEY',
  'NARRATIVE_MODEL',
  'LAKOKU_CHOICES_NATIVE_SCHEMA',
  'LAKOKU_CHOICE_JITTER_MIN_MS',
  'LAKOKU_CHOICE_JITTER_MAX_MS',
] as const
const originalEnv = new Map<string, string | undefined>()

function observedResult(text: string, modelId?: string) {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 40, outputTokens: 60, totalTokens: 100 }),
    finalStep: Promise.resolve({
      response: modelId === undefined ? {} : { modelId },
      providerMetadata: {},
    }),
  }
}

function prose(title: string, paragraphs: string[]): string {
  return [`JUDUL: ${title}`, '', ...paragraphs].join('\n\n')
}

function route(fallbackModels: AiModelRoute['fallbackModels'] = []): AiModelRoute {
  return {
    useCase: 'chapter_prose',
    provider: 'gateway',
    modelId: 'openai/chapter-primary',
    fallbackModels,
    temperature: 0.6,
    maxOutputTokens: 4000,
    routeVersion: 'chapter-v2',
  }
}

async function chapterInput() {
  const snapshot = buildFixtureSnapshot()
  const chapterNumber = 12
  const base = createDeterministicProvider()
  const plan = await base.generatePlan({
    snapshot,
    blueprint: snapshot.blueprints[chapterNumber - 1],
    chapterNumber,
  })
  return { snapshot, chapterNumber, plan }
}

beforeEach(() => {
  streamTextMock.mockReset()
  generateTextMock.mockReset()
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

describe('createGatewayProvider prose observability', () => {
  it('worker ownership AbortSignal reaches the actual prose provider request', async () => {
    const paragraphs = ['Rani membuka pintu lama.']
    streamTextMock.mockReturnValue(observedResult(prose('Pintu Lama', paragraphs)))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route())
    const input = await chapterInput()
    const controller = new AbortController()

    await provider.writeChapter({ snapshot: input.snapshot, plan: input.plan }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      signal: controller.signal,
    })

    const combined = streamTextMock.mock.calls[0][0].abortSignal as AbortSignal
    expect(combined.aborted).toBe(false)
    controller.abort()
    expect(combined.aborted).toBe(true)
  })

  it('does not traverse prose fallback when an abort-class request fails', async () => {
    const abort = new DOMException('ownership lost', 'AbortError')
    streamTextMock.mockImplementationOnce(() => { throw abort })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route([
      { provider: 'gateway', modelId: 'openai/chapter-fallback' },
    ]))
    const input = await chapterInput()

    await expect(provider.writeChapter({ snapshot: input.snapshot, plan: input.plan }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
    })).rejects.toBe(abort)

    expect(streamTextMock).toHaveBeenCalledTimes(1)
  })

  it('stops prose leak repair when provider ignores abort and resolves leaked output', async () => {
    let resolveText: ((value: string) => void) | undefined
    streamTextMock.mockReturnValue({
      text: new Promise<string>((resolve) => { resolveText = resolve }),
      usage: Promise.resolve({}),
      finalStep: Promise.resolve({ response: {}, providerMetadata: {} }),
    })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route())
    const input = await chapterInput()
    const controller = new AbortController()
    const run = provider.writeChapter({ snapshot: input.snapshot, plan: input.plan }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(resolveText).toBeTypeOf('function'))

    controller.abort()
    resolveText?.(prose('Prompt Rahasia', ['Rani membuka pintu.']))

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(streamTextMock).toHaveBeenCalledTimes(1)
  })

  it('stops native choice parsing and fallback after abort without another request', async () => {
    process.env.LAKOKU_CHOICES_NATIVE_SCHEMA = 'on'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'
    let resolveText: ((value: string) => void) | undefined
    generateTextMock.mockReturnValue({
      text: new Promise<string>((resolve) => { resolveText = resolve }),
      usage: Promise.resolve({}),
      finalStep: Promise.resolve({ response: {}, providerMetadata: {} }),
    })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const choicesRoute: AiModelRoute = {
      ...route([{ provider: 'gateway', modelId: 'openai/choice-fallback' }]),
      useCase: 'choices',
      modelId: 'openai/choice-primary',
    }
    const provider = createGatewayProvider(undefined, undefined, route(), choicesRoute)
    const controller = new AbortController()
    const run = provider.generateChoices?.({
      storyId: 'story-a',
      currentChapter: 12,
      draft: { title: 'Bab 12', lastParagraphs: ['satu', 'dua', 'tiga'] },
      chapterBrief: {
        phase: 'rising', chapterGoal: 'Maju', mustInclude: [], mustNotInclude: [],
        mustNotReveal: [], plotDebtsToProgress: [], plotDebtsToClose: [],
        remainingChapters: 38, endingRunway: 'expansion',
      },
      routeState: { truth: 0, risk: 0, secrecy: 0, empathy: 0, trust: {}, flags: {}, endingBias: {}, evidence: [] },
      choiceHistory: [], lockedEndingKey: null,
      canon: { activeCharacters: [], activeThreads: [], pendingReveals: [] },
    }, {
      telemetryContext,
      workflowPhase: 'CHOICES_INITIAL',
      signal: controller.signal,
      callBudget: { used: 0, max: 5 },
    })
    await vi.waitFor(() => expect(generateTextMock).toHaveBeenCalledTimes(1))
    expect(resolveText).toBeTypeOf('function')

    controller.abort()
    resolveText?.('{"actions":[]}')

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(generateTextMock.mock.calls[0][0]).toHaveProperty('experimental_output')
  })

  it('uses explicit candidate transport for synthetic choice identities without a configured choices route', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route())
    const candidateTransport = vi.fn(() => observedResult(JSON.stringify({
      question: 'Apa yang harus dilakukan Maya?',
      actions: [],
    })))

    await expect(provider.generateChoices?.({
      storyId: 'story-a',
      currentChapter: 12,
      draft: { title: 'Bab 12', lastParagraphs: ['satu', 'dua', 'tiga'] },
      chapterBrief: {
        phase: 'rising', chapterGoal: 'Maju', mustInclude: [], mustNotInclude: [],
        mustNotReveal: [], plotDebtsToProgress: [], plotDebtsToClose: [],
        remainingChapters: 38, endingRunway: 'expansion',
      },
      routeState: { truth: 0, risk: 0, secrecy: 0, empathy: 0, trust: {}, flags: {}, endingBias: {}, evidence: [] },
      choiceHistory: [], lockedEndingKey: null,
      canon: { activeCharacters: [], activeThreads: [], pendingReveals: [] },
    }, {
      telemetryContext,
      workflowPhase: 'CHOICES_INITIAL',
      providerRuntime: { candidateTransport },
    })).resolves.toEqual({
      question: 'Apa yang harus dilakukan Maya?',
      actions: [],
    })

    expect(candidateTransport).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'choice',
      providerId: 'gateway',
      modelId: 'openai/gpt-4.1-mini',
      fallbackIndex: 0,
      execute: expect.any(Function),
    }))
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('passes malformed transport text through parsing and retries fallback after consume rejection', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route(), route([
      { provider: 'gateway', modelId: 'openai/choice-fallback' },
    ]))
    const texts = ['{not-json', JSON.stringify({ question: 'Pilih?', actions: [] })]
    const candidateTransport = vi.fn(() => observedResult(texts.shift()!))
    const consume = vi.fn((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('DOWNSTREAM_SCHEMA_REJECTED')
      return value
    })

    await expect(provider.generateChoices?.({
      storyId: 'story-a', currentChapter: 12,
      draft: { title: 'Bab 12', lastParagraphs: ['satu', 'dua', 'tiga'] },
      chapterBrief: { phase: 'rising', chapterGoal: 'Maju', mustInclude: [], mustNotInclude: [], mustNotReveal: [], plotDebtsToProgress: [], plotDebtsToClose: [], remainingChapters: 38, endingRunway: 'expansion' },
      routeState: { truth: 0, risk: 0, secrecy: 0, empathy: 0, trust: {}, flags: {}, endingBias: {}, evidence: [] },
      choiceHistory: [], lockedEndingKey: null, canon: { activeCharacters: [], activeThreads: [], pendingReveals: [] },
    }, { telemetryContext, workflowPhase: 'CHOICES_INITIAL', providerRuntime: { candidateTransport }, consume })).resolves.toEqual({ question: 'Pilih?', actions: [] })

    expect(consume).toHaveBeenCalledTimes(2)
    expect(consume.mock.calls[0]?.[0]).toBe('{not-json')
    expect(candidateTransport).toHaveBeenNthCalledWith(1, expect.objectContaining({ fallbackIndex: 0 }))
    expect(candidateTransport).toHaveBeenNthCalledWith(2, expect.objectContaining({ fallbackIndex: 1 }))
  })

  it('uses injected prose candidate transport while preserving timeout invalid fallback policy', async () => {
    const timeout = new DOMException('candidate A timed out', 'TimeoutError')
    const invalid = new Error('candidate A invalid')
    const paragraphs = ['Rani membuka pintu lama.', 'Udara dingin menyentuh wajahnya.']
    streamTextMock
      .mockImplementationOnce(() => { throw timeout })
      .mockImplementationOnce(() => { throw invalid })
      .mockReturnValueOnce(observedResult(prose('Pintu Lama', paragraphs)))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route([
      { provider: 'gateway', modelId: 'openai/chapter-primary-invalid' },
      { provider: 'gateway', modelId: 'openai/chapter-fallback' },
    ]))
    const input = await chapterInput()
    const calls: Array<{ kind: string; modelId: string; fallbackIndex: number }> = []
    const candidateTransport = vi.fn((candidate: {
      kind: string
      modelId: string
      fallbackIndex: number
      execute: () => unknown
    }) => {
      calls.push(candidate)
      return candidate.execute()
    })

    await expect(provider.writeChapter({ snapshot: input.snapshot, plan: input.plan }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      providerRuntime: { candidateTransport },
    })).resolves.toMatchObject({ title: 'Pintu Lama', paragraphs })

    expect(calls.map(({ kind, modelId, fallbackIndex }) => ({ kind, modelId, fallbackIndex }))).toEqual([
      { kind: 'prose', modelId: 'openai/chapter-primary', fallbackIndex: 0 },
      { kind: 'prose', modelId: 'openai/chapter-primary-invalid', fallbackIndex: 1 },
      { kind: 'prose', modelId: 'openai/chapter-fallback', fallbackIndex: 2 },
    ])
  })

  it('records provider failure before fallback success with unique IDs and actual response model', async () => {
    const paragraphs = ['Rani membuka pintu lama.', 'Udara dingin menyentuh wajahnya.']
    streamTextMock
      .mockImplementationOnce(() => { throw new Error('primary unavailable') })
      .mockReturnValueOnce(observedResult(prose('Pintu Lama', paragraphs), 'actual-chapter-fallback'))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route([
      { provider: 'gateway', modelId: 'openai/chapter-fallback' },
    ]))
    const input = await chapterInput()

    await expect(provider.writeChapter({
      snapshot: input.snapshot,
      plan: input.plan,
    }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
    })).resolves.toMatchObject({ title: 'Pintu Lama', paragraphs })

    expect(streamTextMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxRetries: 0 }))
    expect(streamTextMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ maxRetries: 0 }))
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
        phase: 'CHAPTER_PROSE_INITIAL',
        fallbackIndex: 0,
        actualModelId: 'openai/chapter-primary',
        actualModelResolved: false,
        outcome: 'PROVIDER_ERROR',
      },
      {
        phase: 'CHAPTER_PROSE_INITIAL',
        fallbackIndex: 1,
        actualModelId: 'actual-chapter-fallback',
        actualModelResolved: true,
        outcome: 'SUCCEEDED',
      },
    ])
  })

  it('logs only controlled fallback fields without raw provider error text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    streamTextMock.mockImplementationOnce(() => {
      throw new Error('provider-secret-api-key')
    })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route())
    const input = await chapterInput()

    await expect(provider.writeChapter({ snapshot: input.snapshot, plan: input.plan }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
    })).rejects.toThrow()

    expect(JSON.stringify(log.mock.calls)).not.toContain('provider-secret-api-key')
    expect(log).toHaveBeenCalledWith('[v0] gateway-provider fallback', {
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      providerId: 'gateway',
      configuredModelId: 'openai/chapter-primary',
      errorCode: 'PROVIDER_REQUEST_FAILED',
      // Class name only — raw messages/stacks must never reach logs.
      errorName: 'Error',
    })
  })

  it('records leak repair on same fallback index with new ID', async () => {
    streamTextMock
      .mockReturnValueOnce(observedResult(prose('Prompt Rahasia', ['Rani membuka pintu.']), 'actual-primary'))
      .mockReturnValueOnce(observedResult(prose('Pintu Lama', ['Rani membuka pintu.']), 'actual-primary'))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, route())
    const input = await chapterInput()

    await provider.writeChapter({ snapshot: input.snapshot, plan: input.plan }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
    })

    expect(streamTextMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxRetries: 0 }))
    expect(streamTextMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ maxRetries: 0 }))
    expect(recordGenerationProviderCallMock).toHaveBeenCalledTimes(2)
    const records = recordGenerationProviderCallMock.mock.calls
    expect(new Set(records.map(([start]) => start.providerCallId)).size).toBe(2)
    expect(records.map(([start, completion]) => ({
      phase: start.workflowPhase,
      fallbackIndex: start.candidate.fallbackIndex,
      outcome: completion.outcome,
    }))).toEqual([
      { phase: 'CHAPTER_PROSE_INITIAL', fallbackIndex: 0, outcome: 'CONTENT_REJECTED' },
      { phase: 'CHAPTER_PROSE_LEAK_REPAIR', fallbackIndex: 0, outcome: 'SUCCEEDED' },
    ])
  })

  it('entry abort skips plan before generateChapter work', async () => {
    const snapshot = buildFixtureSnapshot()
    const chapterNumber = 12
    const base = createDeterministicProvider()
    const controller = new AbortController()
    controller.abort()
    let planCalls = 0
    let writeCalls = 0
    const provider: GenerationProvider = {
      ...base,
      async generatePlan(input) {
        planCalls += 1
        return base.generatePlan(input)
      },
      async writeChapter(input, options) {
        writeCalls += 1
        return base.writeChapter(input, options)
      },
    }

    await expect(generateChapter({ provider }, {
      snapshot,
      blueprint: snapshot.blueprints[chapterNumber - 1],
      chapterNumber,
      executionOptions: {
        telemetryContext,
        workflowPhase: 'CHAPTER_PROSE_INITIAL',
        signal: controller.signal,
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(planCalls).toBe(0)
    expect(writeCalls).toBe(0)
  })

  it.each(['A', 'B'] as const)('stops before Layer %s repair after abort', async (layer) => {
    const snapshot = buildFixtureSnapshot()
    const chapterNumber = 12
    const base = createDeterministicProvider()
    const controller = new AbortController()
    let writes = 0
    const provider: GenerationProvider = {
      ...base,
      async writeChapter(input, options) {
        writes += 1
        const draft = await base.writeChapter(input, options)
        if (writes === 1) controller.abort()
        return draft
      },
    }
    const finding = {
      severity: 'MAJOR' as const,
      code: `PERSISTENT_${layer}`,
      message: `Persistent Layer ${layer} finding.`,
    }
    const narrative = await import('@lakoku/narrative-core')
    const layerSpy = layer === 'A'
      ? vi.spyOn(narrative, 'validateLayerA').mockReturnValue({ ok: false, findings: [finding], blocking: false })
      : vi.spyOn(narrative, 'validateLayerB').mockReturnValue({ findings: [finding], blocking: false })
    const bypassSpy = layer === 'B'
      ? vi.spyOn(narrative, 'validateLayerA').mockReturnValue({ ok: true, findings: [], blocking: false })
      : undefined

    await expect(generateChapter({ provider }, {
      snapshot,
      blueprint: snapshot.blueprints[chapterNumber - 1],
      chapterNumber,
      executionOptions: {
        telemetryContext,
        workflowPhase: 'CHAPTER_PROSE_INITIAL',
        signal: controller.signal,
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(writes).toBe(1)
    bypassSpy?.mockRestore()
    layerSpy.mockRestore()
  })

  it.each([
    ['A', ['CHAPTER_PROSE_INITIAL', 'CHAPTER_PROSE_LAYER_A_REPAIR_1', 'CHAPTER_PROSE_LAYER_A_REPAIR_2']],
    ['B', ['CHAPTER_PROSE_INITIAL', 'CHAPTER_PROSE_LAYER_B_REPAIR_1', 'CHAPTER_PROSE_LAYER_B_REPAIR_2']],
  ] as const)('records exact Layer %s prose phases', async (layer, expectedPhases) => {
    const snapshot = buildFixtureSnapshot()
    const chapterNumber = 12
    const base = createDeterministicProvider()
    const rawPlan = await base.generatePlan({
      snapshot,
      blueprint: snapshot.blueprints[chapterNumber - 1],
      chapterNumber,
    })
    const persistentFinding = {
      severity: 'MAJOR' as const,
      code: `PERSISTENT_${layer}`,
      message: `Persistent Layer ${layer} finding.`,
    }
    const provider: GenerationProvider = {
      ...base,
      async writeChapter(input, options) {
        streamTextMock.mockReturnValueOnce(observedResult(prose('Bab Uji', ['Rani membuka pintu.'])))
        const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
        const gateway = createGatewayProvider(undefined, undefined, route())
        return gateway.writeChapter(input, options)
      },
    }
    const deps = {
      provider,
    }
    const narrative = await import('@lakoku/narrative-core')
    const layerSpy = layer === 'A'
      ? vi.spyOn(narrative, 'validateLayerA').mockReturnValue({
          ok: false,
          findings: [persistentFinding],
          blocking: false,
        })
      : vi.spyOn(narrative, 'validateLayerB').mockReturnValue({
          findings: [persistentFinding],
          blocking: false,
        })
    const bypassSpy = layer === 'B'
      ? vi.spyOn(narrative, 'validateLayerA').mockReturnValue({
          ok: true,
          findings: [],
          blocking: false,
        })
      : undefined

    await generateChapter(deps, {
      snapshot,
      blueprint: snapshot.blueprints[chapterNumber - 1],
      chapterNumber,
      executionOptions: {
        telemetryContext,
        workflowPhase: 'CHAPTER_PROSE_INITIAL',
      },
    })

    expect(recordGenerationProviderCallMock.mock.calls.map(([start]) => start.workflowPhase))
      .toEqual(expectedPhases)
    bypassSpy?.mockRestore()
    layerSpy.mockRestore()
    expect(rawPlan).toBeDefined()
  })
})
