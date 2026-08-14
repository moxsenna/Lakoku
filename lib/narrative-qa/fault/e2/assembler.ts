import { E2_SCENARIO_IDS } from './catalog'
import { E2_FIXED_SEED } from './gate'
import type { E2Evidence, E2EvidenceRow, E2ScenarioId } from './taxonomy'

export interface E2ProducerResult {
  rows: E2EvidenceRow[]
  safetyCounters?: E2Evidence['safetyCounters']
  resetProof?: E2Evidence['resetProof']
}

export function assembleE2Rows(producers: readonly E2ProducerResult[]): E2EvidenceRow[] {
  const byId = new Map<E2ScenarioId, E2EvidenceRow>()
  for (const producer of producers) {
    const localIds = new Set<E2ScenarioId>()
    for (const row of producer.rows) {
      if (!E2_SCENARIO_IDS.includes(row.id)) throw new Error(`E2_ASSEMBLER_UNKNOWN_ID:${row.id}`)
      if (localIds.has(row.id)) throw new Error(`E2_ASSEMBLER_DUPLICATE_ID:${row.id}`)
      if (byId.has(row.id)) throw new Error(`E2_ASSEMBLER_OVERLAP_ID:${row.id}`)
      localIds.add(row.id)
      byId.set(row.id, row)
    }
  }
  const missing = E2_SCENARIO_IDS.filter((id) => !byId.has(id))
  if (missing.length > 0) throw new Error(`E2_ASSEMBLER_MISSING_IDS:${missing.join(',')}`)
  return E2_SCENARIO_IDS.map((id) => {
    const row = byId.get(id)
    if (!row) throw new Error(`E2_ASSEMBLER_MISSING_ID:${id}`)
    return row
  })
}

export function assembleE2Evidence(input: {
  baseGitSha: string
  workingTreeDirty: boolean
  producers: readonly E2ProducerResult[]
  e1Regression: E2Evidence['e1Regression']
  runMetadata?: E2Evidence['runMetadata']
}): E2Evidence {
  const counterProducers = input.producers.filter((producer) => producer.safetyCounters !== undefined)
  if (counterProducers.length !== 1) throw new Error(`E2_ASSEMBLER_SAFETY_PRODUCER_COUNT:${counterProducers.length}`)
  const resetProducers = input.producers.filter((producer) => producer.resetProof !== undefined)
  if (resetProducers.length === 0) throw new Error('E2_ASSEMBLER_RESET_PRODUCER_COUNT:0')
  const safetyCounters = counterProducers[0].safetyCounters
  if (!safetyCounters) throw new Error('E2_ASSEMBLER_SAFETY_MISSING')
  const resetTargets = resetProducers.flatMap((producer) => producer.resetProof?.targets ?? [])
  const resetTargetNames = new Set(resetTargets.map((target) => target.target))
  if (resetTargetNames.size !== resetTargets.length) throw new Error('E2_ASSEMBLER_DUPLICATE_RESET_TARGET')
  const resetProof = {
    completed: resetProducers.length >= 2
      && resetProducers.every((producer) => producer.resetProof?.completed === true)
      && resetTargets.length >= 2,
    targets: resetTargets,
  }
  return {
    version: 'm10-e2-fault-evidence/v1',
    baseGitSha: input.baseGitSha,
    workingTreeDirty: input.workingTreeDirty,
    seed: E2_FIXED_SEED,
    faultSchedule: [...E2_SCENARIO_IDS],
    rows: assembleE2Rows(input.producers),
    safetyCounters: { ...safetyCounters },
    resetProof,
    e1Regression: { ...input.e1Regression },
    ...(input.runMetadata ? { runMetadata: input.runMetadata } : {}),
  }
}
