import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface FactConflictInputV1 {
  existingEntityFacts: Array<{ entityId: string; status: 'ALIVE' | 'DEAD' | 'INACTIVE' }>
  proposedFactDeltas: Array<{ entityId: string; status: 'ALIVE' | 'DEAD' | 'INACTIVE' }>
}

export function evaluateFactConflict(envelope: EvaluatorEnvelopeV1<FactConflictInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  const currentCh = evaluatedChapter ?? 50
  const existingMap = new Map(input.existingEntityFacts.map((f) => [f.entityId, f.status]))

  for (const proposed of input.proposedFactDeltas) {
    const currentStatus = existingMap.get(proposed.entityId)
    if (currentStatus === 'DEAD' && proposed.status === 'ALIVE') {
      findings.push({
        schemaVersion: 1,
        code: 'ENTITY_FACT_CONFLICT',
        severity: 'BLOCKER',
        domain: 'Fact Safety',
        storyId,
        chapterNumber: currentCh,
        evidence: [
          {
            kind: 'canon',
            ref: `entity:${proposed.entityId}`,
            detail: { entityId: proposed.entityId, existingStatus: 'DEAD', proposedStatus: 'ALIVE' },
          },
        ],
        message: `Entity fact conflict at chapter ${currentCh}: cannot transition entity ${proposed.entityId} from DEAD to ALIVE.`,
        remediationClass: 'runtime',
      })
    }
  }

  return findings
}
