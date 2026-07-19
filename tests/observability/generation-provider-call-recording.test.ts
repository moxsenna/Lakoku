import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))

import { recordGenerationProviderCall } from '@/lib/observability/generation-provider-call.server'

const start = {
  providerCallId: 'provider-call-1',
  context: {
    userId: '10000000-0000-4000-8000-000000000001',
    storyId: 'story-1',
    chapterNumber: 2,
    generationKind: 'standard',
    jobId: '30000000-0000-4000-8000-000000000003',
    correlationId: '20000000-0000-4000-8000-000000000002',
    attemptNumber: 1,
  },
  candidate: {
    providerId: 'configured-provider',
    configuredModelId: 'configured-model',
    routeVersion: 'chapter-v1',
    fallbackIndex: 1,
  },
  useCase: 'chapter_generation',
  workflowPhase: 'draft',
  startedAt: '2026-07-18T12:00:00.000Z',
} as const

const completion = {
  actualProviderId: 'openrouter',
  actualModelId: 'anthropic/claude-sonnet-4',
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
} as const

beforeEach(() => vi.clearAllMocks())

describe('recordGenerationProviderCall', () => {
  it('maps only explicit scalar snake_case fields to exact recorder RPC signature', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { recorded: true, duplicate: false },
      error: null,
    })

    await recordGenerationProviderCall(start, completion, { rpc })

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('record_generation_provider_call_v1', {
      p_provider_call_id: 'provider-call-1',
      p_user_id: '10000000-0000-4000-8000-000000000001',
      p_story_id: 'story-1',
      p_chapter_number: 2,
      p_generation_kind: 'standard',
      p_job_id: '30000000-0000-4000-8000-000000000003',
      p_correlation_id: '20000000-0000-4000-8000-000000000002',
      p_attempt_number: 1,
      p_use_case: 'chapter_generation',
      p_workflow_phase: 'draft',
      p_provider_id: 'openrouter',
      p_model_id: 'anthropic/claude-sonnet-4',
      p_route_version: 'chapter-v1',
      p_fallback_index: 1,
      p_actual_model_resolved: true,
      p_started_at: '2026-07-18T12:00:00.000Z',
      p_ended_at: '2026-07-18T12:00:01.000Z',
      p_elapsed_ms: 1000,
      p_outcome: 'SUCCEEDED',
      p_error_code: null,
      p_input_token_count: 10,
      p_output_token_count: 20,
      p_total_token_count: 30,
      p_provider_cost_amount: '0.12345678',
      p_provider_cost_currency: 'USD',
    })
  })

  it('uses createAdminClient RPC by default', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { recorded: true, duplicate: false },
      error: null,
    })
    mocks.adminFactory.mockReturnValue({ rpc })

    await recordGenerationProviderCall(start, completion)

    expect(mocks.adminFactory).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('strictly rejects invalid or unrecognized start fields before writing', async () => {
    const rpc = vi.fn()

    await expect(recordGenerationProviderCall({
      ...start,
      prompt: 'must-not-be-recorded',
    } as never, completion, { rpc })).rejects.toThrow()
    await expect(recordGenerationProviderCall({
      ...start,
      useCase: ' ',
    }, completion, { rpc })).rejects.toThrow()

    expect(rpc).not.toHaveBeenCalled()
  })

  it('strictly rejects invalid or unrecognized completion fields before writing', async () => {
    const rpc = vi.fn()

    await expect(recordGenerationProviderCall(start, {
      ...completion,
      rawResponse: 'must-not-be-recorded',
    } as never, { rpc })).rejects.toThrow()
    await expect(recordGenerationProviderCall(start, {
      ...completion,
      totalTokenCount: 31,
    }, { rpc })).rejects.toThrow()

    expect(rpc).not.toHaveBeenCalled()
  })

  it('resolves writer failures and emits only bounded failure code', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('secret db text'),
    })
    const logCode = vi.fn()

    await expect(recordGenerationProviderCall(start, completion, {
      rpc,
      logCode,
    })).resolves.toBeUndefined()

    expect(logCode).toHaveBeenCalledOnce()
    expect(logCode).toHaveBeenCalledWith('GENERATION_PROVIDER_TELEMETRY_WRITE_FAILED')
    expect(JSON.stringify(logCode.mock.calls)).not.toContain('secret db text')
  })

  it('resolves thrown writer failures without exposing raw error', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('secret thrown db text'))
    const logCode = vi.fn()

    await expect(recordGenerationProviderCall(start, completion, {
      rpc,
      logCode,
    })).resolves.toBeUndefined()

    expect(logCode.mock.calls).toEqual([
      ['GENERATION_PROVIDER_TELEMETRY_WRITE_FAILED'],
    ])
    expect(JSON.stringify(logCode.mock.calls)).not.toContain('secret thrown db text')
  })

  it('accepts duplicate response as successful telemetry persistence', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { recorded: false, duplicate: true },
      error: null,
    })
    const logCode = vi.fn()

    await expect(recordGenerationProviderCall(start, completion, {
      rpc,
      logCode,
    })).resolves.toBeUndefined()

    expect(logCode).not.toHaveBeenCalled()
  })
})
