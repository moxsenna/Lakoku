import { describe, expect, it } from 'vitest'
import {
  ModelCandidateIdentitySchema,
  ProviderCallCompletionSchema,
  ProviderCallContextSchema,
  ProviderCallCostSourceSchema,
  ProviderCallOutcomeSchema,
} from '@/lib/observability/generation-provider-call.contract'

const JOB_ID = '30000000-0000-4000-8000-000000000003'

const syncContext = {
  userId: '10000000-0000-4000-8000-000000000001',
  storyId: 'story-1',
  chapterNumber: 2,
  generationKind: 'standard',
  jobId: null,
  correlationId: '20000000-0000-4000-8000-000000000002',
  attemptNumber: null,
} as const

const successfulCompletion = {
  actualProviderId: 'openrouter',
  actualModelId: 'anthropic/claude-sonnet-4',
  endedAt: '2026-07-18T12:00:01.000Z',
  elapsedMs: 1000,
  outcome: 'SUCCEEDED',
  errorCode: null,
  inputTokenCount: 10,
  outputTokenCount: 20,
  totalTokenCount: 30,
  providerActualCostAmount: null,
  providerActualCostCurrency: null,
  actualModelResolved: true,
} as const

describe('ProviderCallContextSchema', () => {
  it('accepts trusted synchronous identity', () => {
    expect(ProviderCallContextSchema.parse(syncContext)).toEqual(syncContext)
  })

  it('requires jobId and attemptNumber together', () => {
    expect(() => ProviderCallContextSchema.parse({
      ...syncContext,
      jobId: JOB_ID,
    })).toThrow(/attemptNumber/)
    expect(() => ProviderCallContextSchema.parse({
      ...syncContext,
      attemptNumber: 1,
    })).toThrow(/attemptNumber/)
    expect(ProviderCallContextSchema.parse({
      ...syncContext,
      jobId: JOB_ID,
      attemptNumber: 20,
    })).toMatchObject({ jobId: JOB_ID, attemptNumber: 20 })
  })

  it('rejects unrestricted metadata', () => {
    expect(() => ProviderCallContextSchema.parse({
      ...syncContext,
      metadata: { prompt: 'secret' },
    })).toThrow()
  })

  it('enforces identity and context bounds', () => {
    for (const patch of [
      { userId: 'not-a-uuid' },
      { storyId: ' ' },
      { storyId: 's'.repeat(201) },
      { chapterNumber: 0 },
      { chapterNumber: 51 },
      { generationKind: 'custom' },
      { correlationId: 'not-a-uuid' },
      { jobId: JOB_ID, attemptNumber: 21 },
    ]) {
      expect(ProviderCallContextSchema.safeParse({
        ...syncContext,
        ...patch,
      }).success).toBe(false)
    }
  })
})

describe('provider result contracts', () => {
  it('exports controlled outcome and cost-source values', () => {
    expect(ProviderCallOutcomeSchema.options).toEqual([
      'SUCCEEDED',
      'PROVIDER_ERROR',
      'TIMEOUT',
      'ABORTED',
      'INVALID_RESPONSE',
      'CONTENT_REJECTED',
    ])
    expect(ProviderCallCostSourceSchema.options).toEqual([
      'provider_actual',
      'price_estimate',
      'unavailable',
    ])
  })

  it('accepts structured candidate identity with text routeVersion', () => {
    expect(ModelCandidateIdentitySchema.parse({
      providerId: 'openrouter',
      configuredModelId: 'anthropic/claude-sonnet-4',
      routeVersion: 'chapter-v1',
      fallbackIndex: 1,
    })).toEqual({
      providerId: 'openrouter',
      configuredModelId: 'anthropic/claude-sonnet-4',
      routeVersion: 'chapter-v1',
      fallbackIndex: 1,
    })
  })

  it('keeps candidate identity strict', () => {
    expect(ModelCandidateIdentitySchema.safeParse({
      providerId: 'openrouter',
      configuredModelId: 'model',
      routeVersion: null,
      fallbackIndex: 0,
      metadata: {},
    }).success).toBe(false)
  })

  const validCandidate = {
    providerId: 'openrouter',
    configuredModelId: 'model',
    routeVersion: null,
    fallbackIndex: 0,
  } as const

  it.each([
    ['providerId', { providerId: 'p'.repeat(81) }],
    ['configuredModelId', { configuredModelId: 'm'.repeat(201) }],
    ['routeVersion', { routeVersion: 'r'.repeat(101) }],
    ['fallbackIndex', { fallbackIndex: 33 }],
  ])('rejects candidate identity exceeding %s bound', (_field, patch) => {
    expect(ModelCandidateIdentitySchema.safeParse({
      ...validCandidate,
      ...patch,
    }).success).toBe(false)
  })

  it('accepts configuredModelId at max 200 characters', () => {
    expect(ModelCandidateIdentitySchema.safeParse({
      ...validCandidate,
      configuredModelId: 'm'.repeat(200),
    }).success).toBe(true)
  })

  it('accepts routeVersion at max 100 characters', () => {
    expect(ModelCandidateIdentitySchema.safeParse({
      ...validCandidate,
      routeVersion: 'r'.repeat(100),
    }).success).toBe(true)
  })

  it('rejects success with an error code and failure without one', () => {
    expect(() => ProviderCallCompletionSchema.parse({
      ...successfulCompletion,
      errorCode: 'PROVIDER_FAILED',
    })).toThrow(/errorCode/)
    expect(() => ProviderCallCompletionSchema.parse({
      ...successfulCompletion,
      outcome: 'TIMEOUT',
    })).toThrow(/errorCode/)
    expect(ProviderCallCompletionSchema.parse({
      ...successfulCompletion,
      outcome: 'PROVIDER_ERROR',
      errorCode: 'PROVIDER_FAILED',
    }).outcome).toBe('PROVIDER_ERROR')
  })

  it('requires provider actual cost amount and currency together', () => {
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      providerActualCostAmount: '0.12345678',
      providerActualCostCurrency: 'USD',
    }).success).toBe(true)
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      providerActualCostAmount: '0.12',
    }).success).toBe(false)
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      providerActualCostCurrency: 'USD',
    }).success).toBe(false)
  })

  it('accepts provider actual cost with 12 integer and 8 fraction digits', () => {
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      providerActualCostAmount: '123456789012.12345678',
      providerActualCostCurrency: 'USD',
    }).success).toBe(true)
  })

  it('rejects provider actual cost with 13 integer digits', () => {
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      providerActualCostAmount: '1234567890123.12345678',
      providerActualCostCurrency: 'USD',
    }).success).toBe(false)
  })

  it('accepts only nonnegative usage with consistent known totals', () => {
    expect(ProviderCallCompletionSchema.safeParse(successfulCompletion).success).toBe(true)
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      totalTokenCount: 31,
    }).success).toBe(false)
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      inputTokenCount: null,
      totalTokenCount: 20,
    }).success).toBe(true)
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      outputTokenCount: -1,
      totalTokenCount: 9,
    }).success).toBe(false)
  })

  it('enforces completion formatting, bounds, and strictness', () => {
    for (const patch of [
      { actualProviderId: 'p'.repeat(81) },
      { actualModelId: 'm'.repeat(201) },
      { endedAt: '2026-07-18T12:00:01' },
      { elapsedMs: -1 },
      { errorCode: 'lowercase', outcome: 'PROVIDER_ERROR' },
      { providerActualCostAmount: '1.123456789', providerActualCostCurrency: 'USD' },
      { providerActualCostAmount: '1.00', providerActualCostCurrency: 'usd' },
    ]) {
      expect(ProviderCallCompletionSchema.safeParse({
        ...successfulCompletion,
        ...patch,
      }).success).toBe(false)
    }
    expect(ProviderCallCompletionSchema.safeParse({
      ...successfulCompletion,
      metadata: { response: 'secret' },
    }).success).toBe(false)
  })
})
