import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: vi.fn(),
}))

import {
  configureE0CostGuard,
  getE0CostGuard,
  isE0CostGuardError,
  resetE0CostGuardForTests,
} from '@/lib/ai-gateway/e0-cost-guard'
import {
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
  fallbackIndex: 0,
} as const

const deps: ObservedModelCallDeps = {
  createId: () => '30000000-0000-4000-8000-000000000003',
  now: () => new Date('2026-09-12T00:00:00.000Z'),
  monotonicNow: () => 0,
  record: vi.fn(async () => {}),
  recorderTimeoutMs: 1_500,
}

function callResult(providerMetadata: unknown) {
  return {
    text: Promise.resolve('model text'),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    finalStep: Promise.resolve({ response: { modelId: 'actual-model' }, providerMetadata }),
  }
}

function input(providerMetadata: unknown): ObservedModelCallInput<string> {
  return {
    context,
    candidate,
    useCase: 'chapter_generation',
    workflowPhase: 'CHAPTER_PROSE_INITIAL',
    call: () => callResult(providerMetadata) as never,
    consume: (text: string) => text,
  }
}

describe('E0 measured-cost seam reaches the production guard', () => {
  beforeEach(() => {
    resetE0CostGuardForTests()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    resetE0CostGuardForTests()
  })

  it('feeds provider-reported billed cost into the configured guard', async () => {
    const guard = configureE0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '200.00000000' })
    guard.tryBeginChapterScope('job-1#1')

    await executeObservedModelCall(input({ openrouter: { cost: 0.25, currency: 'USD' } }), deps)

    expect(guard.consumedProcessCostUsd).toBe('0.25000000')
    expect(guard.unmeasuredCount).toBe(0)
  })

  it('accumulates across transports so a chapter ceiling breach is terminal', async () => {
    const guard = configureE0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '200.00000000' })
    guard.tryBeginChapterScope('job-1#1')

    await executeObservedModelCall(input({ openrouter: { cost: 2.0, currency: 'USD' } }), deps)

    let thrown: unknown
    try {
      await executeObservedModelCall(input({ openrouter: { cost: 0.2, currency: 'USD' } }), deps)
    } catch (error) {
      thrown = error
    }
    expect(isE0CostGuardError(thrown)).toBe(true)
    expect((thrown as { code: string }).code).toBe('E0_CHAPTER_COST_CEILING_EXCEEDED')
    expect(guard.consumedProcessCostUsd).toBe('2.20000000')
  })

  it('counts an unmeasured transport instead of guessing a price', async () => {
    const guard = configureE0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '200.00000000' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await executeObservedModelCall(input(undefined), deps)
    await executeObservedModelCall(input({ openrouter: { promptTokens: 10 } }), deps)

    expect(guard.consumedProcessCostUsd).toBe('0.00000000')
    expect(guard.unmeasuredCount).toBe(2)
    expect(warn).toHaveBeenCalledWith('E0_COST_UNMEASURED', expect.objectContaining({ providerId: 'openrouter' }))
  })

  it('never blocks a transport when no guard is configured in the process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getE0CostGuard()).toBeNull()

    await expect(executeObservedModelCall(input({ openrouter: { cost: 5, currency: 'USD' } }), deps)).resolves.toBe('model text')
    expect(warn).toHaveBeenCalledWith('E0_COST_GUARD_DISABLED', expect.anything())
  })

  it('still records the failed transport cost when the model call throws', async () => {
    const guard = configureE0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '200.00000000' })
    guard.tryBeginChapterScope('job-1#1')
    const failing: ObservedModelCallInput<string> = {
      ...input({ openrouter: { cost: 0.4, currency: 'USD' } }),
      consume: () => {
        throw new Error('parser rejected output')
      },
    }

    await expect(executeObservedModelCall(failing, deps)).rejects.toThrow('parser rejected output')
    expect(guard.consumedProcessCostUsd).toBe('0.40000000')
  })
})
