import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { createDeterministicProvider, type GenerationProvider } from '@/lib/ai-gateway/provider'
import { generateChapter } from '@/lib/ai-gateway/generate'
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
vi.mock('@lakoku/narrative-core', async () => {
  const actual = await import('@/lib/narrative/index')
  return actual
})
vi.mock('ai', () => ({ streamText: streamTextMock }))
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
