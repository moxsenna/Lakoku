/**
 * Subgate A decision: G1_GENERATION_POLICY_AUTHORITY_V1.
 *
 * Offline, zero-inference, zero-DB audit of every generation policy field that
 * the exact G-1 chapter path consumes. Repository defaults, migration seeds,
 * environment fallbacks, and test literals are recorded as observed values but
 * are never promoted to production authority: the runtime source of truth is
 * the mutable `generation_policy` row, which cannot be read in this track.
 */

export const M10G_G1_GENERATION_POLICY_DECISION_ID =
  'G1_GENERATION_POLICY_AUTHORITY_V1' as const

export type M10GG1PolicyAuthorityState =
  /** Effective value only provable by reading mutable runtime/DB state. */
  | 'MUTABLE_RUNTIME_STATE'
  /** Effective value already frozen by an immutable in-repo authority. */
  | 'FROZEN_IMMUTABLE_AUTHORITY'

export type M10GG1GenerationPolicyField = Readonly<{
  field: string
  runtimeConsumer: string
  actualSource: string
  currentEffectiveValue: string | null
  observedNonAuthoritativeValue: string | null
  observedValueKind: 'DEFAULT' | 'MIGRATION_SEED' | 'ENV_FALLBACK' | 'FROZEN_LITERAL' | 'NONE'
  sourceIsImmutable: boolean
  alreadyFrozenElsewhere: string | null
  authorityState: M10GG1PolicyAuthorityState
}>

export type M10GG1GenerationPolicyDecision = Readonly<{
  decisionId: typeof M10G_G1_GENERATION_POLICY_DECISION_ID
  status: 'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE'
  dbAccessPerformed: false
  inferencePerformed: false
  /** No snapshot/hash is emitted: no proven production values exist offline. */
  policySnapshotEmitted: false
  policySnapshotHash: null
  fields: readonly M10GG1GenerationPolicyField[]
  unboundFields: readonly string[]
  frozenFields: readonly string[]
  failClosedGuards: readonly string[]
  reason: string
  requiredAdditionalAuthority: readonly string[]
}>

const MUTABLE_SOURCE = 'generation_policy row id=1 (mutable DB state)'

const FIELDS: readonly M10GG1GenerationPolicyField[] = Object.freeze([
  Object.freeze({
    field: 'targetWordsMin',
    runtimeConsumer: 'createProviderFromExactRoutes generationPolicy → writer prompt length contract',
    actualSource: MUTABLE_SOURCE,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '800',
    observedValueKind: 'DEFAULT' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'targetWordsMax',
    runtimeConsumer: 'createProviderFromExactRoutes generationPolicy → writer prompt length contract',
    actualSource: MUTABLE_SOURCE,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '1000',
    observedValueKind: 'DEFAULT' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'targetScenes',
    runtimeConsumer: 'createProviderFromExactRoutes generationPolicy → writer scene contract',
    actualSource: MUTABLE_SOURCE,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '3',
    observedValueKind: 'DEFAULT' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'leaseTtlSeconds',
    runtimeConsumer: 'personalized generation durable lease acquisition',
    actualSource: `${MUTABLE_SOURCE}, clamped to 60..600 by resolveGenerationLeaseTtlSeconds`,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '300',
    observedValueKind: 'DEFAULT' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'maxConcurrentGenerations',
    runtimeConsumer: 'withGenerationSlot admission (refreshGenerationConcurrencyFromPolicy)',
    actualSource: `${MUTABLE_SOURCE} unless LAKOKU_MAX_CONCURRENT_GENERATIONS pins the process`,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '10',
    observedValueKind: 'ENV_FALLBACK' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'maxConcurrentGenerationsPerUser',
    runtimeConsumer: 'withGenerationSlot per-user admission',
    actualSource: `${MUTABLE_SOURCE} unless LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER pins the process`,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '1',
    observedValueKind: 'ENV_FALLBACK' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'generationMaxQueue',
    runtimeConsumer: 'withGenerationSlot queue admission',
    actualSource: `${MUTABLE_SOURCE} unless LAKOKU_GENERATION_MAX_QUEUE pins the process`,
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '40',
    observedValueKind: 'ENV_FALLBACK' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'generationQueueWaitMs',
    runtimeConsumer: 'acquireGenerationSlot wait timeout',
    actualSource: 'LAKOKU_GENERATION_QUEUE_WAIT_MS process environment',
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: '600000',
    observedValueKind: 'ENV_FALLBACK' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: null,
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'storyGenerationStatusAdmission',
    runtimeConsumer: 'personalized generation admission check before any transport',
    actualSource: 'stories.generation_status row value (mutable DB state)',
    currentEffectiveValue: null,
    observedNonAuthoritativeValue: null,
    observedValueKind: 'NONE' as const,
    sourceIsImmutable: false,
    alreadyFrozenElsewhere: 'fail-closed semantics on needs_review are proven in code, not the row value',
    authorityState: 'MUTABLE_RUNTIME_STATE' as const,
  }),
  Object.freeze({
    field: 'writerSdkMaxRetries',
    runtimeConsumer: 'gateway writer transport',
    actualSource: 'fixtures/m10-g/g1-route-authority.ts routes.writer.maxRetries',
    currentEffectiveValue: '0',
    observedNonAuthoritativeValue: null,
    observedValueKind: 'FROZEN_LITERAL' as const,
    sourceIsImmutable: true,
    alreadyFrozenElsewhere: 'M10_G_G1_ROUTE_AUTHORITY',
    authorityState: 'FROZEN_IMMUTABLE_AUTHORITY' as const,
  }),
  Object.freeze({
    field: 'writerLengthRepairV1Enabled',
    runtimeConsumer: 'executeM10GG1PersonalizedChapter options',
    actualSource: 'lib/runtime/personalized-generation.ts bound M10-G executor literal',
    currentEffectiveValue: 'false',
    observedNonAuthoritativeValue: null,
    observedValueKind: 'FROZEN_LITERAL' as const,
    sourceIsImmutable: true,
    alreadyFrozenElsewhere: 'M10G_G1 executor option override (environment cannot re-enable it)',
    authorityState: 'FROZEN_IMMUTABLE_AUTHORITY' as const,
  }),
  Object.freeze({
    field: 'maximumChapterAttempts',
    runtimeConsumer: 'G-1 runner retry policy',
    actualSource: 'lib/narrative-qa/harness/m10-g-g1.server.ts M10G_G1_MAX_ATTEMPTS_PER_CHAPTER',
    currentEffectiveValue: '3',
    observedNonAuthoritativeValue: null,
    observedValueKind: 'FROZEN_LITERAL' as const,
    sourceIsImmutable: true,
    alreadyFrozenElsewhere: 'M10G_G1 runner stop/retry contract',
    authorityState: 'FROZEN_IMMUTABLE_AUTHORITY' as const,
  }),
  Object.freeze({
    field: 'retryableStopReasons',
    runtimeConsumer: 'G-1 runner retry classification',
    actualSource: 'lib/narrative-qa/harness/m10-g-g1.server.ts M10G_G1_RETRYABLE_REASONS',
    currentEffectiveValue: 'frozen list of five reasons',
    observedNonAuthoritativeValue: null,
    observedValueKind: 'FROZEN_LITERAL' as const,
    sourceIsImmutable: true,
    alreadyFrozenElsewhere: 'M10G_G1 runner stop/retry contract',
    authorityState: 'FROZEN_IMMUTABLE_AUTHORITY' as const,
  }),
  Object.freeze({
    field: 'providerSelectionConstraint',
    runtimeConsumer: 'executeM10GG1PersonalizedChapter selectProvider injection',
    actualSource: 'resolveM10GG1FrozenRoutes over M10_G_G1_ROUTE_AUTHORITY',
    currentEffectiveValue: 'exact frozen routes; zero mutable ai_model_routes reads',
    observedNonAuthoritativeValue: null,
    observedValueKind: 'FROZEN_LITERAL' as const,
    sourceIsImmutable: true,
    alreadyFrozenElsewhere: 'M10_G_G1_ROUTE_AUTHORITY',
    authorityState: 'FROZEN_IMMUTABLE_AUTHORITY' as const,
  }),
])

const FAIL_CLOSED_GUARDS: readonly string[] = Object.freeze([
  'resolveM10GG1FrozenGenerationPolicy throws M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND',
  'resolveM10GG1FrozenLeaseTtlSeconds throws M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND',
  'generateNextPersonalizedChapter rejects m10gMode without frozen lease TTL before slot admission',
  'withGenerationSlot skips refreshGenerationConcurrencyFromPolicy when m10gMode is set',
])

const REQUIRED_ADDITIONAL_AUTHORITY: readonly string[] = Object.freeze([
  'An immutable, PM-ratified record of the effective production generation_policy row (target words min/max, target scenes, lease TTL, concurrency caps, queue cap) with capture provenance and a canonical hash.',
  'An immutable record of the effective queue wait milliseconds and any environment pins active on the G-1 execution host.',
  'A binding rule that the recorded values fail the run before admission and before any network call when the live process disagrees with the frozen snapshot.',
])

export function evaluateM10GG1GenerationPolicyAuthority(): M10GG1GenerationPolicyDecision {
  const unboundFields = Object.freeze(FIELDS
    .filter((item) => item.authorityState === 'MUTABLE_RUNTIME_STATE')
    .map((item) => item.field))
  const frozenFields = Object.freeze(FIELDS
    .filter((item) => item.authorityState === 'FROZEN_IMMUTABLE_AUTHORITY')
    .map((item) => item.field))

  return Object.freeze({
    decisionId: M10G_G1_GENERATION_POLICY_DECISION_ID,
    status: 'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE' as const,
    dbAccessPerformed: false as const,
    inferencePerformed: false as const,
    policySnapshotEmitted: false as const,
    policySnapshotHash: null,
    fields: FIELDS,
    unboundFields,
    frozenFields,
    failClosedGuards: FAIL_CLOSED_GUARDS,
    reason: 'Effective generation policy is authoritative only in the mutable generation_policy row and process environment. Repository defaults, migration seeds, and test literals describe fallbacks, not the current production values, so no policy snapshot or hash may be frozen offline.',
    requiredAdditionalAuthority: REQUIRED_ADDITIONAL_AUTHORITY,
  })
}
