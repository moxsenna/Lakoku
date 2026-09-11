import 'server-only'
import type { GenerationProvider, GenerationRuntimePolicy } from '@lakoku/ai-gateway'
import type { ExactProductionRoutes } from '@lakoku/ai-gateway/server'
import { createProviderFromExactRoutes } from '@lakoku/ai-gateway/server'
import { M10_G_G1_ROUTE_AUTHORITY } from '@/fixtures/m10-g/g1-route-authority'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '@/fixtures/m10-g/g1-route-authority-9router'
import {
  assertM10GG1RouteAuthority,
  toAiModelRoute,
  type M10GG1RouteAuthority,
} from '../contracts/m10-g-g1-route-authority.contract'

export function resolveM10GG1FrozenGenerationPolicy(): GenerationRuntimePolicy {
  // Repo defaults and migration seeds do not prove current production policy.
  // Fail before provider construction until metadata-only authority freezes the
  // effective targetWordsMin, targetWordsMax, and targetScenes values.
  throw new Error('M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND')
}

export function resolveM10GG1FrozenLeaseTtlSeconds(): number {
  throw new Error('M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND')
}

export function resolveM10GG1FrozenRoutes(
  customAuthority?: M10GG1RouteAuthority,
): ExactProductionRoutes {
  const authority = customAuthority
    ? assertM10GG1RouteAuthority(customAuthority)
    : (process.env.M10G_ROUTE_AUTHORITY_PROFILE === '9router'
        ? assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
        : assertM10GG1RouteAuthority(M10_G_G1_ROUTE_AUTHORITY))
  return Object.freeze({
    writerRoute: Object.freeze(toAiModelRoute(authority, 'writer')),
    choicesRoute: Object.freeze(toAiModelRoute(authority, 'choice')),
    judgeRoute: Object.freeze(toAiModelRoute(authority, 'continuity')),
  })
}

/**
 * Frozen G1 provider resolver. Uses production gateway constructor with literal,
 * hash-verified routes; never calls mutable ai_model_routes selection.
 */
export function resolveM10GG1FrozenProvider(
  generationPolicy: GenerationRuntimePolicy,
): GenerationProvider {
  return createProviderFromExactRoutes({
    ...resolveM10GG1FrozenRoutes(),
    generationPolicy,
  })
}
