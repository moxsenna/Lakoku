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
    finishReason?: string
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
    consume: ((text: string) => text.toUpperCase()) as unknown as ObservedModelCallInput<T>['consume'],
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
    recorderTimeoutMs: 1_500,
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

    expect(accessed).toHaveLength(3)
    expect(accessed).toEqual(expect.arrayContaining(['text', 'usage', 'finalStep']))
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
      validationStage: null,
      validationCodes: null,
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

  it('passes finish reason to consume without persisting it in completion telemetry', async () => {
    const consume = vi.fn((text: string) => text)
    const record = vi.fn().mockResolvedValue(undefined)

    await executeObservedModelCall(input({
      call: () => result({
        finalStep: Promise.resolve({
          finishReason: 'length',
          response: { modelId: 'actual-model' },
          providerMetadata: {},
        }),
      }) as never,
      consume,
    }), deps({ record }))

    expect(consume).toHaveBeenCalledWith('model text', { finishReason: 'length' })
    expect(JSON.stringify(record.mock.calls)).not.toContain('finishReason')
    expect(JSON.stringify(record.mock.calls)).not.toContain('length')
  })

  it('awaits async call results (generateText resolves a promise, not a result object)', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({ record })

    // generateText returns a Promise; executeObservedModelCall must await the
    // call itself before touching `.text`/`.usage`/`.finalStep`.
    await expect(executeObservedModelCall(input({
      call: (async () => ({
        text: 'async model text',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        finalStep: { response: { modelId: 'async-model' } },
      })) as never,
      consume: (text) => ({ parsed: text }),
    }), observedDeps)).resolves.toEqual({ parsed: 'async model text' })

    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      actualModelId: 'async-model',
      actualModelResolved: true,
      outcome: 'SUCCEEDED',
      inputTokenCount: 1,
      outputTokenCount: 2,
      totalTokenCount: 3,
    }))
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

  it('reports reasoning-budget metadata counts without retaining reasoning text or prose', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const observeBudget = vi.fn()

    await executeObservedModelCall(input({
      call: () => result({
        text: Promise.resolve('  \n  '),
        usage: Promise.resolve({
          inputTokens: 1668,
          outputTokens: 2048,
          totalTokens: 3716,
          outputTokenDetails: { textTokens: 0, reasoningTokens: 2048 },
        }),
        finalStep: Promise.resolve({
          finishReason: 'length',
          response: { modelId: 'actual-model' },
          reasoningText: 'hidden chain of thought secret',
          reasoning: [{ type: 'reasoning', text: 'hidden chain of thought secret' }],
          providerMetadata: {},
        }),
      }) as never,
      consume: (text) => text,
      observeReasoningBudget: observeBudget,
    }), deps({ record }))

    expect(observeBudget).toHaveBeenCalledOnce()
    expect(observeBudget).toHaveBeenCalledWith({
      reasoningTokenCount: 2048,
      reasoningFieldPresent: true,
      reasoningDetailsPresent: true,
      visibleContentChars: 0,
      completionTokenCount: 2048,
      finishReason: 'length',
    })
    const observed = JSON.stringify(observeBudget.mock.calls)
    expect(observed).not.toContain('hidden chain of thought secret')
    expect(JSON.stringify(record.mock.calls)).not.toContain('hidden chain of thought secret')
  })

  it('reports absent reasoning metadata as null counts rather than zero', async () => {
    const observeBudget = vi.fn()

    await executeObservedModelCall(input({
      call: () => result({
        text: Promise.resolve('visible prose'),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
        finalStep: Promise.resolve({
          finishReason: 'stop',
          response: { modelId: 'actual-model' },
          providerMetadata: {},
        }),
      }) as never,
      observeReasoningBudget: observeBudget,
    }), deps())

    expect(observeBudget).toHaveBeenCalledWith({
      reasoningTokenCount: null,
      reasoningFieldPresent: false,
      reasoningDetailsPresent: false,
      visibleContentChars: 13,
      completionTokenCount: 20,
      finishReason: 'stop',
    })
  })

  it('reports reasoning-budget metadata even when consume rejects', async () => {
    const observeBudget = vi.fn()
    const error = new InvalidModelResponseError()

    await expect(executeObservedModelCall(input({
      call: () => result({
        text: Promise.resolve(''),
        usage: Promise.resolve({
          inputTokens: 1895,
          outputTokens: 2048,
          totalTokens: 3943,
          outputTokenDetails: { textTokens: 0, reasoningTokens: 2048 },
        }),
        finalStep: Promise.resolve({
          finishReason: 'length',
          response: { modelId: 'actual-model' },
          providerMetadata: {},
        }),
      }) as never,
      consume: () => { throw error },
      observeReasoningBudget: observeBudget,
    }), deps())).rejects.toBe(error)

    expect(observeBudget).toHaveBeenCalledOnce()
    expect(observeBudget).toHaveBeenCalledWith(expect.objectContaining({
      reasoningTokenCount: 2048,
      visibleContentChars: 0,
      completionTokenCount: 2048,
      finishReason: 'length',
    }))
  })

  it('records canonical validation diagnostics after consume rejects', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const error = new InvalidModelResponseError(
      'validation failed',
      [],
      undefined,
      'FINAL_BRANCH_SCHEMA',
      ['CHOICE_NOT_ACTIONABLE', 'NEXT_CHAPTER_MISMATCH'],
    )

    await expect(executeObservedModelCall(input({
      consume: () => { throw error },
    }), deps({ record }))).rejects.toBe(error)

    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      outcome: 'INVALID_RESPONSE',
      validationStage: 'FINAL_BRANCH_SCHEMA',
      validationCodes: ['CHOICE_NOT_ACTIONABLE', 'NEXT_CHAPTER_MISMATCH'],
    }))
  })

  it('records null diagnostics when custom classification overrides typed validation', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const error = new InvalidModelResponseError(
      'validation failed', [], undefined, 'FINAL_BRANCH_SCHEMA', ['CHOICE_NOT_ACTIONABLE'],
    )
    await expect(executeObservedModelCall(input({
      consume: () => { throw error },
      classifyFailure: () => ({ outcome: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' }),
    }), deps({ record }))).rejects.toBe(error)
    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      outcome: 'TIMEOUT',
      errorCode: 'PROVIDER_TIMEOUT',
      validationStage: null,
      validationCodes: null,
    }))
  })

  it('preserves consumed text when usage or final-step observation rejects', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const observedDeps = deps({ record })

    await expect(executeObservedModelCall(input({
      call: () => result({
        usage: Promise.reject(new Error('usage unavailable')),
        finalStep: Promise.reject(new Error('final step unavailable')),
      }) as never,
    }), observedDeps)).resolves.toBe('MODEL TEXT')

    expect(record).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      actualModelId: 'configured-model',
      actualModelResolved: false,
      inputTokenCount: null,
      outputTokenCount: null,
      totalTokenCount: null,
      outcome: 'SUCCEEDED',
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

  it('bounds recorder wait and preserves success when recorder never resolves', async () => {
    vi.useFakeTimers()
    try {
      const pending = executeObservedModelCall(input(), deps({
        record: vi.fn(() => new Promise<void>(() => {})),
        recorderTimeoutMs: 10,
      }))

      await vi.advanceTimersByTimeAsync(10)
      await expect(pending).resolves.toBe('MODEL TEXT')
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds recorder wait and preserves original error when recorder never resolves', async () => {
    vi.useFakeTimers()
    try {
      const providerError = new Error('provider secret')
      const pending = executeObservedModelCall(input({
        call: () => { throw providerError },
      }), deps({
        record: vi.fn(() => new Promise<void>(() => {})),
        recorderTimeoutMs: 10,
      }))
      const assertion = expect(pending).rejects.toBe(providerError)

      await vi.advanceTimersByTimeAsync(10)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles recorder rejection after timeout without exposing it', async () => {
    vi.useFakeTimers()
    try {
      let rejectRecorder!: (error: Error) => void
      const record = vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectRecorder = reject
      }))
      const pending = executeObservedModelCall(input(), deps({
        record,
        recorderTimeoutMs: 10,
      }))

      await vi.advanceTimersByTimeAsync(10)
      await expect(pending).resolves.toBe('MODEL TEXT')
      rejectRecorder(new Error('late recorder secret'))
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
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
