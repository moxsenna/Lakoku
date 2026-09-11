import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  M10_G_G1_ROUTE_AUTHORITY,
  M10_G_G1_ROUTE_AUTHORITY_HASH_PIN,
} from '@/fixtures/m10-g/g1-route-authority'
import {
  assertM10GG1RouteAuthority,
  computeM10GG1RouteAuthorityHash,
  toAiModelRoute,
} from '@/lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'

vi.mock('server-only', () => ({}))

const createProviderFromExactRoutes = vi.fn(() => ({ name: 'frozen' }))
vi.mock('@lakoku/ai-gateway/server', () => ({ createProviderFromExactRoutes }))
vi.mock('@/lib/ops/ai-model-routes', () => ({
  getAiModelRoute: vi.fn(() => {
    throw new Error('MUTABLE_ROUTE_READ_FORBIDDEN')
  }),
}))

describe('M10-G G1 frozen route authority', () => {
  beforeEach(() => vi.clearAllMocks())

  it('binds canonical hash and exact optional-field presence', () => {
    const { authorityHash, ...payload } = M10_G_G1_ROUTE_AUTHORITY
    expect(computeM10GG1RouteAuthorityHash(payload)).toBe(M10_G_G1_ROUTE_AUTHORITY_HASH_PIN)
    expect(authorityHash).toBe(M10_G_G1_ROUTE_AUTHORITY_HASH_PIN)
    expect(M10_G_G1_ROUTE_AUTHORITY.routes.writer.temperature).toEqual({ presence: 'NULL', value: null })
    expect(M10_G_G1_ROUTE_AUTHORITY.routes.writer.maxOutput).toEqual({ presence: 'VALUE', value: 4096 })
    expect(M10_G_G1_ROUTE_AUTHORITY.routes.longHorizonSemantic.maxOutput).toEqual({ presence: 'OMITTED' })
    expect(M10_G_G1_ROUTE_AUTHORITY.routes.longHorizonSemantic.timeoutMs).toEqual({ presence: 'OMITTED' })
  })

  it('rejects strict-shape and hash tampering', () => {
    const tampered = structuredClone(M10_G_G1_ROUTE_AUTHORITY)
    tampered.routes.choice.providerModelCandidateOrder[0]!.modelId = 'tampered/model'
    expect(() => assertM10GG1RouteAuthority(tampered)).toThrow('M10G_G1_ROUTE_AUTHORITY_HASH_MISMATCH')
    expect(() => assertM10GG1RouteAuthority({
      ...M10_G_G1_ROUTE_AUTHORITY,
      extra: true,
    })).toThrow()
  })

  it('projects production routes with exact candidate order', () => {
    expect(toAiModelRoute(M10_G_G1_ROUTE_AUTHORITY, 'writer')).toEqual({
      useCase: 'chapter_prose',
      provider: 'openrouter',
      modelId: 'openai/gpt-5.6-sol',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'none',
      routeVersion: 'writer-v2-flagship-control-v1',
    })
    expect(toAiModelRoute(M10_G_G1_ROUTE_AUTHORITY, 'choice').fallbackModels).toEqual([
      { provider: 'openrouter', modelId: 'deepseek/deepseek-v3.2' },
    ])
    expect(toAiModelRoute(M10_G_G1_ROUTE_AUTHORITY, 'continuity').fallbackModels).toEqual([
      { provider: 'openrouter', modelId: 'deepseek/deepseek-v3.1-terminus' },
    ])
  })

  it('constructs production gateway from frozen routes without mutable route selection', async () => {
    const { resolveM10GG1FrozenProvider } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-frozen-provider.server'
    )
    const policy = {
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
    }
    resolveM10GG1FrozenProvider(policy)
    expect(createProviderFromExactRoutes).toHaveBeenCalledOnce()
    const providerArgs = createProviderFromExactRoutes.mock.calls[0] as unknown as readonly [Record<string, unknown>]
    expect(providerArgs[0]?.writerRoute).toMatchObject({
      useCase: 'chapter_prose',
      modelId: 'openai/gpt-5.6-sol',
    })
    expect(providerArgs[0]?.choicesRoute).toMatchObject({
      useCase: 'choices',
      modelId: 'openai/gpt-4.1-mini',
    })
    expect(providerArgs[0]?.judgeRoute).toMatchObject({
      useCase: 'continuity_judge',
      modelId: 'deepseek/deepseek-v3.2',
    })
  })
})
