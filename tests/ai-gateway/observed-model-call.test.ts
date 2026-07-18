import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import {
  ContentRejectedError,
  InvalidModelResponseError,
  executeObservedModelCall,
  type ObservedModelCallDeps,
  type ObservedModelCallInput,
} from '@/lib/ai-gateway/observed-model-call.server'

const context = {
  userId: '10000000-0000-4000-8000-000000000001',
  storyId: 'story-1',
  chapterNumber: 2,
  generationKind: 'standard',
  jobId: null,
  correlationId: '20000000-0000-4000-8000-000000000002',
  attemptNumber: null,
} as const

const candidate = {
  providerId: 'openrouter',
  configuredModelId: 'configured-model',
  routeVersion: 'chapter-v1',
  fallbackIndex: 1,
} as const

type FakeResult = {
  text: PromiseLike<string>
  usage: PromiseLike<{
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    raw?: unknown
  }>
  finalStep: PromiseLike<{
    response: {
      modelId?: string
      headers?: Record<string, string>
      body?: unknown
      messages?: unknown
    }
    request?: unknown
    providerMetadata?: unknown
  }>
}

function result(overrides: Partial<FakeResult> = {}): FakeResult {
  return {
    text: Promise.resolve('model text'),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    finalStep: Promise.resolve({
      response: { modelId: 'actual-model' },
      providerMetadata: {
        openrouter: {
          cost: 0.12345678,
          currency: 'USD',
        },
      },
    }),
    ...overrides,
  }
}

function input<T = string>(overrides: Partial<ObservedModelCallInput<T>> = {}): ObservedModelCallInput<T> {
  return {
    context,
    candidate,
    useCase: 'chapter_generation',
    workflowPhase: 'CHAPTER_PROSE_INITIAL',
    call: () => result() as never,
    consume: ((text: string) => text.toUpperCase()) as ObservedModelCallInput<T>['consume'],
    ...overrides,
  }
}

function deps(overrides: Partial<ObservedModelCallDeps> = {}): ObservedModelCallDeps {
  const wallTimes = [
    new Date('2026-07-18T12:00:00.000Z'),
    new Date('2026-07-18T12:00:01.000Z'),
  ]
  const monotonicTimes = [100, 1100]
  return {
    createId: vi.fn(() => 'provider-call-1'),
    now: vi.fn(() => wallTimes.shift() ?? new Date('2026-07-18T12:00:01.000Z')),
    monotonicNow: vi.fn(() => monotonicTimes.shift() ?? 1100),
    record: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('executeObservedModelCall', () => {
  it('awaits text, usage, and finalStep then records allowlisted success fields', async () => {
    const accessed: string[] = []
    const fake = {
      get text() {
        accessed.push('text')
        return Promise.resolve('model text')
      },
      get usage() {
        accessed.push('usage')
        return Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          raw: { prompt: 'raw usage secret', cost: 999 },
        })
      },
      get finalStep() {
        accessed.push('finalStep')
        return Promise.resolve({
          request: { body: 'request secret' },
          response: {
            modelId: 'actual-model',
            headers: { authorization: 'header secret' },
            body: 'response secret',
            messages: ['content secret'],
          },
          providerMetadata: {
            openrouter: {
              cost: 0.12345678,
              currency: 'USD',
              rawResponse: 'metadata secret',
            },
          },
        })
      },
    }
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({ record })

    await expect(executeObservedModelCall(input({
      call: () => fake as never,
      consume: (text) => ({ parsed: text }),
    }), observedDeps)).resolves.toEqual({ parsed: 'model text' })

    expect(accessed).toEqual(['text', 'usage', 'finalStep'])
    expect(record).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith({
      providerCallId: 'provider-call-1',
      context,
      candidate,
      useCase: 'chapter_generation',
      workflowPhase: 'CHAPTER_PROSE_INITIAL',
      startedAt: '2026-07-18T12:00:00.000Z',
    }, {
      actualProviderId: 'openrouter',
      actualModelId: 'actual-model',
      endedAt: '2026-07-18T12:00:01.000Z',
      elapsedMs: 1000,
      outcome: 'SUCCEEDED',
      errorCode: null,
      inputTokenCount: 10,
      outputTokenCount: 20,
      totalTokenCount: 30,
      providerActualCostAmount: '0.12345678',
      providerActualCostCurrency: 'USD',
      actualModelResolved: true,
    })
    const recorded = JSON.stringify(record.mock.calls)
    for (const secret of [
      'model text',
      'raw usage secret',
      'request secret',
      'header secret',
      'response secret',
      'content secret',
      'metadata secret',
    ]) {
      expect(recorded).not.toContain(secret)
    }
  })

  it('falls back to configured model and rejects unknown token and cost shapes', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({ record })

    await executeObservedModelCall(input({
      call: () => result({
        usage: Promise.resolve({
          inputTokens: -1,
          outputTokens: 2.5,
          totalTokens: Number.POSITIVE_INFINITY,
        }),
        finalStep: Promise.resolve({
          response: { modelId: '' },
          providerMetadata: {
            unknown: { cost: 4, currency: 'USD' },
            openrouter: { cost: '4', currency: 'USD' },
          },
        }),
      }) as never,
    }), observedDeps)

    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      actualModelId: 'configured-model',
      actualModelResolved: false,
      inputTokenCount: null,
      outputTokenCount: null,
      totalTokenCount: null,
      providerActualCostAmount: null,
      providerActualCostCurrency: null,
    }))
  })

  it.each([
    ['TimeoutError', 'TIMEOUT', 'PROVIDER_TIMEOUT'],
    ['AbortError', 'ABORTED', 'PROVIDER_ABORTED'],
    ['AI_InvalidResponseDataError', 'INVALID_RESPONSE', 'PROVIDER_INVALID_RESPONSE'],
    ['Error', 'PROVIDER_ERROR', 'PROVIDER_REQUEST_FAILED'],
  ] as const)('records controlled failure for %s', async (name, outcome, errorCode) => {
    const error = Object.assign(new Error('raw provider secret'), { name })
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({ record })

    await expect(executeObservedModelCall(input({
      call: () => result({ text: Promise.reject(error) }) as never,
    }), observedDeps)).rejects.toBe(error)

    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      outcome,
      errorCode,
    }))
    expect(JSON.stringify(record.mock.calls)).not.toContain('raw provider secret')
  })

  it.each([
    [new InvalidModelResponseError(), 'INVALID_RESPONSE', 'PROVIDER_INVALID_RESPONSE'],
    [new ContentRejectedError(), 'CONTENT_REJECTED', 'PROVIDER_CONTENT_REJECTED'],
  ] as const)('classifies typed consume error inside observed lifecycle', async (error, outcome, errorCode) => {
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({ record })

    await expect(executeObservedModelCall(input({
      consume: () => { throw error },
    }), observedDeps)).rejects.toBe(error)

    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      actualModelId: 'actual-model',
      actualModelResolved: true,
      inputTokenCount: 10,
      outputTokenCount: 20,
      totalTokenCount: 30,
      outcome,
      errorCode,
    }))
  })

  it('preserves success and original errors when recorder fails', async () => {
    const recorderError = new Error('recorder secret')
    const successRecord = vi.fn().mockRejectedValue(recorderError)

    await expect(executeObservedModelCall(input(), deps({ record: successRecord })))
      .resolves.toBe('MODEL TEXT')

    const providerError = new Error('provider secret')
    const failureRecord = vi.fn().mockRejectedValue(recorderError)
    await expect(executeObservedModelCall(input({
      call: () => { throw providerError },
    }), deps({ record: failureRecord }))).rejects.toBe(providerError)
  })

  it('creates one unique UUID before each provider call', async () => {
    const order: string[] = []
    const ids = [
      '40000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005',
    ]
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({
      createId: vi.fn(() => {
        order.push('id')
        return ids.shift() ?? 'unexpected-id'
      }),
      now: vi.fn(() => {
        order.push('wall')
        return new Date('2026-07-18T12:00:00.000Z')
      }),
      monotonicNow: vi.fn(() => {
        order.push('monotonic')
        return 100
      }),
      record,
    })
    const observedInput = input({
      call: () => {
        order.push('call')
        return result() as never
      },
    })

    await executeObservedModelCall(observedInput, observedDeps)
    await executeObservedModelCall(observedInput, observedDeps)

    expect(order.slice(0, 4)).toEqual(['id', 'wall', 'monotonic', 'call'])
    expect(record.mock.calls.map(([start]) => start.providerCallId)).toEqual([
      '40000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005',
    ])
  })
})
