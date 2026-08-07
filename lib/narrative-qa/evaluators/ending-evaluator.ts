/**
 * B.3.7 — Ending-runway evaluator (FINAL_HORIZON).
 *
 * Deterministic inspection of the closure runway. The ending-key match is
 * derived here from raw lock provenance vs raw publication, never handed in
 * as a precomputed boolean.
 */

import type { ThreadStatus } from '../../narrative/types'
import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const ENDING_EVALUATOR_ID = 'ending-runway'
/**
 * 1.1.0 → 1.2.0 (C-R1 #4, reviewer 2026-08-08): durability evidence no longer
 * requires a publication transaction id. The V3/V5 publishers write lock +
 * chapter + canon commit inside one SQL function/transaction but expose no
 * tx-id readback; demanding one made ENDING_LOCK_NOT_DURABLE unfalsifiable.
 * v1.2.0 derives durability from the canonical publication PROOF instead:
 * lock at the correct chapter ∧ chapter published ∧ canon commit ledger row —
 * the three artifacts of the single atomic commit. Same-transaction atomicity
 * is proven by code inspection of the publisher SQL plus the harness
 * fencing/tamper probes (no torn state producible).
 */
export const ENDING_EVALUATOR_VERSION = '1.2.0'

export const ENDING_LOCK_CHAPTER = 45
export const MAIN_MYSTERY_CLOSURE_CHAPTER = 48
export const EMOTIONAL_RESOLUTION_CHAPTER = 49
export const FINAL_CHAPTER = 50

/** Raw `ending_locks` row. */
export interface EndingLockEvidence {
  chapterNumber: number
  lockedEndingKey: string
  /**
   * Canonical publication proof that the lock committed atomically with its
   * chapter (C-R1 #4). Same-transaction atomicity is proven by the publisher
   * SQL + fencing/tamper probes; these fields are the DB-readback artifacts.
   */
  canonicalPublicationProof: {
    lockAtCorrectChapter: boolean
    chapterCommittedRevision: number | null
    chapterPublished: boolean
  } | null
}

/** Raw published chapter row for a runway chapter. */
export interface RunwayChapterPublication {
  chapterNumber: number
  choicePrompt: string | null
  choiceCount: number
  endingKey: string | null
  /** New major conflicts/threads introduced by this chapter. */
  newMajorThreadIds: string[]
  /** Emotional resolution beats the chapter committed to canon. */
  emotionalResolutionBeatIds: string[]
}

/** Terminal deterministic state at the end of the story. */
export interface FinalStateEvidence {
  openDebtIds: string[]
  unresolvedThreads: Array<{ threadId: string; status: ThreadStatus }>
}

export interface EndingRunwayInputV1 {
  endingLock: EndingLockEvidence | null
  publications: RunwayChapterPublication[]
  finalState: FinalStateEvidence
  /** Chapter from which new major conflicts are forbidden. */
  closureRunwayFromChapter: number
}

export const extractEndingChapters: TemporalExtractor<EndingRunwayInputV1> = (input) => {
  const refs: ChapterRef[] = []
  if (input.endingLock) {
    refs.push(...observed('endingLock.chapterNumber', input.endingLock.chapterNumber))
  }
  input.publications.forEach((publication, i) => {
    refs.push(...observed(`publications[${i}].chapterNumber`, publication.chapterNumber))
  })
  refs.push(...observed('closureRunwayFromChapter', input.closureRunwayFromChapter))
  return refs
}

export function evaluateEndingRunway(
  envelope: EvaluatorEnvelopeV1<EndingRunwayInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractEndingChapters)
  const { storyId, input } = envelope
  const findings: LongHorizonFindingV1[] = []

  const lock = input.endingLock
  const publications = [...input.publications].sort((a, b) => a.chapterNumber - b.chapterNumber)

  // ── ending lock durability + atomic provenance at Bab 45 ────────────────
  // C-R1 #4: durability is proven by the canonical publication artifacts
  // (lock at ch45 ∧ ch45 published ∧ ch45 canon commit), NOT a tx-id. The
  // publisher SQL commits lock+chapter+canon in one transaction; fencing and
  // tamper probes demonstrate no torn state is producible.
  const proof = lock?.canonicalPublicationProof ?? null
  const lockDurable =
    lock !== null &&
    lock.chapterNumber === ENDING_LOCK_CHAPTER &&
    proof !== null &&
    proof.lockAtCorrectChapter &&
    proof.chapterPublished &&
    proof.chapterCommittedRevision !== null
  if (!lockDurable) {
    findings.push({
      schemaVersion: 1,
      code: 'ENDING_LOCK_NOT_DURABLE',
      severity: 'HIGH',
      domain: 'Ending',
      storyId,
      chapterNumber: ENDING_LOCK_CHAPTER,
      evidence: [
        {
          kind: 'checkpoint',
          ref: `ending_lock:ch:${ENDING_LOCK_CHAPTER}`,
          detail: {
            lockPresent: lock !== null,
            lockChapter: lock?.chapterNumber ?? null,
            canonicalPublicationProof: proof,
          },
        },
      ],
      message: `Ending lock at chapter ${ENDING_LOCK_CHAPTER} is missing, misplaced, or not proven committed atomically with its publication.`,
      remediationClass: 'runtime',
    })
  }

  // ── no new major conflict/thread inside the closure runway ──────────────
  for (const publication of publications) {
    if (
      publication.chapterNumber >= input.closureRunwayFromChapter &&
      publication.newMajorThreadIds.length > 0
    ) {
      findings.push({
        schemaVersion: 1,
        code: 'NEW_MAJOR_CONFLICT_IN_CLOSURE_RUNWAY',
        severity: 'HIGH',
        domain: 'Ending',
        storyId,
        chapterNumber: publication.chapterNumber,
        evidence: [
          {
            kind: 'chapter',
            ref: `chapter:${publication.chapterNumber}:new_threads`,
            detail: {
              chapterNumber: publication.chapterNumber,
              newMajorThreadIds: [...publication.newMajorThreadIds].sort(),
              closureRunwayFromChapter: input.closureRunwayFromChapter,
            },
          },
        ],
        message: `Chapter ${publication.chapterNumber} introduced new major conflict(s) inside the closure runway (from chapter ${input.closureRunwayFromChapter}).`,
        remediationClass: 'policy',
      })
    }
  }

  // ── Bab 49 emotional resolution ─────────────────────────────────────────
  const chapter49 = publications.find((p) => p.chapterNumber === EMOTIONAL_RESOLUTION_CHAPTER)
  if (chapter49 && chapter49.emotionalResolutionBeatIds.length === 0) {
    findings.push({
      schemaVersion: 1,
      code: 'CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING',
      severity: 'HIGH',
      domain: 'Ending',
      storyId,
      chapterNumber: EMOTIONAL_RESOLUTION_CHAPTER,
      evidence: [
        {
          kind: 'chapter',
          ref: `chapter:${EMOTIONAL_RESOLUTION_CHAPTER}`,
          detail: { emotionalResolutionBeatCount: 0 },
        },
      ],
      message: `Chapter ${EMOTIONAL_RESOLUTION_CHAPTER} committed no emotional resolution beat.`,
      remediationClass: 'runtime',
    })
  }

  // ── Bab 50 must carry no reader choice ──────────────────────────────────
  const chapter50 = publications.find((p) => p.chapterNumber === FINAL_CHAPTER)
  if (chapter50 && (chapter50.choicePrompt !== null || chapter50.choiceCount > 0)) {
    findings.push({
      schemaVersion: 1,
      code: 'CHAPTER_50_CHOICES_NOT_NULL',
      severity: 'HIGH',
      domain: 'Ending',
      storyId,
      chapterNumber: FINAL_CHAPTER,
      evidence: [
        {
          kind: 'chapter',
          ref: `chapter:${FINAL_CHAPTER}`,
          detail: { choicePrompt: chapter50.choicePrompt, choiceCount: chapter50.choiceCount },
        },
      ],
      message: `Chapter ${FINAL_CHAPTER} published a reader choice prompt or choices.`,
      remediationClass: 'runtime',
    })
  }

  // ── ending key at final publication must match locked provenance ─────────
  if (chapter50) {
    const publishedKey = chapter50.endingKey
    const lockedKey = lock?.lockedEndingKey ?? null
    if (lockedKey !== null && publishedKey !== lockedKey) {
      findings.push({
        schemaVersion: 1,
        code: 'LOCKED_ENDING_KEY_MISMATCH',
        severity: 'BLOCKER',
        domain: 'Ending',
        storyId,
        chapterNumber: FINAL_CHAPTER,
        evidence: [
          {
            kind: 'chapter',
            ref: `chapter:${FINAL_CHAPTER}:ending_key`,
            detail: { publishedEndingKey: publishedKey, lockedEndingKey: lockedKey },
          },
        ],
        message: `Chapter ${FINAL_CHAPTER} published ending key '${publishedKey}' which does not match the locked ending '${lockedKey}'.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── Bab 50 must not leave deterministic unresolved state ────────────────
  if (chapter50) {
    if (input.finalState.openDebtIds.length > 0) {
      findings.push({
        schemaVersion: 1,
        code: 'ENDING_LEAVES_UNRESOLVED_DEBT',
        severity: 'BLOCKER',
        domain: 'Ending',
        storyId,
        chapterNumber: FINAL_CHAPTER,
        evidence: [
          {
            kind: 'commit',
            ref: `chapter:${FINAL_CHAPTER}:open_debt`,
            detail: { openDebtIds: [...input.finalState.openDebtIds].sort() },
          },
        ],
        message: `Chapter ${FINAL_CHAPTER} leaves ${input.finalState.openDebtIds.length} plot debt(s) open.`,
        remediationClass: 'runtime',
      })
    }

    const unresolved = input.finalState.unresolvedThreads
      .filter((thread) => thread.status !== 'RESOLVED' && thread.status !== 'ABANDONED_APPROVED')
      .sort((a, b) => a.threadId.localeCompare(b.threadId))
    if (unresolved.length > 0) {
      findings.push({
        schemaVersion: 1,
        code: 'ENDING_LEAVES_UNRESOLVED_THREAD',
        severity: 'BLOCKER',
        domain: 'Ending',
        storyId,
        chapterNumber: FINAL_CHAPTER,
        evidence: [
          {
            kind: 'canon',
            ref: `chapter:${FINAL_CHAPTER}:unresolved_threads`,
            detail: {
              unresolvedThreads: unresolved.map((thread) => ({
                threadId: thread.threadId,
                status: thread.status,
              })),
            },
          },
        ],
        message: `Chapter ${FINAL_CHAPTER} leaves ${unresolved.length} thread(s) unresolved.`,
        remediationClass: 'runtime',
      })
    }
  }

  return findings
}
