import { z } from 'zod'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const OmittedSchema = z.object({ presence: z.literal('OMITTED') }).strict()
const NullSchema = z.object({ presence: z.literal('NULL'), value: z.null() }).strict()
const NumberValueSchema = z.object({
  presence: z.literal('VALUE'),
  value: z.number().finite(),
}).strict()
const StringValueSchema = z.object({
  presence: z.literal('VALUE'),
  value: z.string().min(1),
}).strict()

export const M10GG1OptionalNumberSchema = z.union([
  OmittedSchema,
  NullSchema,
  NumberValueSchema,
])
export const M10GG1OptionalStringSchema = z.union([
  OmittedSchema,
  NullSchema,
  StringValueSchema,
])

const ProviderModelCandidateSchema = z.object({
  provider: z.enum(['openrouter', '9router']),
  providerAdapter: z.literal('OPENAI_COMPATIBLE'),
  modelId: z.string().min(1),
  fallbackIndex: z.number().int().nonnegative(),
}).strict()

const RouteBaseSchema = z.object({
  providerAdapter: z.literal('OPENAI_COMPATIBLE'),
  providerModelCandidateOrder: z.array(ProviderModelCandidateSchema).min(1),
  fallbackBehavior: z.enum(['NONE', 'ORDERED_CANDIDATE_FALLBACK']),
  maxOutput: M10GG1OptionalNumberSchema,
  reasoning: M10GG1OptionalStringSchema,
  temperature: M10GG1OptionalNumberSchema,
  timeoutMs: M10GG1OptionalNumberSchema,
  maxRetries: z.literal(0),
  routeVersion: z.string().min(1),
})

const ProductionRouteSchema = RouteBaseSchema.extend({
  productionUseCase: z.enum(['chapter_prose', 'continuity_judge', 'choices']),
  configuredRoute: z.object({
    temperature: z.union([NullSchema, NumberValueSchema]),
    maxOutput: z.union([NullSchema, NumberValueSchema]),
    reasoning: z.union([OmittedSchema, NullSchema, StringValueSchema]),
  }).strict(),
}).strict()

export const M10GG1RouteAuthoritySchema = z.object({
  schemaVersion: z.literal(1),
  authorityId: z.string().min(1),
  routes: z.object({
    writer: ProductionRouteSchema.extend({
      routeKind: z.literal('WRITER'),
      productionUseCase: z.literal('chapter_prose'),
    }).strict(),
    continuity: ProductionRouteSchema.extend({
      routeKind: z.literal('CONTINUITY'),
      productionUseCase: z.literal('continuity_judge'),
    }).strict(),
    choice: ProductionRouteSchema.extend({
      routeKind: z.literal('CHOICE'),
      productionUseCase: z.literal('choices'),
      // Reader-facing option count emitted by the production draft schema
      // (AiChoiceDraftSchema.actions is length(2) and finalization maps 1:1).
      // The 2-3 range in choice-quality is downstream validator tolerance, not
      // generation shape, and must never be frozen as the emitted count.
      choiceOptionsPerResponse: z.literal(2),
      choiceOptionsValidatorAcceptedRange: z.tuple([z.literal(2), z.literal(3)]),
      // Provider candidates attemptable per invocation; distinct from the
      // reader option count and from total workflow requests.
      providerCandidateLimitPerInvocation: z.literal(3),
      providerRequestsPerWorkflowMax: z.literal(5),
      workflowTimeoutMs: z.literal(120_000),
    }).strict(),
    longHorizonSemantic: RouteBaseSchema.extend({
      routeKind: z.literal('LONG_HORIZON_SEMANTIC'),
      semanticUseCase: z.literal('m10_g_long_horizon_semantic_judge'),
    }).strict(),
  }).strict(),
  authorityHash: Sha256Schema,
}).strict()

export type M10GG1RouteAuthority = z.infer<typeof M10GG1RouteAuthoritySchema>
export type M10GG1ProductionRouteName = 'writer' | 'continuity' | 'choice'

export function computeM10GG1RouteAuthorityHash(
  authority: Omit<M10GG1RouteAuthority, 'authorityHash'>,
): string {
  return computeSha256(stableStringify(authority))
}

export function assertM10GG1RouteAuthority(authority: unknown): M10GG1RouteAuthority {
  const parsed = M10GG1RouteAuthoritySchema.parse(authority)
  const { authorityHash, ...payload } = parsed
  if (computeM10GG1RouteAuthorityHash(payload) !== authorityHash) {
    throw new Error('M10G_G1_ROUTE_AUTHORITY_HASH_MISMATCH')
  }
  for (const route of Object.values(parsed.routes)) {
    route.providerModelCandidateOrder.forEach((candidate, index) => {
      if (candidate.fallbackIndex !== index) {
        throw new Error('M10G_G1_ROUTE_CANDIDATE_ORDER_INVALID')
      }
    })
    const expectedFallback = route.providerModelCandidateOrder.length === 1
      ? 'NONE'
      : 'ORDERED_CANDIDATE_FALLBACK'
    if (route.fallbackBehavior !== expectedFallback) {
      throw new Error('M10G_G1_ROUTE_FALLBACK_BEHAVIOR_INVALID')
    }
  }
  return parsed
}

function configuredNumber(
  field: z.infer<typeof NullSchema> | z.infer<typeof NumberValueSchema>,
): number | null {
  return field.presence === 'NULL' ? null : field.value
}

function configuredReasoning(
  field: z.infer<typeof OmittedSchema> | z.infer<typeof NullSchema> | z.infer<typeof StringValueSchema>,
): string | null | undefined {
  if (field.presence === 'OMITTED') return undefined
  return field.presence === 'NULL' ? null : field.value
}

/** Projects frozen authority into same route interface consumed by production gateway. */
export function toAiModelRoute(
  authority: M10GG1RouteAuthority,
  name: M10GG1ProductionRouteName,
): AiModelRoute {
  const route = authority.routes[name]
  const [primary, ...fallbacks] = route.providerModelCandidateOrder
  if (!primary) throw new Error('M10G_G1_ROUTE_PRIMARY_MISSING')
  const reasoningEffort = configuredReasoning(route.configuredRoute.reasoning)
  return {
    useCase: route.productionUseCase,
    provider: primary.provider,
    modelId: primary.modelId,
    fallbackModels: fallbacks.map(({ provider, modelId }) => ({ provider, modelId })),
    temperature: configuredNumber(route.configuredRoute.temperature),
    maxOutputTokens: configuredNumber(route.configuredRoute.maxOutput),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    routeVersion: route.routeVersion,
  }
}
