import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface BlueprintAuthorityInputV1 {
  snapshotBlueprints: Array<{ id: string; chapterNumber: number; version: number }>
  resolvedBlueprintVersion: number
  highestAvailableVersion: number
}

export function evaluateBlueprintAuthority(envelope: EvaluatorEnvelopeV1<BlueprintAuthorityInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  if (input.resolvedBlueprintVersion !== input.highestAvailableVersion) {
    findings.push({
      schemaVersion: 1,
      code: 'BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE',
      severity: 'HIGH',
      domain: 'Blueprint',
      storyId,
      chapterNumber: evaluatedChapter,
      evidence: [
        {
          kind: 'contract',
          ref: `blueprint:ch:${evaluatedChapter}`,
          detail: {
            resolvedVersion: input.resolvedBlueprintVersion,
            highestAvailableVersion: input.highestAvailableVersion,
          },
        },
      ],
      message: `Blueprint version resolution divergence at chapter ${evaluatedChapter}: resolved v${input.resolvedBlueprintVersion}, expected v${input.highestAvailableVersion}.`,
      remediationClass: 'dataflow',
    })
  }

  return findings
}
