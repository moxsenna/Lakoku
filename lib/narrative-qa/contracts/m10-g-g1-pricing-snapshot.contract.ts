import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

export const M10G_G1_PRICING_METADATA_ENDPOINT = 'https://openrouter.ai/api/v1/models' as const
export const M10G_G1_PRICING_TARGET_ALIASES = Object.freeze([
  'openai/gpt-5.6-sol',
  'openai/gpt-4.1-mini',
  'deepseek/deepseek-v3.2',
  'deepseek/deepseek-v3.1-terminus',
] as const)

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const DecimalStringSchema = z.string().regex(/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
const PresenceDecimalSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('VALUE'), value: DecimalStringSchema }).strict(),
  z.object({ state: z.literal('NULL') }).strict(),
  z.object({ state: z.literal('OMITTED') }).strict(),
])
const PresenceUnknownSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('VALUE'), value: z.unknown() }).strict(),
  z.object({ state: z.literal('NULL') }).strict(),
  z.object({ state: z.literal('OMITTED') }).strict(),
])
const PresenceStringSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('VALUE'), value: z.string().min(1) }).strict(),
  z.object({ state: z.literal('NULL') }).strict(),
  z.object({ state: z.literal('OMITTED') }).strict(),
])
const TokenPriceSchema = z.object({
  sourcePerTokenUsd: PresenceDecimalSchema,
  per1MTokensUsd: PresenceDecimalSchema,
}).strict()

export const M10GG1NormalizedModelPricingSchema = z.object({
  configuredAlias: z.string().min(1),
  metadataRowAlias: z.string().min(1),
  canonicalModelId: PresenceStringSchema,
  currency: z.literal('USD'),
  tokenUnit: z.literal('1000000'),
  input: TokenPriceSchema,
  output: TokenPriceSchema,
  reasoning: TokenPriceSchema,
  cacheRead: TokenPriceSchema,
  cacheWrite: TokenPriceSchema,
  perRequest: z.record(z.string(), PresenceDecimalSchema),
  sourcePriceComponents: z.record(z.string(), PresenceDecimalSchema),
  tier: PresenceUnknownSchema,
  overrides: PresenceUnknownSchema,
  contextLength: z.number().int().nonnegative().nullable(),
  maximumOutputTokens: z.number().int().nonnegative().nullable(),
  routingSemantics: z.object({
    topProvider: PresenceUnknownSchema,
    perRequestLimits: PresenceUnknownSchema,
    endpointDetailsLink: PresenceStringSchema,
  }).strict(),
}).strict()

export type M10GG1NormalizedModelPricing = z.infer<typeof M10GG1NormalizedModelPricingSchema>

const NormalizedPayloadSchema = z.object({
  targetAliases: z.array(z.string().min(1)).length(M10G_G1_PRICING_TARGET_ALIASES.length),
  models: z.array(M10GG1NormalizedModelPricingSchema).length(M10G_G1_PRICING_TARGET_ALIASES.length),
}).strict()

export const M10GG1PricingSnapshotSchema = z.object({
  schemaVersion: z.literal('M10G_G1_PRICING_SNAPSHOT_V1'),
  metadataRequest: z.object({
    method: z.literal('GET'),
    endpoint: z.literal(M10G_G1_PRICING_METADATA_ENDPOINT),
    provider: z.literal('OpenRouter'),
    authenticated: z.literal(false),
  }).strict(),
  retrievedAt: z.string().datetime(),
  rawResponseSha256: Sha256Schema,
  rawResponseByteLength: z.string().regex(/^[1-9][0-9]*$/),
  rawRetainedSubset: z.object({ data: z.array(z.record(z.string(), z.unknown())) }).strict(),
  rawRetainedSubsetCanonicalSha256: Sha256Schema,
  normalized: NormalizedPayloadSchema.extend({ canonicalHash: Sha256Schema }).strict(),
}).strict()

export type M10GG1PricingSnapshot = z.infer<typeof M10GG1PricingSnapshotSchema>

type Presence<T> = { state: 'VALUE'; value: T } | { state: 'NULL' } | { state: 'OMITTED' }
type RawModel = Record<string, unknown>

function ownPresence(record: Record<string, unknown>, key: string): Presence<unknown> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { state: 'OMITTED' }
  return record[key] === null ? { state: 'NULL' } : { state: 'VALUE', value: record[key] }
}

function decimalPresence(record: Record<string, unknown>, key: string): Presence<string> {
  const presence = ownPresence(record, key)
  if (presence.state !== 'VALUE') return presence
  if (typeof presence.value !== 'string') throw new Error(`M10G_G1_PRICING_NON_DECIMAL:${key}`)
  canonicalizeNonnegativeDecimal(presence.value)
  return { state: 'VALUE', value: presence.value }
}

function tokenPrice(pricing: Record<string, unknown>, key: string) {
  const sourcePerTokenUsd = decimalPresence(pricing, key)
  return {
    sourcePerTokenUsd,
    per1MTokensUsd: sourcePerTokenUsd.state === 'VALUE'
      ? { state: 'VALUE' as const, value: multiplyDecimalByInteger(sourcePerTokenUsd.value, BigInt(1_000_000)) }
      : sourcePerTokenUsd,
  }
}

export function canonicalizeNonnegativeDecimal(value: string): string {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value)
  if (!match) throw new Error(`M10G_G1_PRICING_DECIMAL_INVALID:${value}`)
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  return fraction.length > 0 ? `${match[1]}.${fraction}` : match[1]
}

export function multiplyDecimalByInteger(value: string, multiplier: bigint): string {
  if (multiplier < BigInt(0)) throw new Error('M10G_G1_PRICING_MULTIPLIER_NEGATIVE')
  const canonical = canonicalizeNonnegativeDecimal(value)
  const [whole, fraction = ''] = canonical.split('.')
  const coefficient = BigInt(whole + fraction) * multiplier
  if (fraction.length === 0) return coefficient.toString()
  const digits = coefficient.toString().padStart(fraction.length + 1, '0')
  return canonicalizeNonnegativeDecimal(`${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}`)
}

function requireRecord(value: unknown, error: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}

function validateOverridePrices(value: Presence<unknown>, modelId: string): void {
  if (value.state !== 'VALUE') return
  if (!Array.isArray(value.value)) throw new Error(`M10G_G1_PRICING_OVERRIDES_INVALID:${modelId}`)
  for (const override of value.value) {
    const record = requireRecord(override, `M10G_G1_PRICING_OVERRIDE_INVALID:${modelId}`)
    for (const key of ['prompt', 'completion', 'internal_reasoning', 'input_cache_read', 'input_cache_write', 'request']) {
      const price = ownPresence(record, key)
      if (price.state === 'VALUE') {
        if (typeof price.value !== 'string') throw new Error(`M10G_G1_PRICING_OVERRIDE_NON_DECIMAL:${modelId}:${key}`)
        canonicalizeNonnegativeDecimal(price.value)
      }
    }
  }
}

function normalizedModel(row: RawModel): M10GG1NormalizedModelPricing {
  const id = typeof row.id === 'string' ? row.id : ''
  if (!id) throw new Error('M10G_G1_PRICING_MODEL_ID_MISSING')
  const pricing = requireRecord(row.pricing, `M10G_G1_PRICING_ROW_PRICING_MISSING:${id}`)
  const topProviderPresence = ownPresence(row, 'top_provider')
  const topProvider = topProviderPresence.state === 'VALUE'
    ? requireRecord(topProviderPresence.value, `M10G_G1_PRICING_TOP_PROVIDER_INVALID:${id}`)
    : null
  const overridePresence = ownPresence(pricing, 'overrides')
  validateOverridePrices(overridePresence, id)
  const sourcePriceComponents = Object.fromEntries(
    Object.keys(pricing).sort().filter((key) => key !== 'overrides').map((key) => [key, decimalPresence(pricing, key)]),
  )
  const perRequest = Object.fromEntries(
    ['request', 'web_search', 'image'].filter((key) => Object.prototype.hasOwnProperty.call(pricing, key))
      .map((key) => [key, decimalPresence(pricing, key)]),
  )
  const linkPresence = ownPresence(requireRecord(row.links, `M10G_G1_PRICING_LINKS_MISSING:${id}`), 'details')
  if (linkPresence.state === 'VALUE' && typeof linkPresence.value !== 'string') {
    throw new Error(`M10G_G1_PRICING_DETAILS_LINK_INVALID:${id}`)
  }
  const canonicalPresence = ownPresence(row, 'canonical_slug')
  if (canonicalPresence.state === 'VALUE' && typeof canonicalPresence.value !== 'string') {
    throw new Error(`M10G_G1_PRICING_CANONICAL_INVALID:${id}`)
  }
  return M10GG1NormalizedModelPricingSchema.parse({
    configuredAlias: id,
    metadataRowAlias: id,
    canonicalModelId: canonicalPresence,
    currency: 'USD',
    tokenUnit: '1000000',
    input: tokenPrice(pricing, 'prompt'),
    output: tokenPrice(pricing, 'completion'),
    reasoning: tokenPrice(pricing, 'internal_reasoning'),
    cacheRead: tokenPrice(pricing, 'input_cache_read'),
    cacheWrite: tokenPrice(pricing, 'input_cache_write'),
    perRequest,
    sourcePriceComponents,
    tier: ownPresence(pricing, 'tier'),
    overrides: overridePresence,
    contextLength: typeof row.context_length === 'number' ? row.context_length : null,
    maximumOutputTokens: topProvider && typeof topProvider.max_completion_tokens === 'number'
      ? topProvider.max_completion_tokens
      : null,
    routingSemantics: {
      topProvider: topProviderPresence,
      perRequestLimits: ownPresence(row, 'per_request_limits'),
      endpointDetailsLink: linkPresence,
    },
  })
}

export function createM10GG1PricingSnapshot(params: {
  retrievedAt: string
  rawResponseSha256: string
  rawResponseByteLength: string
  rawModelsResponse: unknown
}): M10GG1PricingSnapshot {
  const response = requireRecord(params.rawModelsResponse, 'M10G_G1_PRICING_RESPONSE_INVALID')
  if (!Array.isArray(response.data)) throw new Error('M10G_G1_PRICING_RESPONSE_DATA_INVALID')
  const rows = response.data.map((row) => requireRecord(row, 'M10G_G1_PRICING_ROW_INVALID'))
  const retained = M10G_G1_PRICING_TARGET_ALIASES.map((target) => {
    const matches = rows.filter((row) => row.id === target)
    if (matches.length !== 1) throw new Error(`M10G_G1_PRICING_TARGET_COVERAGE:${target}:${matches.length}`)
    return matches[0]
  })
  const rawRetainedSubset = { data: retained }
  const normalizedPayload = {
    targetAliases: [...M10G_G1_PRICING_TARGET_ALIASES],
    models: retained.map(normalizedModel),
  }
  return validateM10GG1PricingSnapshot({
    schemaVersion: 'M10G_G1_PRICING_SNAPSHOT_V1',
    metadataRequest: {
      method: 'GET',
      endpoint: M10G_G1_PRICING_METADATA_ENDPOINT,
      provider: 'OpenRouter',
      authenticated: false,
    },
    retrievedAt: params.retrievedAt,
    rawResponseSha256: params.rawResponseSha256,
    rawResponseByteLength: params.rawResponseByteLength,
    rawRetainedSubset,
    rawRetainedSubsetCanonicalSha256: computeSha256(stableStringify(rawRetainedSubset)),
    normalized: {
      ...normalizedPayload,
      canonicalHash: computeSha256(stableStringify(normalizedPayload)),
    },
  })
}

export function validateM10GG1PricingSnapshot(input: unknown): M10GG1PricingSnapshot {
  const parsed = M10GG1PricingSnapshotSchema.safeParse(input)
  if (!parsed.success) throw new Error(`M10G_G1_PRICING_SNAPSHOT_INVALID:${parsed.error.message}`)
  const snapshot = parsed.data
  const targetAliases = [...M10G_G1_PRICING_TARGET_ALIASES]
  if (new Set(snapshot.normalized.models.map((model) => model.configuredAlias)).size !== targetAliases.length) {
    throw new Error('M10G_G1_PRICING_MODEL_IDS_NOT_UNIQUE')
  }
  if (stableStringify(snapshot.normalized.targetAliases) !== stableStringify(targetAliases)) {
    throw new Error('M10G_G1_PRICING_TARGET_SET_MISMATCH')
  }
  for (const [index, target] of targetAliases.entries()) {
    const model = snapshot.normalized.models[index]
    const raw = snapshot.rawRetainedSubset.data[index]
    if (!model || model.configuredAlias !== target || model.metadataRowAlias !== target || raw?.id !== target) {
      throw new Error(`M10G_G1_PRICING_ALIAS_MISMATCH:${target}`)
    }
    for (const presence of Object.values(model.sourcePriceComponents)) {
      if (presence.state === 'VALUE') canonicalizeNonnegativeDecimal(presence.value)
    }
  }
  const retainedHash = computeSha256(stableStringify(snapshot.rawRetainedSubset))
  if (retainedHash !== snapshot.rawRetainedSubsetCanonicalSha256) {
    throw new Error('M10G_G1_PRICING_RAW_SUBSET_HASH_MISMATCH')
  }
  const { canonicalHash, ...normalizedPayload } = snapshot.normalized
  if (computeSha256(stableStringify(normalizedPayload)) !== canonicalHash) {
    throw new Error('M10G_G1_PRICING_NORMALIZED_HASH_MISMATCH')
  }
  return Object.freeze(snapshot)
}
