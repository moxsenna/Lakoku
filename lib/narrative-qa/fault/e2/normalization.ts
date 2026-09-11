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
const GENERATED_ID_COLLECTIONS = new Set(['attempts', 'commits', 'events', 'outbox'])
const SNAPSHOT_OPERATIONAL_KEYS = new Set([
  'created_at',
  'updated_at',
  'expires_at',
  'available_at',
  'claimed_at',
  'deadline_at',
  'heartbeat_at',
  'completed_at',
  'started_at',
  'ended_at',
  'elapsed_ms',
])
type EvidencePath = Array<string | number>

function snapshotRowCollection(path: EvidencePath): string | null {
  const directObjectRow = path.length === 8 && typeof path[7] === 'string'
  const directArrayRow = path.length === 9
    && typeof path[7] === 'string'
    && typeof path[8] === 'number'
  if (!directObjectRow && !directArrayRow) return null
  if (path[0] !== 'rows'
    || typeof path[1] !== 'number'
    || path[2] !== 'proof'
    || (path[3] !== 'immediateInvariants' && path[3] !== 'recoveryInvariants')
    || typeof path[4] !== 'number'
    || path[5] !== 'detail'
    || (path[6] !== 'expected' && path[6] !== 'observed')) {
    return null
  }
  const collection = path[7]
  return typeof collection === 'string' ? collection : null
}

function normalizeValue(
  value: unknown,
  path: EvidencePath,
  correlationAliases: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeValue(entry, [...path, index], correlationAliases))
  }
  if (value === null || typeof value !== 'object') return value

  const snapshotCollection = snapshotRowCollection(path)
  const isSnapshotRow = snapshotCollection !== null
  const stripsGeneratedId = path.length === 9
    && snapshotCollection !== null
    && GENERATED_ID_COLLECTIONS.has(snapshotCollection)
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (OPERATIONAL_KEYS.test(key)
      || (isSnapshotRow && SNAPSHOT_OPERATIONAL_KEYS.has(key))
      || (stripsGeneratedId && key === 'id')) {
      continue
    }
    if (isSnapshotRow && key === 'correlation_id' && typeof child === 'string') {
      let alias = correlationAliases.get(child)
      if (!alias) {
        alias = `correlation-${correlationAliases.size + 1}`
        correlationAliases.set(child, alias)
      }
      normalized[key] = alias
      continue
    }
    normalized[key] = normalizeValue(child, [...path, key], correlationAliases)
  }
  return normalized
}

export function normalizeE2Evidence(evidence: E2Evidence): NormalizedE2Evidence {
  const correlationAliases = new Map<string, string>()
  return {
    version: evidence.version,
    baseGitSha: evidence.baseGitSha,
    seed: evidence.seed,
    faultSchedule: [...evidence.faultSchedule],
    rows: evidence.rows.map((row, rowIndex) => ({
      id: row.id,
      proof: normalizeValue(row.proof, ['rows', rowIndex, 'proof'], correlationAliases),
    })),
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
