import { computeSha256, stableStringify } from '../../scoring/canonical-serializer'
import type { E2Evidence } from './taxonomy'

export interface NormalizedE2Evidence {
  version: E2Evidence['version']
  baseGitSha: string
  seed: string
  faultSchedule: E2Evidence['faultSchedule']
  rows: Array<{ id: E2Evidence['rows'][number]['id']; proof: unknown }>
  safetyCounters: E2Evidence['safetyCounters']
  resetProof: E2Evidence['resetProof']
  e1Regression: E2Evidence['e1Regression']
}

const OPERATIONAL_KEYS = /^(workingTreeDirty|runMetadata|operational|startedAt|finishedAt|observedAt|attemptIds|rawAttemptIds|latenciesMs)$/i
const OPERATIONAL_ID_KEYS = /^(job|lease|attempt|claim|checkpoint|correlation|database|row)(Id|Ids)$/i
const OPERATIONAL_TIME_KEYS = /(timestamp|latency|elapsed|duration)(s|Ms)?$/i

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value === null || typeof value !== 'object') return value
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (OPERATIONAL_KEYS.test(key) || OPERATIONAL_ID_KEYS.test(key) || OPERATIONAL_TIME_KEYS.test(key)) continue
    normalized[key] = normalizeValue(child)
  }
  return normalized
}

export function normalizeE2Evidence(evidence: E2Evidence): NormalizedE2Evidence {
  return {
    version: evidence.version,
    baseGitSha: evidence.baseGitSha,
    seed: evidence.seed,
    faultSchedule: [...evidence.faultSchedule],
    rows: evidence.rows.map((row) => ({ id: row.id, proof: normalizeValue(row.proof) })),
    safetyCounters: { ...evidence.safetyCounters },
    resetProof: {
      completed: evidence.resetProof.completed,
      targets: evidence.resetProof.targets.map((target) => ({ ...target })),
    },
    e1Regression: { ...evidence.e1Regression },
  }
}

export function hashNormalizedE2Evidence(evidence: E2Evidence): string {
  return computeSha256(stableStringify(normalizeE2Evidence(evidence)))
}
