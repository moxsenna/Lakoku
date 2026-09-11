import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  M10_G_G1_9ROUTER_ROUTE_AUTHORITY,
  M10_G_G1_9ROUTER_ROUTE_AUTHORITY_HASH,
} from '@/fixtures/m10-g/g1-route-authority-9router'
import {
  assertM10GG1RouteAuthority,
  computeM10GG1RouteAuthorityHash,
  toAiModelRoute,
} from '@/lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'

describe('M10-G G1 9Router VPS Route Authority', () => {
  it('passes strict schema validation and verifies canonical hash', () => {
    expect(assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)).toBeDefined()
    const { authorityHash, ...payload } = M10_G_G1_9ROUTER_ROUTE_AUTHORITY
    expect(computeM10GG1RouteAuthorityHash(payload)).toBe(M10_G_G1_9ROUTER_ROUTE_AUTHORITY_HASH)
  })

  it('projects 9router routes for writer, choice, and continuity with gweb Gemini models', () => {
    const writerRoute = toAiModelRoute(M10_G_G1_9ROUTER_ROUTE_AUTHORITY, 'writer')
    expect(writerRoute).toEqual({
      useCase: 'chapter_prose',
      provider: '9router',
      modelId: 'gweb/gemini-3.1-pro',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: 4096,
      reasoningEffort: 'none',
      routeVersion: '9router-gemini-3.1-pro-v1',
    })

    const choiceRoute = toAiModelRoute(M10_G_G1_9ROUTER_ROUTE_AUTHORITY, 'choice')
    expect(choiceRoute).toEqual({
      useCase: 'choices',
      provider: '9router',
      modelId: 'gweb/gemini-3.8-flash',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: null,
      reasoningEffort: null,
      routeVersion: '9router-gemini-3.8-flash-v1',
    })

    const judgeRoute = toAiModelRoute(M10_G_G1_9ROUTER_ROUTE_AUTHORITY, 'continuity')
    expect(judgeRoute).toEqual({
      useCase: 'continuity_judge',
      provider: '9router',
      modelId: 'gweb/gemini-3.8-flash',
      fallbackModels: [],
      temperature: null,
      maxOutputTokens: null,
      reasoningEffort: null,
      routeVersion: '9router-gemini-3.8-flash-v1',
    })
  })

  it('resolves frozen routes using 9router authority profile', async () => {
    const { resolveM10GG1FrozenRoutes } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-frozen-provider.server'
    )
    const routes = resolveM10GG1FrozenRoutes(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
    expect(routes.writerRoute.provider).toBe('9router')
    expect(routes.writerRoute.modelId).toBe('gweb/gemini-3.1-pro')
    expect(routes.choicesRoute.provider).toBe('9router')
    expect(routes.choicesRoute.modelId).toBe('gweb/gemini-3.8-flash')
    expect(routes.judgeRoute.provider).toBe('9router')
    expect(routes.judgeRoute.modelId).toBe('gweb/gemini-3.8-flash')
  })
})
