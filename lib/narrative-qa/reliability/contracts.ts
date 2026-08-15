import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

export const EXECUTION_PROFILES = ['CONTRACT_FIXTURE', 'RELEASE_EVIDENCE'] as const
export const ENGINEERING_GATES = ['PASS', 'FAIL', 'HOLD'] as const
export const RELEASE_READINESS_VALUES = ['HOLD', 'BLOCKED', 'READY'] as const
export const BUDGET_GATES = ['PASS', 'FAIL', 'BLOCKED_E0_COST_CEILING_NOT_APPROVED'] as const
export const STAGE_IDS = [
  'PROSE_PRIMARY',
  'PROSE_RETRY',
  'PROVIDER_FALLBACK',
  'CHECKPOINT_RECOVERY',
  'STRUCTURED_OUTPUT',
  'STRUCTURED_RETRY',
  'OWNERSHIP',
  'OWNERSHIP_RECOVERY',
  'PUBLICATION',
  'PUBLICATION_RECOVERY',
  'POST_PUBLISH',
] as const
export const TASK_IDS = ['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT', 'RUNTIME_RECOVERY'] as const
export const ATTEMPT_CLASSES = ['PRIMARY', 'RETRY', 'FALLBACK'] as const
export const MISSING_REASON_CODES = [
  'TELEMETRY_UNAVAILABLE',
  'OBSERVATION_COVERAGE_INCOMPLETE',
  'COST_UNAVAILABLE',
  'CURRENCY_CONVERSION_UNAVAILABLE',
  'PROFILE_THRESHOLD_NOT_MET',
  'AUTHORITY_UNAVAILABLE',
] as const
export const GATE_REASON_CODES = [
  'MALFORMED_EVIDENCE',
  'AUTHORITY_HASH_MISMATCH',
  'SEMANTIC_IDENTITY_CONFLICT',
  'DECIMAL_COEFFICIENT_OVERFLOW',
  'MISSING_MEASUREMENT',
  'PROVENANCE_VIOLATION',
] as const

export const EXECUTION_PROFILE_SCHEMA = z.enum(EXECUTION_PROFILES)
export const ENGINEERING_GATE_SCHEMA = z.enum(ENGINEERING_GATES)
export const RELEASE_READINESS_SCHEMA = z.enum(RELEASE_READINESS_VALUES)
export const BUDGET_GATE_SCHEMA = z.enum(BUDGET_GATES)
export const STAGE_ID_SCHEMA = z.enum(STAGE_IDS)
export const TASK_ID_SCHEMA = z.enum(TASK_IDS)
export const ATTEMPT_CLASS_SCHEMA = z.enum(ATTEMPT_CLASSES)
export const MISSING_REASON_CODE_SCHEMA = z.enum(MISSING_REASON_CODES)
export const GATE_REASON_CODE_SCHEMA = z.enum(GATE_REASON_CODES)
export const SHA256_SCHEMA = z.string().regex(/^[0-9a-f]{64}$/)
export const SAFE_ALIAS_SCHEMA = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
export const OBSERVATION_REFERENCE_SCHEMA = z.string().min(1).max(256)
export const OBSERVATION_REFERENCES_SCHEMA = z.array(OBSERVATION_REFERENCE_SCHEMA).min(1)
export const COUNT_SCHEMA = z.number().int().nonnegative()
export const ATTEMPT_NUMBER_SCHEMA = z.number().int().positive()
export const FALLBACK_INDEX_SCHEMA = z.number().int().nonnegative()
export const ELIGIBLE_COUNT_SCHEMA = COUNT_SCHEMA
export const INCLUDED_COUNT_SCHEMA = COUNT_SCHEMA
export const EXCLUDED_COUNT_SCHEMA = COUNT_SCHEMA
export const COVERAGE_COUNT_SCHEMA = z.strictObject({
  includedCount: INCLUDED_COUNT_SCHEMA,
  excludedCount: EXCLUDED_COUNT_SCHEMA,
  eligibleCount: ELIGIBLE_COUNT_SCHEMA,
})

export type ExecutionProfile = z.infer<typeof EXECUTION_PROFILE_SCHEMA>
export type EngineeringGate = z.infer<typeof ENGINEERING_GATE_SCHEMA>
export type ReleaseReadiness = z.infer<typeof RELEASE_READINESS_SCHEMA>
export type BudgetGate = z.infer<typeof BUDGET_GATE_SCHEMA>
export type StageId = z.infer<typeof STAGE_ID_SCHEMA>
export type TaskId = z.infer<typeof TASK_ID_SCHEMA>
export type AttemptClass = z.infer<typeof ATTEMPT_CLASS_SCHEMA>
export type MissingReasonCode = z.infer<typeof MISSING_REASON_CODE_SCHEMA>
export type GateReasonCode = z.infer<typeof GATE_REASON_CODE_SCHEMA>
export type SafeAlias = z.infer<typeof SAFE_ALIAS_SCHEMA>

const CHAPTER_VALUES = Array.from({ length: 50 }, (_, index) => index + 1)
export const CHAPTER_SEQUENCE = Object.freeze(CHAPTER_VALUES) as readonly number[]
export const CHAPTER_NUMBER_SCHEMA = z.number().int().min(1).max(50)
export type ChapterNumber = z.infer<typeof CHAPTER_NUMBER_SCHEMA>

export function chapterNumber(value: number): ChapterNumber {
  return CHAPTER_NUMBER_SCHEMA.parse(value)
}

export const NOVEL_IDENTITY_SCHEMA = z.strictObject({
  storyAlias: SAFE_ALIAS_SCHEMA,
  novelExecutionAlias: SAFE_ALIAS_SCHEMA,
  chapterSequence: z.tuple(CHAPTER_VALUES.map((chapter) => z.literal(chapter)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
})
export type NovelIdentity = z.infer<typeof NOVEL_IDENTITY_SCHEMA>

export const COMPATIBLE_STRATUM_IDENTITY_SCHEMA = z.strictObject({
  retryFallbackPolicyId: SAFE_ALIAS_SCHEMA,
  retryFallbackPolicyHash: SHA256_SCHEMA,
  topologyVersion: z.string().min(1),
  topologyHash: SHA256_SCHEMA,
  stageCatalogVersion: z.string().min(1),
  stageCatalogHash: SHA256_SCHEMA,
  taskMappingVersion: z.string().min(1),
  taskMappingHash: SHA256_SCHEMA,
  providerModelPolicyId: SAFE_ALIAS_SCHEMA,
  pricingPolicyVersion: z.string().min(1),
  pricingSnapshotHash: SHA256_SCHEMA,
})
export type CompatibleStratumIdentity = z.infer<typeof COMPATIBLE_STRATUM_IDENTITY_SCHEMA>

const HASH_BOUND_AUTHORITY_BASE = {
  authorityVersion: z.string().min(1),
  decisionRef: z.string().min(1),
  canonicalHash: SHA256_SCHEMA,
}

export const ASSUMPTION_AUTHORITY_SCHEMA = z.strictObject({
  ...HASH_BOUND_AUTHORITY_BASE,
  rationale: z.string().min(1),
}).superRefine(verifyAuthorityHash)

export const MODEL_AUTHORITY_SCHEMA = z.strictObject({
  ...HASH_BOUND_AUTHORITY_BASE,
  modelVersion: z.string().min(1),
}).superRefine(verifyAuthorityHash)

export const E0_APPROVAL_AUTHORITY_SCHEMA = z.strictObject({
  ...HASH_BOUND_AUTHORITY_BASE,
  approvalStatus: z.literal('APPROVED'),
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
}).superRefine(verifyAuthorityHash)

const RUNTIME_NOT_APPLICABLE_STAGE_SCHEMA = z.enum([
  'CHECKPOINT_RECOVERY',
  'OWNERSHIP',
  'OWNERSHIP_RECOVERY',
  'PUBLICATION',
  'PUBLICATION_RECOVERY',
  'POST_PUBLISH',
])
export const NOT_APPLICABLE_AUTHORITY_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_TOPOLOGY_V1'),
  stageId: RUNTIME_NOT_APPLICABLE_STAGE_SCHEMA,
  taskId: z.literal('RUNTIME_RECOVERY'),
  applicability: z.literal('PROVIDER_CALL_NOT_APPLICABLE'),
  decisionRef: z.string().min(1),
  canonicalHash: SHA256_SCHEMA,
}).superRefine(verifyAuthorityHash)

export type AssumptionAuthority = z.infer<typeof ASSUMPTION_AUTHORITY_SCHEMA>
export type ModelAuthority = z.infer<typeof MODEL_AUTHORITY_SCHEMA>
export type E0ApprovalAuthority = z.infer<typeof E0_APPROVAL_AUTHORITY_SCHEMA>
export type NotApplicableAuthority = z.infer<typeof NOT_APPLICABLE_AUTHORITY_SCHEMA>

function verifyAuthorityHash(value: { canonicalHash: string }, context: z.RefinementCtx): void {
  if (canonicalAuthorityHash(value) !== value.canonicalHash) {
    context.addIssue({ code: 'custom', message: 'Canonical authority hash mismatch', path: ['canonicalHash'] })
  }
}

export function canonicalAuthorityHash(value: Record<string, unknown>): string {
  const { canonicalHash: _canonicalHash, ...payload } = value
  return computeSha256(stableStringify(payload))
}

export type PresentMeasurement<T> = Readonly<{ state: 'PRESENT'; value: T }>
export type MissingMeasurement = Readonly<{ state: 'MISSING'; reasonCode: MissingReasonCode; detail: string }>
export type NotApplicableMeasurement = Readonly<{ state: 'NOT_APPLICABLE'; authority: NotApplicableAuthority }>
export type MeasurementState<T> = PresentMeasurement<T> | MissingMeasurement | NotApplicableMeasurement

export function measurementStateSchema<T>(valueSchema: z.ZodType<T>) {
  return z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('PRESENT'), value: valueSchema }),
    z.strictObject({ state: z.literal('MISSING'), reasonCode: MISSING_REASON_CODE_SCHEMA, detail: z.string().min(1) }),
    z.strictObject({ state: z.literal('NOT_APPLICABLE'), authority: NOT_APPLICABLE_AUTHORITY_SCHEMA }),
  ])
}

const observedBrand: unique symbol = Symbol('ObservedValue')
const assumedBrand: unique symbol = Symbol('AssumedValue')
const modeledBrand: unique symbol = Symbol('ModeledValue')
const pricingBrand: unique symbol = Symbol('PricingDerivedValue')
const businessBrand: unique symbol = Symbol('BusinessAuthorityValue')

export type ObservedValue<T> = Readonly<{
  provenance: 'OBSERVED'
  value: MeasurementState<T>
  observationRefs: readonly string[]
  readonly [observedBrand]: true
}>
export type AssumedValue<T> = Readonly<{
  provenance: 'ASSUMPTION'
  value: T
  source: AssumptionAuthority
  readonly [assumedBrand]: true
}>
export type ModeledValue<T> = Readonly<{
  provenance: 'MODELED'
  value: T
  modelAuthority: ModelAuthority
  inputHash: string
  readonly [modeledBrand]: true
}>
export type PricingDerivedValue<T> = Readonly<{
  provenance: 'MODELED_FROM_PRICING'
  value: MeasurementState<T>
  pricingSnapshotHash: string
  readonly [pricingBrand]: true
}>
export type BusinessAuthorityValue<T> = Readonly<{
  provenance: 'BUSINESS_AUTHORITY'
  value: T
  approval: E0ApprovalAuthority
  readonly [businessBrand]: true
}>

export function observedValueSchema<T>(valueSchema: z.ZodType<T>) {
  return z.strictObject({
    provenance: z.literal('OBSERVED'),
    value: measurementStateSchema(valueSchema),
    observationRefs: OBSERVATION_REFERENCES_SCHEMA,
  }).transform((input) => observedValue(input.value, input.observationRefs))
}

export function assumedValueSchema<T>(valueSchema: z.ZodType<T>) {
  return z.strictObject({
    provenance: z.literal('ASSUMPTION'),
    value: valueSchema,
    source: ASSUMPTION_AUTHORITY_SCHEMA,
  }).transform((input) => assumedValue(input.value, input.source))
}

export function modeledValueSchema<T>(valueSchema: z.ZodType<T>) {
  return z.strictObject({
    provenance: z.literal('MODELED'),
    value: valueSchema,
    modelAuthority: MODEL_AUTHORITY_SCHEMA,
    inputHash: SHA256_SCHEMA,
  }).transform((input) => modeledValue(input.value, input.modelAuthority, input.inputHash))
}

export function pricingDerivedValueSchema<T>(valueSchema: z.ZodType<T>) {
  return z.strictObject({
    provenance: z.literal('MODELED_FROM_PRICING'),
    value: measurementStateSchema(valueSchema),
    pricingSnapshotHash: SHA256_SCHEMA,
  }).transform((input) => pricingDerivedValue(input.value, input.pricingSnapshotHash))
}

export function businessAuthorityValueSchema<T>(valueSchema: z.ZodType<T>) {
  return z.strictObject({
    provenance: z.literal('BUSINESS_AUTHORITY'),
    value: valueSchema,
    approval: E0_APPROVAL_AUTHORITY_SCHEMA,
  }).transform((input) => businessAuthorityValue(input.value, input.approval))
}

export function observedValue<T>(value: MeasurementState<T>, refs: readonly string[]): ObservedValue<T> {
  const parsedValue = parseMeasurementState(value)
  const parsedRefs = OBSERVATION_REFERENCES_SCHEMA.parse(refs).slice().sort()
  const result: ObservedValue<T> = { provenance: 'OBSERVED', value: parsedValue, observationRefs: parsedRefs, [observedBrand]: true }
  return deepFreeze(result)
}

export function assumedValue<T>(value: T, authority: AssumptionAuthority): AssumedValue<T> {
  const source = ASSUMPTION_AUTHORITY_SCHEMA.parse(authority)
  const result: AssumedValue<T> = { provenance: 'ASSUMPTION', value, source, [assumedBrand]: true }
  return deepFreeze(result)
}

export function modeledValue<T>(value: T, authority: ModelAuthority, inputHash: string): ModeledValue<T> {
  const modelAuthority = MODEL_AUTHORITY_SCHEMA.parse(authority)
  const result: ModeledValue<T> = {
    provenance: 'MODELED',
    value,
    modelAuthority,
    inputHash: SHA256_SCHEMA.parse(inputHash),
    [modeledBrand]: true,
  }
  return deepFreeze(result)
}

export function pricingDerivedValue<T>(value: MeasurementState<T>, pricingSnapshotHash: string): PricingDerivedValue<T> {
  const result: PricingDerivedValue<T> = {
    provenance: 'MODELED_FROM_PRICING',
    value: parseMeasurementState(value),
    pricingSnapshotHash: SHA256_SCHEMA.parse(pricingSnapshotHash),
    [pricingBrand]: true,
  }
  return deepFreeze(result)
}

export function businessAuthorityValue<T>(value: T, approval: E0ApprovalAuthority): BusinessAuthorityValue<T> {
  const result: BusinessAuthorityValue<T> = {
    provenance: 'BUSINESS_AUTHORITY',
    value,
    approval: E0_APPROVAL_AUTHORITY_SCHEMA.parse(approval),
    [businessBrand]: true,
  }
  return deepFreeze(result)
}

export function presentMeasurement<T>(value: T): MeasurementState<T> {
  return deepFreeze({ state: 'PRESENT', value })
}

export function missingMeasurement<T>(reasonCode: MissingReasonCode, detail: string): MeasurementState<T> {
  return deepFreeze({ state: 'MISSING', reasonCode: MISSING_REASON_CODE_SCHEMA.parse(reasonCode), detail: z.string().min(1).parse(detail) })
}

export function notApplicableMeasurement<T>(authority: NotApplicableAuthority): MeasurementState<T> {
  return deepFreeze({ state: 'NOT_APPLICABLE', authority: NOT_APPLICABLE_AUTHORITY_SCHEMA.parse(authority) })
}

export function sortReasonCodes<T extends MissingReasonCode>(codes: readonly T[]): T[] {
  return [...codes].sort((left, right) => MISSING_REASON_CODES.indexOf(left) - MISSING_REASON_CODES.indexOf(right))
}

function parseMeasurementState<T>(value: MeasurementState<T>): MeasurementState<T> {
  if (value === null || typeof value !== 'object' || !('state' in value)) throw new Error('Invalid measurement state')
  switch (value.state) {
    case 'PRESENT': {
      const parsed = z.strictObject({ state: z.literal('PRESENT'), value: z.custom<T>() }).parse(value)
      return deepFreeze({ state: parsed.state, value: structuredClone(parsed.value) })
    }
    case 'MISSING':
      return deepFreeze(z.strictObject({
        state: z.literal('MISSING'),
        reasonCode: MISSING_REASON_CODE_SCHEMA,
        detail: z.string().min(1),
      }).parse(value))
    case 'NOT_APPLICABLE':
      return deepFreeze(z.strictObject({
        state: z.literal('NOT_APPLICABLE'),
        authority: NOT_APPLICABLE_AUTHORITY_SCHEMA,
      }).parse(value))
    default:
      throw new Error('Invalid measurement state')
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
