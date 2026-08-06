/**
 * B.3.1 — Canon drift / state evolution evaluator.
 *
 * Works only from canonical snapshots + commit ledgers. Never from prose.
 * All inputs are raw canonical evidence; the evaluator derives every
 * conclusion itself (no caller-precomputed verdict booleans).
 */

import type { CharacterStatus } from '../../narrative/types'
import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const CANON_DRIFT_EVALUATOR_ID = 'canon-drift'
export const CANON_DRIFT_EVALUATOR_VERSION = '1.1.0'

export interface CanonSnapshotHeader {
  storyId: string
  revision: number
  lastCommittedChapter: number
  updatedAt: string
}

/** One row of the canonical commit ledger (published chapter state delta). */
export interface CommitLedgerEntry {
  chapterNumber: number
  revision: number
  committedDeltaHash: string
  publishedAt: string
}

/** A published chapter row, independent of the commit ledger. */
export interface PublishedChapterEntry {
  chapterNumber: number
  livingCanonVersion: 0 | 1
}

/** Canonical character state as of the evaluated chapter. */
export interface CanonCharacterState {
  characterId: string
  status: CharacterStatus
  statusChangedChapter: number
}

/** Raw per-chapter status transition emitted by the committed delta sequence. */
export interface CharacterStatusTransition {
  characterId: string
  chapterNumber: number
  fromStatus: CharacterStatus
  toStatus: CharacterStatus
}

/** Raw secret reveal evidence: gate chapter vs the chapter it was revealed in. */
export interface SecretRevealEntry {
  secretId: string
  revealedChapter: number
  gateChapter: number
}

export interface CanonDriftInputV1 {
  canonicalSnapshot: CanonSnapshotHeader
  commitLedgers: CommitLedgerEntry[]
  publishedChapters: PublishedChapterEntry[]
  characterStates: CanonCharacterState[]
  characterStatusTransitions: CharacterStatusTransition[]
  secretReveals: SecretRevealEntry[]
}

export const extractCanonDriftChapters: TemporalExtractor<CanonDriftInputV1> = (input) => {
  const refs: ChapterRef[] = [
    ...observed(
      'canonicalSnapshot.lastCommittedChapter',
      input.canonicalSnapshot.lastCommittedChapter,
    ),
  ]
  input.commitLedgers.forEach((entry, i) => {
    refs.push(...observed(`commitLedgers[${i}].chapterNumber`, entry.chapterNumber))
  })
  input.publishedChapters.forEach((entry, i) => {
    refs.push(...observed(`publishedChapters[${i}].chapterNumber`, entry.chapterNumber))
  })
  input.characterStates.forEach((entry, i) => {
    refs.push(...observed(`characterStates[${i}].statusChangedChapter`, entry.statusChangedChapter))
  })
  input.characterStatusTransitions.forEach((entry, i) => {
    refs.push(...observed(`characterStatusTransitions[${i}].chapterNumber`, entry.chapterNumber))
  })
  input.secretReveals.forEach((entry, i) => {
    refs.push(...observed(`secretReveals[${i}].revealedChapter`, entry.revealedChapter))
    refs.push(...observed(`secretReveals[${i}].gateChapter`, entry.gateChapter))
  })
  return refs
}

export function evaluateCanonDrift(
  envelope: EvaluatorEnvelopeV1<CanonDriftInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractCanonDriftChapters)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []
  const targetChapter = evaluatedChapter ?? input.canonicalSnapshot.lastCommittedChapter

  const sorted = [...input.commitLedgers].sort((a, b) => a.chapterNumber - b.chapterNumber)

  // ── published-vs-committed reconciliation (living-canon v1 only) ──────────
  const committedChapters = new Set(sorted.map((entry) => entry.chapterNumber))
  const publishedSorted = [...input.publishedChapters].sort(
    (a, b) => a.chapterNumber - b.chapterNumber,
  )
  for (const published of publishedSorted) {
    if (published.livingCanonVersion === 1 && !committedChapters.has(published.chapterNumber)) {
      findings.push({
        schemaVersion: 1,
        code: 'CANON_WRITEBACK_MISSING',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: published.chapterNumber,
        evidence: [
          {
            kind: 'canon',
            ref: `story:${storyId}:ch:${published.chapterNumber}`,
            detail: {
              publishedChapter: published.chapterNumber,
              livingCanonVersion: published.livingCanonVersion,
              committedChapters: [...committedChapters].sort((a, b) => a - b),
            },
          },
        ],
        message: `Chapter ${published.chapterNumber} published on living-canon v1 without a matching canonical commit.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── commit present without a matching publication ────────────────────────
  const publishedChapterNumbers = new Set(input.publishedChapters.map((e) => e.chapterNumber))
  for (const entry of sorted) {
    if (!publishedChapterNumbers.has(entry.chapterNumber)) {
      findings.push({
        schemaVersion: 1,
        code: 'STATE_DELTA_WITHOUT_CHAPTER_PUBLICATION',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: entry.chapterNumber,
        evidence: [
          {
            kind: 'commit',
            ref: `commit:ch:${entry.chapterNumber}`,
            detail: { committedDeltaHash: entry.committedDeltaHash, revision: entry.revision },
          },
        ],
        message: `State delta committed for chapter ${entry.chapterNumber} without a matching chapter publication.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── duplicate commit for the same chapter ────────────────────────────────
  const perChapter = new Map<number, CommitLedgerEntry[]>()
  for (const entry of sorted) {
    perChapter.set(entry.chapterNumber, [...(perChapter.get(entry.chapterNumber) ?? []), entry])
  }
  const perChapterSorted = [...perChapter.entries()].sort((a, b) => a[0] - b[0])
  for (const [chapterNumber, entries] of perChapterSorted) {
    if (entries.length > 1) {
      findings.push({
        schemaVersion: 1,
        code: 'CHAPTER_COMMIT_DUPLICATE',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber,
        evidence: [
          {
            kind: 'commit',
            ref: `commit:ch:${chapterNumber}`,
            detail: {
              commitCount: entries.length,
              revisions: entries.map((entry) => entry.revision),
              deltaHashes: entries.map((entry) => entry.committedDeltaHash),
            },
          },
        ],
        message: `Chapter ${chapterNumber} has ${entries.length} canonical commits (expected exactly 1).`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── contiguous chapter commit sequence ───────────────────────────────────
  const distinctChapters = [...perChapter.keys()].sort((a, b) => a - b)
  for (let i = 1; i < distinctChapters.length; i += 1) {
    const previous = distinctChapters[i - 1]
    const current = distinctChapters[i]
    if (current !== previous + 1) {
      findings.push({
        schemaVersion: 1,
        code: 'CHAPTER_COMMIT_MISSING',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: current,
        evidence: [
          {
            kind: 'commit',
            ref: `commit:gap:${previous}->${current}`,
            detail: { previousCommittedChapter: previous, nextCommittedChapter: current },
          },
        ],
        message: `Chapter commit gap between chapter ${previous} and chapter ${current}.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── monotonic +1 revision sequence ───────────────────────────────────────
  let expectedRevision = 0
  for (const entry of sorted) {
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

  // ── snapshot freshness after the last successful publication ─────────────
  const lastCommit = sorted[sorted.length - 1]
  if (lastCommit) {
    if (input.canonicalSnapshot.revision !== lastCommit.revision) {
      findings.push({
        schemaVersion: 1,
        code: 'CANON_SNAPSHOT_STALE',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: lastCommit.chapterNumber,
        evidence: [
          {
            kind: 'canon',
            ref: `snapshot:${storyId}`,
            detail: {
              snapshotRevision: input.canonicalSnapshot.revision,
              lastCommittedRevision: lastCommit.revision,
            },
          },
        ],
        message: `Canonical snapshot revision ${input.canonicalSnapshot.revision} is stale versus last committed revision ${lastCommit.revision}.`,
        remediationClass: 'runtime',
      })
    }
    if (input.canonicalSnapshot.lastCommittedChapter !== lastCommit.chapterNumber) {
      findings.push({
        schemaVersion: 1,
        code: 'CANON_SNAPSHOT_STALE',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: lastCommit.chapterNumber,
        evidence: [
          {
            kind: 'canon',
            ref: `snapshot:${storyId}:chapter`,
            detail: {
              snapshotLastCommittedChapter: input.canonicalSnapshot.lastCommittedChapter,
              ledgerLastCommittedChapter: lastCommit.chapterNumber,
            },
          },
        ],
        message: `Canonical snapshot lastCommittedChapter ${input.canonicalSnapshot.lastCommittedChapter} disagrees with commit ledger ${lastCommit.chapterNumber}.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── canonical character state vs committed transition sequence ───────────
  const projected = new Map<string, { status: CharacterStatus; chapter: number }>()
  const transitions = [...input.characterStatusTransitions].sort(
    (a, b) => a.chapterNumber - b.chapterNumber || a.characterId.localeCompare(b.characterId),
  )
  for (const transition of transitions) {
    // DEAD is terminal in Lakoku canon (CharacterStatus has no revival path).
    const current = projected.get(transition.characterId)?.status ?? transition.fromStatus
    if (current === 'DEAD' && transition.toStatus !== 'DEAD') {
      findings.push({
        schemaVersion: 1,
        code: 'ILLEGAL_DEAD_RESURRECTION',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: transition.chapterNumber,
        evidence: [
          {
            kind: 'canon',
            ref: `character:${transition.characterId}`,
            detail: {
              characterId: transition.characterId,
              fromStatus: 'DEAD',
              toStatus: transition.toStatus,
              chapterNumber: transition.chapterNumber,
            },
          },
        ],
        message: `Illegal resurrection of DEAD character ${transition.characterId} to ${transition.toStatus} at chapter ${transition.chapterNumber}.`,
        remediationClass: 'runtime',
      })
    }
    projected.set(transition.characterId, {
      status: transition.toStatus,
      chapter: transition.chapterNumber,
    })
  }

  const statesSorted = [...input.characterStates].sort((a, b) =>
    a.characterId.localeCompare(b.characterId),
  )
  for (const state of statesSorted) {
    const derived = projected.get(state.characterId)
    if (!derived) continue
    if (derived.status !== state.status || derived.chapter !== state.statusChangedChapter) {
      findings.push({
        schemaVersion: 1,
        code: 'CANON_STATE_DELTA_SEQUENCE_MISMATCH',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: targetChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `character:${state.characterId}:state`,
            detail: {
              characterId: state.characterId,
              canonicalStatus: state.status,
              canonicalStatusChangedChapter: state.statusChangedChapter,
              derivedStatus: derived.status,
              derivedStatusChangedChapter: derived.chapter,
            },
          },
        ],
        message: `Canonical state for ${state.characterId} does not match the committed delta sequence.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── reveal gate bypass ───────────────────────────────────────────────────
  const revealsSorted = [...input.secretReveals].sort((a, b) => a.secretId.localeCompare(b.secretId))
  for (const reveal of revealsSorted) {
    if (reveal.revealedChapter < reveal.gateChapter) {
      findings.push({
        schemaVersion: 1,
        code: 'REVEAL_GATE_BYPASS',
        severity: 'BLOCKER',
        domain: 'Canon/Persistence',
        storyId,
        chapterNumber: reveal.revealedChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `secret:${reveal.secretId}`,
            detail: {
              secretId: reveal.secretId,
              revealedChapter: reveal.revealedChapter,
              gateChapter: reveal.gateChapter,
            },
          },
        ],
        message: `Secret ${reveal.secretId} revealed at chapter ${reveal.revealedChapter} before its gate chapter ${reveal.gateChapter}.`,
        remediationClass: 'runtime',
      })
    }
  }

  return findings
}
