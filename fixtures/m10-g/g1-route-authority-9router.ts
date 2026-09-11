import type { M10GG1RouteAuthority } from '../../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import {
  M10GG1RouteAuthoritySchema,
  assertM10GG1RouteAuthority,
  computeM10GG1RouteAuthorityHash,
} from '../../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'

const OMITTED = Object.freeze({ presence: 'OMITTED' as const })
const NULL = Object.freeze({ presence: 'NULL' as const, value: null })
const value = <T extends string | number>(item: T) => Object.freeze({
  presence: 'VALUE' as const,
  value: item,
})
const candidate = (modelId: string, fallbackIndex: number) => Object.freeze({
  provider: '9router' as const,
  providerAdapter: 'OPENAI_COMPATIBLE' as const,
  modelId,
  fallbackIndex,
})

const withoutHash = {
  schemaVersion: 1 as const,
  authorityId: 'm10-g-g1-9router-route-authority-v1' as const,
  routes: {
    writer: {
      routeKind: 'WRITER' as const,
      productionUseCase: 'chapter_prose' as const,
      providerAdapter: 'OPENAI_COMPATIBLE' as const,
      providerModelCandidateOrder: [candidate('gweb/gemini-3.1-pro', 0)],
      fallbackBehavior: 'NONE' as const,
      configuredRoute: {
        temperature: NULL,
        maxOutput: value(4096),
        reasoning: value('none'),
      },
      maxOutput: value(4096),
      reasoning: value('none'),
      temperature: NULL,
      timeoutMs: value(120_000),
      maxRetries: 0 as const,
      routeVersion: '9router-gemini-3.1-pro-v1',
    },
    continuity: {
      routeKind: 'CONTINUITY' as const,
      productionUseCase: 'continuity_judge' as const,
      providerAdapter: 'OPENAI_COMPATIBLE' as const,
      providerModelCandidateOrder: [candidate('gweb/gemini-3.8-flash', 0)],
      fallbackBehavior: 'NONE' as const,
      configuredRoute: {
        temperature: NULL,
        maxOutput: NULL,
        reasoning: NULL,
      },
      maxOutput: value(512),
      reasoning: OMITTED,
      temperature: value(0),
      timeoutMs: value(30_000),
      maxRetries: 0 as const,
      routeVersion: '9router-gemini-3.8-flash-v1',
    },
    choice: {
      routeKind: 'CHOICE' as const,
      productionUseCase: 'choices' as const,
      providerAdapter: 'OPENAI_COMPATIBLE' as const,
      providerModelCandidateOrder: [candidate('gweb/gemini-3.8-flash', 0)],
      fallbackBehavior: 'NONE' as const,
      configuredRoute: {
        temperature: NULL,
        maxOutput: NULL,
        reasoning: NULL,
      },
      maxOutput: value(1024),
      reasoning: OMITTED,
      temperature: value(0.1),
      timeoutMs: value(45_000),
      maxRetries: 0 as const,
      routeVersion: '9router-gemini-3.8-flash-v1',
      choiceOptionsPerResponse: 2 as const,
      choiceOptionsValidatorAcceptedRange: [2, 3] as [2, 3],
      providerCandidateLimitPerInvocation: 3 as const,
      providerRequestsPerWorkflowMax: 5 as const,
      workflowTimeoutMs: 120_000 as const,
    },
    longHorizonSemantic: {
      routeKind: 'LONG_HORIZON_SEMANTIC' as const,
      semanticUseCase: 'm10_g_long_horizon_semantic_judge' as const,
      providerAdapter: 'OPENAI_COMPATIBLE' as const,
      providerModelCandidateOrder: [candidate('gweb/gemini-3.8-flash', 0)],
      fallbackBehavior: 'NONE' as const,
      maxOutput: OMITTED,
      reasoning: OMITTED,
      temperature: value(0),
      timeoutMs: OMITTED,
      maxRetries: 0 as const,
      routeVersion: '9router-gemini-3.8-flash-v1',
    },
  },
}

export const M10_G_G1_9ROUTER_ROUTE_AUTHORITY_HASH =
  computeM10GG1RouteAuthorityHash(withoutHash)

export const M10_G_G1_9ROUTER_ROUTE_AUTHORITY: M10GG1RouteAuthority = Object.freeze(
  M10GG1RouteAuthoritySchema.parse({
    ...withoutHash,
    authorityHash: M10_G_G1_9ROUTER_ROUTE_AUTHORITY_HASH,
  }),
)

assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
