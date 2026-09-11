import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'

const { streamTextMock, createOpenAICompatibleMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  createOpenAICompatibleMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('ai', () => ({
  streamText: streamTextMock,
  Output: { object: vi.fn((value) => value) },
}))
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(async () => undefined),
}))

const telemetryContext = {
  userId: '10000000-0000-4000-8000-000000000001',
  storyId: 'fixture:m10g-budget',
  chapterNumber: 12,
  generationKind: 'personalized',
  jobId: null,
  correlationId: '20000000-0000-4000-8000-000000000002',
  attemptNumber: null,
} as const

function route(useCase: AiModelRoute['useCase'], fallbackModels: AiModelRoute['fallbackModels'] = []): AiModelRoute {
  return {
    useCase,
    provider: 'gateway',
    modelId: `${useCase}-primary`,
    fallbackModels,
    temperature: 0,
    maxOutputTokens: 4096,
    routeVersion: `${useCase}-v1`,
  }
}

function observed(text: string) {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
    finalStep: Promise.resolve({
      finishReason: 'stop',
      response: { modelId: 'offline-model' },
      providerMetadata: {},
    }),
  }
}

function choiceInput() {
  return {
    storyId: 'fixture:m10g-budget',
    currentChapter: 12,
    draft: { title: 'Bab 12', lastParagraphs: ['satu', 'dua', 'tiga'] as [string, string, string] },
    chapterBrief: {
      phase: 'rising', chapterGoal: 'Maju', mustInclude: [], mustNotInclude: [],
      mustNotReveal: [], plotDebtsToProgress: [], plotDebtsToClose: [],
      remainingChapters: 38, endingRunway: 'expansion' as const,
    },
    routeState: {
      truth: 0, risk: 0, secrecy: 0, empathy: 0,
      trust: {}, flags: {}, endingBias: {}, evidence: [],
    },
    choiceHistory: [],
    lockedEndingKey: null,
    canon: { activeCharacters: [], activeThreads: [], pendingReveals: [] },
  }
}

function judgeInput() {
  return {
    previousEnding: ['Pintu tertutup.'],
    choiceLabel: 'Buka pintu',
    consequence: ['Pintu terbuka.'],
    routeSummary: 'truth=1',
    chapterTitle: 'Ambang',
    chapterProse: 'Pintu terbuka dan perjalanan berlanjut.',
  }
}

beforeEach(() => {
  streamTextMock.mockReset()
  createOpenAICompatibleMock.mockReset()
  createOpenAICompatibleMock.mockImplementation(({ name }: { name: string }) => (
    (modelId: string) => `${name}:${modelId}`
  ))
  delete process.env.CUSTOM_LLM_BASE_URL
  delete process.env.NINEROUTER_BASE_URL
  delete process.env.NINEROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_MODELS
  process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
  process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'
})

describe('M10-G global inference budget contract', () => {
  it('reserves atomically within one Node process and never exceeds hardLimit', async () => {
    const { createGlobalInferenceBudget } = await import('@/lib/ai-gateway/global-inference-budget.contract')
    const budget = createGlobalInferenceBudget({ runId: 'm10g-run-1', hardLimit: 1 })
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => budget.reserve('prose', { workflowPhase: 'A' })),
      Promise.resolve().then(() => budget.reserve('semantic', { workflowPhase: 'B' })),
    ])

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(budget.consumed).toBe(1)
  })

  it('fails closed in explicit M10-G mode when context is missing before transport', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route('chapter_prose'), route('choices'))
    const candidateTransport = vi.fn(() => observed('{"question":"Pilih?","actions":[]}'))

    await expect(provider.generateChoices?.(choiceInput(), {
      telemetryContext,
      workflowPhase: 'CHOICES_INITIAL',
      m10gMode: true,
      providerRuntime: { candidateTransport },
    })).rejects.toThrow('M10G_GLOBAL_INFERENCE_BUDGET_REQUIRED')

    expect(candidateTransport).not.toHaveBeenCalled()
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('counts each fallback candidate and blocks cap+1 before transport', async () => {
    const { createGlobalInferenceBudget } = await import('@/lib/ai-gateway/global-inference-budget.contract')
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route('chapter_prose'), route('choices', [
      { provider: 'gateway', modelId: 'choices-fallback' },
    ]))
    const budget = createGlobalInferenceBudget({ runId: 'm10g-run-fallback', hardLimit: 1 })
    const candidateTransport = vi.fn(() => observed('{not-json'))

    await expect(provider.generateChoices?.(choiceInput(), {
      telemetryContext,
      workflowPhase: 'CHOICES_INITIAL',
      m10gMode: true,
      globalInferenceBudget: budget,
      providerRuntime: { candidateTransport },
    })).rejects.toThrow('M10G_GLOBAL_INFERENCE_BUDGET_EXHAUSTED')

    expect(candidateTransport).toHaveBeenCalledTimes(1)
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(budget.consumed).toBe(1)
  })

  it('routes semantic judge through candidateTransport and charges same budget once', async () => {
    const { createGlobalInferenceBudget } = await import('@/lib/ai-gateway/global-inference-budget.contract')
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const judgeRoute = route('continuity_judge')
    const provider = createGatewayProvider({}, undefined, route('chapter_prose'), route('choices'), judgeRoute)
    const budget = createGlobalInferenceBudget({ runId: 'm10g-run-semantic', hardLimit: 2 })
    const candidateTransport = vi.fn(() => observed('{"verdict":"PASS","codes":[]}'))

    await expect(provider.evaluateSemanticContinuity?.(judgeInput(), {
      telemetryContext,
      workflowPhase: 'CHAPTER_CONTINUITY_JUDGE_INITIAL',
      m10gMode: true,
      globalInferenceBudget: budget,
      providerRuntime: { candidateTransport },
    })).resolves.toEqual({ verdict: 'PASS', codes: [] })

    expect(candidateTransport).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'semantic',
      modelId: 'continuity_judge-primary',
      fallbackIndex: 0,
      execute: expect.any(Function),
    }))
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(budget.consumed).toBe(1)
  })

  it('does not charge observers or failures before candidate transport', async () => {
    const { createGlobalInferenceBudget } = await import('@/lib/ai-gateway/global-inference-budget.contract')
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider({}, undefined, route('chapter_prose'), route('choices'))
    const budget = createGlobalInferenceBudget({ runId: 'm10g-run-preflight', hardLimit: 2 })
    const observer = vi.fn()
    const candidateTransport = vi.fn()

    await expect(provider.generateChoices?.(choiceInput(), {
      telemetryContext,
      workflowPhase: 'CHOICES_INITIAL',
      m10gMode: true,
      globalInferenceBudget: budget,
      choiceDeadlineAtMs: 0,
      observeModelCall: observer,
      providerRuntime: { candidateTransport },
    })).rejects.toThrow('CHOICE_WORKFLOW_TIMEOUT')

    expect(observer).not.toHaveBeenCalled()
    expect(candidateTransport).not.toHaveBeenCalled()
    expect(budget.consumed).toBe(0)
  })
})
