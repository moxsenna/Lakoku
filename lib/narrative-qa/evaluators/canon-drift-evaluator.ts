import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface CanonSnapshotHeader {
  revision: number
  storyId: string
  lastCommittedChapter: number
  updatedAt: string
}

export interface CommitLedgerEntry {
  chapterNumber: number
  revision: number
  committedDeltaHash: string
  publishedAt: string
}

export interface CanonDriftInputV1 {
  canonicalSnapshot: CanonSnapshotHeader
  commitLedgers: CommitLedgerEntry[]
  characterStates?: Array<{ id: string; status: 'ALIVE' | 'DEAD' | 'INACTIVE' }>
  resurrectionAttempts?: string[]
}

export function evaluateCanonDrift(envelope: EvaluatorEnvelopeV1<CanonDriftInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  const targetChapter = evaluatedChapter ?? input.canonicalSnapshot.lastCommittedChapter

  if (targetChapter > 0 && input.commitLedgers.length === 0) {
    findings.push({
      schemaVersion: 1,
      code: 'CANON_WRITEBACK_MISSING',
      severity: 'BLOCKER',
      domain: 'Canon/Persistence',
      storyId,
      chapterNumber: targetChapter,
      evidence: [
        {
          kind: 'canon',
          ref: `story:${storyId}:ch:${targetChapter}`,
          detail: { snapshotRevision: input.canonicalSnapshot.revision, commitCount: 0 },
        },
      ],
      message: `Canonical snapshot at chapter ${targetChapter} has zero committed deltas in ledger.`,
      remediationClass: 'runtime',
    })
  }

  const sortedLedgers = [...input.commitLedgers].sort((a, b) => a.chapterNumber - b.chapterNumber)
  let expectedRevision = 0
  for (const entry of sortedLedgers) {
    if (entry.revision !== expectedRevision + 1) {
      findings.push({
        schemaVersion: 1,
        code: 'CANON_REVISION_DISCONTINUITY',
        severity: 'HIGH',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: entry.chapterNumber,
        evidence: [
          {
            kind: 'commit',
            ref: `commit:ch:${entry.chapterNumber}`,
            detail: { expectedRevision: expectedRevision + 1, actualRevision: entry.revision },
          },
        ],
        message: `Revision discontinuity at chapter ${entry.chapterNumber}: expected ${expectedRevision + 1}, got ${entry.revision}.`,
        remediationClass: 'runtime',
      })
    }
    expectedRevision = entry.revision
  }

  if (input.resurrectionAttempts && input.resurrectionAttempts.length > 0) {
    for (const charId of input.resurrectionAttempts) {
      findings.push({
        schemaVersion: 1,
        code: 'ILLEGAL_DEAD_RESURRECTION',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: targetChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `character:${charId}`,
            detail: { characterId: charId, status: 'DEAD' },
          },
        ],
        message: `Illegal attempt to resurrect DEAD character ${charId} at chapter ${targetChapter}.`,
        remediationClass: 'runtime',
      })
    }
  }

  return findings
}
