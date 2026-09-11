import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { createDeterministicProvider, type WriterLengthRepairTelemetry } from '@/lib/ai-gateway/provider'
import { generateChapter } from '@/lib/ai-gateway/generate'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'
import { buildPreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

const { streamTextMock, createOpenAICompatibleMock, recordCallMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  createOpenAICompatibleMock: vi.fn(),
  recordCallMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('ai', () => ({ streamText: streamTextMock, Output: { object: vi.fn() } }))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: createOpenAICompatibleMock }))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: recordCallMock,
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

function route(fallback = false): AiModelRoute {
  return {
    useCase: 'chapter_prose', provider: 'gateway', modelId: 'writer-primary',
    fallbackModels: fallback ? [{ provider: 'gateway', modelId: 'writer-fallback' }] : [],
    temperature: 0.4, maxOutputTokens: 4096, routeVersion: 'writer-v1',
  }
}

function text(wordCount: number, options: { title?: boolean; closure?: boolean; leak?: boolean } = {}): string {
  const words = Array.from({ length: wordCount }, (_, index) => `kata${index + 1}`)
  if (options.leak) words[10] = 'prompt'
  const body = `${words.join(' ')}${options.closure === false ? '' : '.'}`
  return `${options.title === false ? 'Ambang Pintu' : 'JUDUL: Ambang Pintu'}\n\n${body}`
}

function observed(value: string, finishReason = 'stop') {
  return {
    text: Promise.resolve(value),
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
    finalStep: Promise.resolve({
      finishReason,
      response: { modelId: 'writer-primary' },
      providerMetadata: {},
    }),
  }
}

async function input() {
  const snapshot = buildFixtureSnapshot()
  const chapterNumber = 12
  const blueprint = snapshot.blueprints[chapterNumber - 1]
  const plan = await createDeterministicProvider().generatePlan({
    snapshot, blueprint, chapterNumber,
  })
  const brief = buildPreProseChapterBrief({
    storyId: snapshot.storyId,
    snapshot,
    blueprint,
    chapterNumber,
    continuation: null,
    chapterBrief: null,
  })
  return { snapshot, plan, brief }
}

beforeEach(() => {
  streamTextMock.mockReset()
  createOpenAICompatibleMock.mockReset()
  createOpenAICompatibleMock.mockImplementation(({ name }: { name: string }) => (
    (modelId: string) => `${name}:${modelId}`
  ))
  recordCallMock.mockReset().mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

async function write(responses: Array<{ value?: string; finish?: string; error?: Error }>, enabled = true) {
  const queued = [...responses]
  const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
  const provider = createGatewayProvider({}, undefined, route(true))
  const chapter = await input()
  const records: WriterLengthRepairTelemetry[] = []
  const identities: unknown[] = []
  const writerInferenceBudget = { used: 0, max: 2 as const }
  const promise = provider.writeChapter({ snapshot: chapter.snapshot, plan: chapter.plan, brief: chapter.brief }, {
    telemetryContext,
    workflowPhase: 'CHAPTER_PROSE_INITIAL',
    writerLengthRepairV1: { enabled },
    writerInferenceBudget,
    providerRuntime: { candidateTransport: (candidate) => {
      identities.push({
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        fallbackIndex: candidate.fallbackIndex,
      })
      const response = queued.shift()
      if (!response) throw new Error('FAKE_CANDIDATE_RESPONSE_MISSING')
      if (response.error) throw response.error
      return observed(response.value!, response.finish)
    } },
    observeWriterLengthRepair: (record) => records.push(record),
  })
  return { promise, records, identities, writerInferenceBudget }
}

describe('writerLengthRepairV1 gateway state machine', () => {
  it.each([799, 1001])('repairs eligible %i-word response on same candidate', async (wordCount) => {
    const run = await write([{ value: text(wordCount) }, { value: text(900) }])

    await expect(run.promise).resolves.toMatchObject({ title: 'Ambang Pintu', wordCount: 900 })
    expect(run.identities).toEqual([
      { providerId: 'gateway', modelId: 'writer-primary', fallbackIndex: 0 },
      { providerId: 'gateway', modelId: 'writer-primary', fallbackIndex: 0 },
    ])
    expect(run.identities).toHaveLength(2)
    expect(run.writerInferenceBudget.used).toBe(2)
    expect(run.records).toEqual([{
      firstPassOutcome: 'LENGTH_REPAIR_ELIGIBLE', repairAttempted: true,
      repairOutcome: 'ACCEPTED', finalWriterOutcome: 'ACCEPTED',
    }])
  })

  it.each([
    ['severe short', [{ value: text(699) }]],
    ['parser failure', [{ value: '' }]],
    ['missing title', [{ value: text(799, { title: false }) }]],
    ['missing closure', [{ value: text(799, { closure: false }) }]],
    ['capped finish', [{ value: text(799), finish: 'length' }]],
  ] as const)('does not repair %s', async (_label, responses) => {
    const run = await write([...responses])
    await expect(run.promise).rejects.toThrow()
    expect(run.identities).toHaveLength(1)
    expect(run.records).toEqual([{
      firstPassOutcome: 'REJECTED', repairAttempted: false,
      repairOutcome: 'NOT_ATTEMPTED', finalWriterOutcome: 'REJECTED',
    }])
  })

  it.each([
    ['parser', [{ value: text(799) }, { value: '' }]],
    ['closure', [{ value: text(799) }, { value: text(900, { closure: false }) }]],
    ['still short', [{ value: text(799) }, { value: text(799) }]],
    ['capped', [{ value: text(799) }, { value: text(900), finish: 'length' }]],
    ['transport', [{ value: text(799) }, { error: new Error('offline transport failure') }]],
    ['leak', [{ value: text(799) }, { value: text(900, { leak: true }) }]],
  ] as const)('fails closed after repair %s failure without fallback or leak retry', async (_label, responses) => {
    const run = await write([...responses])
    await expect(run.promise).rejects.toThrow()
    expect(run.identities).toHaveLength(2)
    expect(run.identities[0]).toEqual(run.identities[1])
    expect(run.records).toEqual([{
      firstPassOutcome: 'LENGTH_REPAIR_ELIGIBLE', repairAttempted: true,
      repairOutcome: 'REJECTED', finalWriterOutcome: 'REJECTED',
    }])
  })

  it('accepts first pass in one call and emits metadata without prose, title, prompt, or canon', async () => {
    const run = await write([{ value: text(900) }])
    await expect(run.promise).resolves.toMatchObject({ wordCount: 900 })
    expect(run.identities).toHaveLength(1)
    expect(run.records).toEqual([{
      firstPassOutcome: 'ACCEPTED', repairAttempted: false,
      repairOutcome: 'NOT_ATTEMPTED', finalWriterOutcome: 'ACCEPTED',
    }])
    const serialized = JSON.stringify(run.records)
    for (const forbidden of ['Ambang Pintu', 'kata1', 'prompt:', 'paragraphs', 'canon']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('blocks Layer A third writer inference and emits one terminal record', async () => {
    streamTextMock
      .mockReturnValueOnce(observed(text(799)))
      .mockReturnValueOnce(observed(text(900)))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route(true))
    const snapshot = buildFixtureSnapshot()
    const chapterNumber = 12
    const blueprint = snapshot.blueprints[chapterNumber - 1]
    const brief = buildPreProseChapterBrief({
      storyId: snapshot.storyId,
      snapshot,
      blueprint,
      chapterNumber,
      continuation: null,
      chapterBrief: null,
    })
    const writerInferenceBudget = { used: 0, max: 2 as const }
    const records: WriterLengthRepairTelemetry[] = []

    await expect(generateChapter({ provider }, {
      snapshot,
      blueprint,
      chapterNumber,
      brief,
      injectDefects: ['NO_CHOICE'],
      executionOptions: {
        telemetryContext,
        workflowPhase: 'CHAPTER_PROSE_INITIAL',
        writerLengthRepairV1: { enabled: true },
        writerInferenceBudget,
        observeWriterLengthRepair: (record) => records.push(record),
      },
    })).rejects.toThrow('WRITER_INFERENCE_BUDGET_EXHAUSTED')

    expect(streamTextMock).toHaveBeenCalledTimes(2)
    expect(writerInferenceBudget).toEqual({ used: 2, max: 2 })
    expect(records).toHaveLength(1)
  })

  it('does not let a throwing telemetry observer reject accepted prose', async () => {
    const chapter = await input()
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route())
    streamTextMock.mockReturnValueOnce(observed(text(900)))

    await expect(provider.writeChapter({ snapshot: chapter.snapshot, plan: chapter.plan, brief: chapter.brief }, {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      writerLengthRepairV1: { enabled: true },
      writerInferenceBudget: { used: 0, max: 2 },
      observeWriterLengthRepair: () => {
        throw new Error('TELEMETRY_SINK_FAILED')
      },
    })).resolves.toMatchObject({ wordCount: 900 })

    expect(streamTextMock).toHaveBeenCalledTimes(1)
  })

  it('creates one shared max-two writer budget for enabled generateChapter calls', async () => {
    streamTextMock.mockReturnValueOnce(observed(text(900)))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route())
    const snapshot = buildFixtureSnapshot()
    const chapterNumber = 12
    const blueprint = snapshot.blueprints[chapterNumber - 1]
    const brief = buildPreProseChapterBrief({
      storyId: snapshot.storyId,
      snapshot,
      blueprint,
      chapterNumber,
      continuation: null,
      chapterBrief: null,
    })
    const executionOptions = {
      telemetryContext,
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      writerLengthRepairV1: { enabled: true },
    }

    await expect(generateChapter({ provider }, {
      snapshot,
      blueprint,
      chapterNumber,
      brief,
      executionOptions,
    })).resolves.toMatchObject({ status: 'PUBLISHED' })

    expect(executionOptions).toHaveProperty('writerInferenceBudget', { used: 1, max: 2 })
  })

  it('keeps legacy fallback behavior when policy disabled', async () => {
    streamTextMock
      .mockImplementationOnce(() => { throw new Error('primary failed') })
      .mockReturnValueOnce(observed(text(900)))
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route(true))
    const chapter = await input()

    await expect(provider.writeChapter({ snapshot: chapter.snapshot, plan: chapter.plan, brief: chapter.brief }, {
      telemetryContext, workflowPhase: 'CHAPTER_PROSE_INITIAL',
      writerLengthRepairV1: { enabled: false },
    })).resolves.toMatchObject({ wordCount: 900 })
    expect(streamTextMock).toHaveBeenCalledTimes(2)
  })
})
