import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface EndingRunwayInputV1 {
  endingLock?: { chapterNumber: number; lockedEndingKey: string; isDurable: boolean }
  chapter50Publication?: { choicePrompt: string | null; choices: unknown[] | null }
  lockedEndingKeyMatch?: boolean
}

export function evaluateEndingRunway(envelope: EvaluatorEnvelopeV1<EndingRunwayInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input } = envelope
  const findings: LongHorizonFindingV1[] = []

  const lock = input.endingLock
  if (!lock || lock.chapterNumber !== 45 || !lock.isDurable) {
    findings.push({
      schemaVersion: 1,
      code: 'ENDING_LOCK_NOT_DURABLE',
      severity: 'HIGH',
      domain: 'Ending',
      storyId,
      chapterNumber: 45,
      evidence: [
        {
          kind: 'checkpoint',
          ref: `ending_lock:ch:45`,
          detail: { lockPresent: !!lock, lockChapter: lock?.chapterNumber, isDurable: lock?.isDurable },
        },
      ],
      message: `Ending lock at chapter 45 is missing or not durable.`,
      remediationClass: 'runtime',
    })
  }

  const ch50 = input.chapter50Publication
  if (ch50) {
    if (ch50.choicePrompt !== null || (ch50.choices !== null && ch50.choices.length > 0)) {
      findings.push({
        schemaVersion: 1,
        code: 'CHAPTER_50_CHOICES_NOT_NULL',
        severity: 'HIGH',
        domain: 'Ending',
        storyId,
        chapterNumber: 50,
        evidence: [
          {
            kind: 'chapter',
            ref: `chapter:50`,
            detail: { choicePrompt: ch50.choicePrompt, choicesCount: ch50.choices?.length ?? 0 },
          },
        ],
        message: `Chapter 50 published non-null choices or choice prompt.`,
        remediationClass: 'runtime',
      })
    }
  }

  if (input.lockedEndingKeyMatch === false) {
    findings.push({
      schemaVersion: 1,
      code: 'LOCKED_ENDING_KEY_MISMATCH',
      severity: 'BLOCKER',
      domain: 'Ending',
      storyId,
      chapterNumber: 50,
      evidence: [
        {
          kind: 'chapter',
          ref: `chapter:50:ending_key`,
          detail: { lockedEndingKeyMatch: false },
        },
      ],
      message: `Chapter 50 published with ending key that mismatches locked ending provenance from chapter 45.`,
      remediationClass: 'runtime',
    })
  }

  return findings
}
