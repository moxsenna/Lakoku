import { z } from 'zod'

export const NORMALIZATION_SCHEMA_VERSION = 'M10_E_NORMALIZATION_V1'

export const REMOVED_OPERATIONAL_FIELDS = [
  'startedAt',
  'finishedAt',
  'elapsedMilliseconds',
  'artifactDirectoryPath',
] as const
export type RemovedOperationalField = (typeof REMOVED_OPERATIONAL_FIELDS)[number]

export const ALIASED_OPERATIONAL_ID_PATHS = ['executionInstanceId'] as const
export type AliasedOperationalIdPath = (typeof ALIASED_OPERATIONAL_ID_PATHS)[number]

const OPERATIONAL_ALIAS_SCHEMA = z.string().regex(/^execution-[0-9]{4}$/)
const MAX_ALIASED_EXECUTIONS = 9999

export const RELIABILITY_EXECUTION_METADATA_SCHEMA = z.strictObject({
  executionInstanceId: z.string().min(1).max(256),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  elapsedMilliseconds: z.number().int().nonnegative(),
  artifactDirectoryPath: z.string().min(1),
})
export type ReliabilityExecutionMetadata = z.infer<typeof RELIABILITY_EXECUTION_METADATA_SCHEMA>

export const RELIABILITY_NORMALIZED_EXECUTION_SCHEMA = z.strictObject({
  executionInstanceId: OPERATIONAL_ALIAS_SCHEMA,
})
export type ReliabilityNormalizedExecution = z.infer<typeof RELIABILITY_NORMALIZED_EXECUTION_SCHEMA>

export const RELIABILITY_NORMALIZATION_BLOCK_SCHEMA = z.strictObject({
  schemaVersion: z.literal(NORMALIZATION_SCHEMA_VERSION),
  removedOperationalFields: z.array(z.enum(REMOVED_OPERATIONAL_FIELDS)),
  aliasMap: z.record(z.enum(ALIASED_OPERATIONAL_ID_PATHS), OPERATIONAL_ALIAS_SCHEMA),
})
export type ReliabilityNormalizationBlock = z.infer<typeof RELIABILITY_NORMALIZATION_BLOCK_SCHEMA>

/**
 * Path-specific normalization for raw reliability envelopes.
 *
 * Only declared operational fields are removed (raw timestamps, elapsed runtime,
 * physical artifact path) and only declared operational identifiers are aliased
 * (execution instance id) through a shared deterministic map that preserves the
 * equality/mismatch graph: identical raw values always map to one alias and
 * distinct raw values always map to distinct aliases. Financial fields,
 * currencies, prices, authority dates, assumption scopes/hashes,
 * stage/task/chapter identity, mean conditioning and denominators, stage order,
 * and judge order are never touched by normalization.
 */

export function buildExecutionAliasMap(operationalIds: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  let index = 0
  for (const value of operationalIds) {
    if (map.has(value)) continue
    index += 1
    if (index > MAX_ALIASED_EXECUTIONS) {
      throw new RangeError('Operational alias pool exhausted; too many distinct execution instances')
    }
    map.set(value, `execution-${String(index).padStart(4, '0')}`)
  }
  return map
}

export function normalizeExecutionMetadata(
  execution: ReliabilityExecutionMetadata,
): Readonly<{
  execution: ReliabilityNormalizedExecution
  normalization: ReliabilityNormalizationBlock
}> {
  const parsed = RELIABILITY_EXECUTION_METADATA_SCHEMA.parse(execution)
  const aliasMap = buildExecutionAliasMap([parsed.executionInstanceId])
  const alias = aliasMap.get(parsed.executionInstanceId)!
  return Object.freeze({
    execution: Object.freeze({ executionInstanceId: alias }),
    normalization: Object.freeze({
      schemaVersion: NORMALIZATION_SCHEMA_VERSION,
      removedOperationalFields: [...REMOVED_OPERATIONAL_FIELDS],
      aliasMap: Object.freeze({ executionInstanceId: alias }),
    }),
  })
}