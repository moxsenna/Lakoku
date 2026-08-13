import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

export const E1_EXECUTABLE_SCENARIO_IDS = [
  'P1_TIMEOUT_BEFORE_FIRST_BYTE',
  'P2_TIMEOUT_AFTER_PARTIAL',
  'P3_RETRYABLE_429',
  'P4_NON_RETRYABLE',
  'P5_MALFORMED_PROSE',
  'P6_ALL_CANDIDATES_EXHAUSTED',
  'P7_REPAIRABLE_DEFECT_ONCE',
  'P8_PERSISTENT_DEFECT_BOUNDED',
  'W1_CRASH_AFTER_PROSE_CHECKPOINT',
  'W3_STALE_WORKER_OWNERSHIP_LOST',
  'PB1_DB_TRANSIENT_BEFORE_PUBLICATION',
  'PB2_CHAPTER_INSERT_CONFLICT_ROLLBACK',
  'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH',
] as const

export type E1ScenarioId = (typeof E1_EXECUTABLE_SCENARIO_IDS)[number]
export type E1Disposition = 'PUBLISHED' | 'FAILED_CLOSED' | 'OWNERSHIP_LOST'

export interface E1InvariantResult {
  code: string
  passed: boolean
  detail: Record<string, unknown>
}

export interface E1ScenarioEvidence {
  id: E1ScenarioId
  injectedBoundary: string
  injectionReached: boolean
  expectedDisposition: E1Disposition
  observedDisposition: E1Disposition
  recoveryExpected: boolean
  recovered: boolean
  harnessRecoveryInvocations: number
  runtimeProviderAttempts?: {
    writeAttempts: number
    productionCeiling: number
  }
  checkpointRecovery?: {
    afterFaultStatus: string | null
    recoveryFromCheckpoint: boolean
    faultProseGenerationCalls: number
    recoveryProseGenerationCalls: number
  }
  invariantChecks: {
    afterFault: E1InvariantResult[]
    afterRecovery: E1InvariantResult[] | null
  }
}

export interface E1CoverageMetadata {
  id: string
  disposition: 'REPLACED_REFERENCE' | 'N/A_CURRENT_RUNTIME' | 'MISSING' | 'NOT_EXECUTED_E1' | 'N/A'
  reason: string
}

export interface E1Evidence {
  version: 'm10-e1-fault-evidence/v1'
  baseGitSha: string
  workingTreeDirty: boolean
  seed: string
  faultSchedule: E1ScenarioId[]
  scenarios: E1ScenarioEvidence[]
  historicalReferences: E1CoverageMetadata[]
  e2Gaps: E1CoverageMetadata[]
  duplicatePublicationCount: number
  canonicalCorruptionCount: number
  unboundedRetryCount: number
  runMetadata?: {
    startedAt: string
    finishedAt: string
    rawAttemptIds: string[]
    latenciesMs: number[]
  }
}

export interface E1GateResult {
  result: 'PASS' | 'FAIL'
  failures: string[]
}

export function evaluateE1Gate(evidence: E1Evidence): E1GateResult {
  const failures: string[] = []
  const expectedIds = new Set<string>(E1_EXECUTABLE_SCENARIO_IDS)

  if (evidence.scenarios.length !== E1_EXECUTABLE_SCENARIO_IDS.length) {
    failures.push(`executable scenario count must be ${E1_EXECUTABLE_SCENARIO_IDS.length}, observed ${evidence.scenarios.length}`)
  }
  for (const id of E1_EXECUTABLE_SCENARIO_IDS) {
    const count = evidence.scenarios.filter((scenario) => scenario.id === id).length
    if (count === 0) failures.push(`${id}: executable scenario missing`)
    if (count > 1) failures.push(`${id}: executable scenario duplicated ${count} times`)
  }
  const observedScenarioOrder = evidence.scenarios.map((scenario) => scenario.id)
  if (stableStringify(observedScenarioOrder) !== stableStringify(E1_EXECUTABLE_SCENARIO_IDS)) {
    failures.push('scenario order does not match executable E1 catalog')
  }
  if (stableStringify(evidence.faultSchedule) !== stableStringify(E1_EXECUTABLE_SCENARIO_IDS)) {
    failures.push('fault schedule does not exactly match executable E1 catalog')
  }
  for (const scenario of evidence.scenarios) {
    if (!expectedIds.has(scenario.id)) failures.push(`${scenario.id}: not an executable E1 scenario`)
    if (!scenario.injectionReached) failures.push(`${scenario.id}: injected seam not reached`)
    if (scenario.expectedDisposition !== scenario.observedDisposition) {
      failures.push(`${scenario.id}: expected ${scenario.expectedDisposition}, observed ${scenario.observedDisposition}`)
    }
    if (scenario.recoveryExpected && !scenario.recovered) failures.push(`${scenario.id}: expected recovery did not complete`)
    if (scenario.recoveryExpected && scenario.invariantChecks.afterRecovery === null) {
      failures.push(`${scenario.id}: recovery invariant check missing`)
    }
    if (scenario.id === 'P8_PERSISTENT_DEFECT_BOUNDED') {
      if (!scenario.runtimeProviderAttempts) {
        failures.push(`${scenario.id}: runtime provider attempt proof missing`)
      } else if (scenario.runtimeProviderAttempts.writeAttempts !== scenario.runtimeProviderAttempts.productionCeiling) {
        failures.push(
          `${scenario.id}: expected runtime provider attempts to exhaust at production ceiling ${scenario.runtimeProviderAttempts.productionCeiling}, observed ${scenario.runtimeProviderAttempts.writeAttempts}`,
        )
      }
    }
    if (scenario.id === 'W1_CRASH_AFTER_PROSE_CHECKPOINT') {
      if (!scenario.checkpointRecovery) {
        failures.push(`${scenario.id}: checkpoint recovery proof missing`)
      } else {
        if (scenario.checkpointRecovery.afterFaultStatus !== 'PROSE_READY') {
          failures.push(`${scenario.id}: expected PROSE_READY checkpoint after fault`)
        }
        if (!scenario.checkpointRecovery.recoveryFromCheckpoint) {
          failures.push(`${scenario.id}: recovery did not report fromCheckpoint`)
        }
        if (scenario.checkpointRecovery.recoveryProseGenerationCalls !== 0) {
          failures.push(`${scenario.id}: recovery generated prose again`)
        }
      }
    }
    for (const [phase, checks] of [
      ['fault', scenario.invariantChecks.afterFault],
      ['recovery', scenario.invariantChecks.afterRecovery ?? []],
    ] as const) {
      for (const invariant of checks) {
        if (!invariant.passed) failures.push(`${scenario.id}: invariant ${invariant.code} failed after ${phase}`)
      }
    }
  }
  const pb4References = evidence.historicalReferences.filter((reference) =>
    reference.id === 'PB4_SYNC_VS_WORKER_RACE'
    && reference.disposition === 'N/A_CURRENT_RUNTIME')
  if (pb4References.length !== 1) {
    failures.push(`PB4_SYNC_VS_WORKER_RACE: expected exactly one N/A_CURRENT_RUNTIME metadata reference, observed ${pb4References.length}`)
  }
  if (evidence.duplicatePublicationCount !== 0) {
    failures.push(`duplicate publication count must be 0, observed ${evidence.duplicatePublicationCount}`)
  }
  if (evidence.canonicalCorruptionCount !== 0) {
    failures.push(`canonical corruption count must be 0, observed ${evidence.canonicalCorruptionCount}`)
  }
  if (evidence.unboundedRetryCount !== 0) {
    failures.push(`unbounded retry count must be 0, observed ${evidence.unboundedRetryCount}`)
  }

  return { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }
}

function normalizeDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDetail)
  if (!value || typeof value !== 'object') return value
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    if (/^(observedId|rawAttemptIds|latenciesMs|startedAt|finishedAt)$/i.test(key)
      || /(job|lease|attempt|claim|checkpoint|correlation|database|row)(Id|Ids)$/i.test(key)
      || /(timestamp|latency|elapsed|duration)(s|Ms)?$/i.test(key)) continue
    normalized[key] = normalizeDetail(child)
  }
  return normalized
}

export function normalizeE1Evidence(
  evidence: E1Evidence,
): Omit<E1Evidence, 'runMetadata' | 'workingTreeDirty'> {
  return normalizeDetail({
    version: evidence.version,
    baseGitSha: evidence.baseGitSha,
    seed: evidence.seed,
    faultSchedule: evidence.faultSchedule,
    scenarios: evidence.scenarios,
    historicalReferences: evidence.historicalReferences,
    e2Gaps: evidence.e2Gaps,
    duplicatePublicationCount: evidence.duplicatePublicationCount,
    canonicalCorruptionCount: evidence.canonicalCorruptionCount,
    unboundedRetryCount: evidence.unboundedRetryCount,
  }) as Omit<E1Evidence, 'runMetadata' | 'workingTreeDirty'>
}

export function hashNormalizedE1Evidence(evidence: E1Evidence): string {
  return computeSha256(stableStringify(normalizeE1Evidence(evidence)))
}
