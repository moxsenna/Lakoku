import { z } from 'zod'
import { SEMANTIC_RUBRIC_IDS } from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  CHAPTER_NUMBER_SCHEMA,
  CHAPTER_SEQUENCE,
  OBSERVATION_REFERENCE_SCHEMA,
  SAFE_ALIAS_SCHEMA,
  SHA256_SCHEMA,
  TASK_ID_SCHEMA,
  type TaskId,
} from './contracts'
import {
  canonicalizeDecimal,
  compareDecimals,
  type CanonicalDecimal,
} from './decimal'
import { M10_E_TASK_MAPPING_V1 } from './authorities'
import { type PricingSnapshot } from './pricing'

export const GENERATION_PROVIDER_STAGES = [
  'PROSE_PRIMARY',
  'PROSE_RETRY',
  'PROVIDER_FALLBACK',
  'STRUCTURED_OUTPUT',
  'STRUCTURED_RETRY',
] as const

export const GENERATION_PROVIDER_STAGE_SCHEMA = z.enum(GENERATION_PROVIDER_STAGES)
export type GenerationProviderStage = z.infer<typeof GENERATION_PROVIDER_STAGE_SCHEMA>

const ATTEMPT_CLASS_SCHEMA = z.enum(['PRIMARY', 'RETRY', 'FALLBACK'])

export const GENERATION_COST_KEY_SCHEMA = z.strictObject({
  kind: z.literal('GENERATION'),
  chapterNumber: CHAPTER_NUMBER_SCHEMA,
  stageId: GENERATION_PROVIDER_STAGE_SCHEMA,
  taskId: TASK_ID_SCHEMA,
  attemptClass: ATTEMPT_CLASS_SCHEMA,
  providerModelPolicyId: SAFE_ALIAS_SCHEMA,
}).superRefine((input, context) => {
  const row = M10_E_TASK_MAPPING_V1.mapping.find((candidate) => candidate.stageId === input.stageId)
  if (!row) {
    context.addIssue({ code: 'custom', message: `Missing frozen task mapping for stage ${input.stageId}` })
    return
  }
  if (row.taskId !== input.taskId || row.attemptClass !== input.attemptClass) {
    context.addIssue({
      code: 'custom',
      message: `Stage ${input.stageId} requires task ${row.taskId} and attempt class ${row.attemptClass} per frozen task mapping`,
    })
  }
})
export type GenerationCostKey = z.infer<typeof GENERATION_COST_KEY_SCHEMA>

export const JUDGE_COST_KEY_SCHEMA = z.strictObject({
  kind: z.literal('JUDGE'),
  judgeTaskId: z.enum(SEMANTIC_RUBRIC_IDS),
  evaluationIndex: z.number().int().min(0).max(2),
  providerModelPolicyId: SAFE_ALIAS_SCHEMA,
})
export type JudgeCostKey = z.infer<typeof JUDGE_COST_KEY_SCHEMA>

export type CostDistributionKey = GenerationCostKey | JudgeCostKey

export function formatCostDistributionKey(key: CostDistributionKey): string {
  if (key.kind === 'GENERATION') {
    return `GENERATION:${key.chapterNumber}:${key.stageId}:${key.taskId}:${key.attemptClass}:${key.providerModelPolicyId}`
  }
  return `JUDGE:${key.judgeTaskId}:${key.evaluationIndex}:${key.providerModelPolicyId}`
}

export function generationCostKey(params: {
  chapterNumber: number
  stageId: GenerationProviderStage
  taskId: TaskId
  attemptClass: 'PRIMARY' | 'RETRY' | 'FALLBACK'
  providerModelPolicyId: string
}): GenerationCostKey {
  return Object.freeze(GENERATION_COST_KEY_SCHEMA.parse({
    kind: 'GENERATION',
    ...params,
  }))
}

export function judgeCostKey(params: {
  judgeTaskId: (typeof SEMANTIC_RUBRIC_IDS)[number]
  evaluationIndex: number
  providerModelPolicyId: string
}): JudgeCostKey {
  return Object.freeze(JUDGE_COST_KEY_SCHEMA.parse({
    kind: 'JUDGE',
    ...params,
  }))
}

export interface ObservedCostEntry {
  readonly provenance: 'OBSERVED'
  readonly cost: CanonicalDecimal<'MONEY'>
  readonly observationId: string
}

export interface ModeledPricingCostEntry {
  readonly provenance: 'MODELED_FROM_PRICING'
  readonly cost: CanonicalDecimal<'MONEY'>
  readonly pricingSnapshotHash: string
  readonly observationId: string
}

export type CostDistributionEntry = ObservedCostEntry | ModeledPricingCostEntry

export function observedCostEntry(cost: string, observationId: string): ObservedCostEntry {
  return Object.freeze({
    provenance: 'OBSERVED' as const,
    cost: canonicalizeDecimal(cost, 'MONEY'),
    observationId: OBSERVATION_REFERENCE_SCHEMA.parse(observationId),
  })
}

export function modeledPricingCostEntry(cost: string, pricingSnapshotHash: string, observationId: string): ModeledPricingCostEntry {
  return Object.freeze({
    provenance: 'MODELED_FROM_PRICING' as const,
    cost: canonicalizeDecimal(cost, 'MONEY'),
    pricingSnapshotHash: SHA256_SCHEMA.parse(pricingSnapshotHash),
    observationId: OBSERVATION_REFERENCE_SCHEMA.parse(observationId),
  })
}

export interface CostDistribution {
  readonly key: CostDistributionKey
  readonly provenance: 'OBSERVED' | 'MODELED_FROM_PRICING'
  readonly currency: string
  readonly entries: readonly CostDistributionEntry[]
  readonly canonicalHash: string
}

export type EmpiricalAvailability = 'AVAILABLE' | 'EXPLICITLY_UNAVAILABLE'

export interface EmpiricalCostEvidenceSource {
  readonly availability: EmpiricalAvailability
  readonly distributions: ReadonlyMap<string, readonly ObservedCostEntry[]>
}

export interface PricingCostFallbackSource {
  readonly pricingSnapshot: PricingSnapshot
  readonly distributions: ReadonlyMap<string, readonly ModeledPricingCostEntry[]>
}

export type CostDistributionSelectionResult =
  | { readonly status: 'SELECTED'; readonly distribution: CostDistribution }
  | { readonly status: 'HOLD'; readonly reason: string }

export function sortCostDistributionEntries<T extends CostDistributionEntry>(
  entries: readonly T[],
): readonly T[] {
  const copy = [...entries]
  copy.sort((left, right) => {
    const costOrder = compareDecimals(left.cost, right.cost, 'MONEY')
    if (costOrder !== 0) return costOrder
    if (left.observationId < right.observationId) return -1
    if (left.observationId > right.observationId) return 1
    return 0
  })
  return Object.freeze(copy)
}

export function sampleCostFromDistribution(
  distribution: CostDistribution,
  drawWord: number,
): CanonicalDecimal<'MONEY'> {
  const n = distribution.entries.length
  if (n === 0) throw new Error('Cannot sample from empty cost distribution')
  if (!Number.isInteger(drawWord) || drawWord < 0 || drawWord > 4294967295) {
    throw new RangeError('Cost draw must be a uint32 word')
  }
  // Inverse empirical CDF: zero-based entry floor(c × n / 2^32).
  const index = Number((BigInt(drawWord) * BigInt(n)) >> BigInt(32))
  return distribution.entries[index].cost
}

export function computeCostDistributionHash(
  key: CostDistributionKey,
  provenance: 'OBSERVED' | 'MODELED_FROM_PRICING',
  currency: string,
  entries: readonly CostDistributionEntry[],
): string {
  const payload = {
    key,
    provenance,
    currency,
    entries: entries.map((entry) => entry.provenance === 'OBSERVED'
      ? { provenance: entry.provenance, cost: entry.cost, observationId: entry.observationId }
      : {
          provenance: entry.provenance,
          cost: entry.cost,
          pricingSnapshotHash: entry.pricingSnapshotHash,
          observationId: entry.observationId,
        }),
  }
  return computeSha256(stableStringify(payload))
}

export function selectCostDistribution(
  key: CostDistributionKey,
  currency: string,
  empiricalSource: EmpiricalCostEvidenceSource,
  pricingSource?: PricingCostFallbackSource,
): CostDistributionSelectionResult {
  const keyString = formatCostDistributionKey(key)

  if (empiricalSource.availability === 'AVAILABLE') {
    const entries = empiricalSource.distributions.get(keyString)
    if (!entries || entries.length === 0) {
      return { status: 'HOLD', reason: `Incomplete empirical evidence for ${keyString}` }
    }
    for (const entry of entries) {
      if (entry.provenance !== 'OBSERVED') {
        return { status: 'HOLD', reason: `Mixed provenance inside empirical distribution ${keyString}` }
      }
    }
    const sorted = sortCostDistributionEntries(entries)
    const distribution: CostDistribution = Object.freeze({
      key,
      provenance: 'OBSERVED',
      currency,
      entries: sorted,
      canonicalHash: computeCostDistributionHash(key, 'OBSERVED', currency, sorted),
    })
    return { status: 'SELECTED', distribution }
  }

  if (empiricalSource.availability === 'EXPLICITLY_UNAVAILABLE') {
    if (!pricingSource) {
      return { status: 'HOLD', reason: `Empirical unavailable with no pricing fallback for ${keyString}` }
    }
    if (pricingSource.pricingSnapshot.currency !== currency) {
      return { status: 'HOLD', reason: 'Currency mismatch: pricing fallback cannot convert currency' }
    }
    const entries = pricingSource.distributions.get(keyString)
    if (!entries || entries.length === 0) {
      return { status: 'HOLD', reason: `Missing pricing fallback entries for ${keyString}` }
    }
    for (const entry of entries) {
      if (entry.provenance !== 'MODELED_FROM_PRICING') {
        return { status: 'HOLD', reason: `Mixed provenance inside pricing fallback distribution ${keyString}` }
      }
      if (entry.pricingSnapshotHash !== pricingSource.pricingSnapshot.canonicalHash) {
        return { status: 'HOLD', reason: `Pricing snapshot hash mismatch for ${keyString}` }
      }
    }
    const sorted = sortCostDistributionEntries(entries)
    const distribution: CostDistribution = Object.freeze({
      key,
      provenance: 'MODELED_FROM_PRICING',
      currency,
      entries: sorted,
      canonicalHash: computeCostDistributionHash(key, 'MODELED_FROM_PRICING', currency, sorted),
    })
    return { status: 'SELECTED', distribution }
  }

  return { status: 'HOLD', reason: `Unknown empirical availability for ${keyString}` }
}

export function getAllGenerationCostKeys(providerModelPolicyId: string): readonly GenerationCostKey[] {
  const policyId = SAFE_ALIAS_SCHEMA.parse(providerModelPolicyId)
  const keys: GenerationCostKey[] = []
  const stageTaskAttempt = [
    ['PROSE_PRIMARY', 'CHAPTER_PROSE', 'PRIMARY'],
    ['PROSE_RETRY', 'CHAPTER_PROSE', 'RETRY'],
    ['PROVIDER_FALLBACK', 'CHAPTER_PROSE', 'FALLBACK'],
    ['STRUCTURED_OUTPUT', 'CHAPTER_STRUCTURED_OUTPUT', 'PRIMARY'],
    ['STRUCTURED_RETRY', 'CHAPTER_STRUCTURED_OUTPUT', 'RETRY'],
  ] as const
  for (const chapterNumber of CHAPTER_SEQUENCE) {
    for (const [stageId, taskId, attemptClass] of stageTaskAttempt) {
      keys.push(generationCostKey({ chapterNumber, stageId, taskId, attemptClass, providerModelPolicyId: policyId }))
    }
  }
  return Object.freeze(keys)
}

export function getAllJudgeCostKeys(providerModelPolicyId: string): readonly JudgeCostKey[] {
  const policyId = SAFE_ALIAS_SCHEMA.parse(providerModelPolicyId)
  const keys: JudgeCostKey[] = []
  for (const judgeTaskId of SEMANTIC_RUBRIC_IDS) {
    for (const evaluationIndex of [0, 1, 2] as const) {
      keys.push(judgeCostKey({ judgeTaskId, evaluationIndex, providerModelPolicyId: policyId }))
    }
  }
  return Object.freeze(keys)
}

export function missingRequiredCostKeys(
  requiredKeys: readonly CostDistributionKey[],
  providedKeys: ReadonlySet<string>,
): readonly string[] {
  const missing: string[] = []
  for (const key of requiredKeys) {
    const keyString = formatCostDistributionKey(key)
    if (!providedKeys.has(keyString)) missing.push(keyString)
  }
  return Object.freeze(missing)
}

export function assertCompleteRequiredCoverage(
  requiredKeys: readonly CostDistributionKey[],
  providedKeys: ReadonlySet<string>,
  scope: string,
): void {
  const missing = missingRequiredCostKeys(requiredKeys, providedKeys)
  if (missing.length > 0) {
    throw new Error(`Required ${scope} coverage incomplete; missing ${missing.length} key(s)`)
  }
}
