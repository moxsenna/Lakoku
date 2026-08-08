/**
 * B.3.7 — Ending-runway evaluator (FINAL_HORIZON).
 *
 * Deterministic inspection of the closure runway. Every conclusion the
 * evaluator reports is computed HERE from raw persisted rows; callers supply
 * rows, never conclusions (M10-B architecture lock, reviewer Entry 6).
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
 *
 * 1.2.0 → 1.3.0 (C-R2, reviewer Entry 6 2026-08-08) — B.3.7 rebaseline:
 *  (a) BLOCKER 2: durability inputs are now RAW persisted rows
 *      (`endingLock.lockedAtChapter`, `commit45.chapterNumber`,
 *      `commit45.committedCanonRevision`, `publishedChapterNumbers`) and the
 *      EVALUATOR itself computes "lock chapter == 45 ∧ commit Bab 45 exists ∧
 *      published Bab 45 exists". Caller-supplied conclusion booleans
 *      (`lockAtCorrectChapter` / `chapterPublished`) are forbidden by the
 *      M10-B architecture lock and were withdrawn.
 *  (b) BLOCKER 1 (VETO of C-R1 #3): the Bab-49 `emotionalResolutionBeatIds`
 *      check is WITHDRAWN from the deterministic suite. The C-R1 derivation
 *      made the beat non-empty merely because `reader_states.locked_ending_key`
 *      exists — that is the Bab-45 lock, not a Bab-49 beat, i.e. the forbidden
 *      "caller supplies the conclusion so the evaluator passes" pattern.
 *      Emotional-resolution CONTENT is semantic and moves to the M10-D
 *      semantic judge; deterministic B/C only checks structured runtime
 *      obligations that actually exist. Documented in
 *      docs/qa/m10/M10_C_R2_DECISION_B37_REBASELINE.md.
 */
export const ENDING_EVALUATOR_VERSION = '1.3.0'

export const ENDING_LOCK_CHAPTER = 45
export const MAIN_MYSTERY_CLOSURE_CHAPTER = 48
export const EMOTIONAL_RESOLUTION_CHAPTER = 49
export const FINAL_CHAPTER = 50

/**
 * Raw ending-lock row (`story_generation_contracts.ending_lock_json`).
 * B.3.7 rebaseline (C-R2): only the persisted lock fields — no conclusions.
 */
export interface EndingLockEvidence {
  lockedEndingKey: string
  /** Raw persisted `lockedAtChapter`; null when the row does not carry it. */
  lockedAtChapter: number | null
}

/**
 * Raw Bab-45 canon commit ledger row (`chapter_state_commits`), null when no
 * commit row exists for the lock chapter. C-R2: the RAW row — never a
 * caller-computed conclusion about it.
 */
export interface LockChapterCommitEvidence {
  chapterNumber: number
  committedCanonRevision: number
}

/** Raw published chapter row for a runway chapter. */
export interface RunwayChapterPublication {
  chapterNumber: number
  choicePrompt: string | null
  choiceCount: number
  endingKey: string | null
  /** New major conflicts/threads introduced by this chapter. */
  newMajorThreadIds: string[]
  // C-R2 (reviewer Entry 6, BLOCKER 1): `emotionalResolutionBeatIds` removed.
  // No deterministic runtime artifact records an emotional-resolution beat;
  // the withdrawn C-R1 derivation fabricated one from the Bab-45 ending lock.
  // Emotional-resolution CONTENT is judged by the M10-D semantic judge over
  // real prose, never by deterministic B/C.
}

/** Terminal deterministic state at the end of the story. */
export interface FinalStateEvidence {
  openDebtIds: string[]
  unresolvedThreads: Array<{ threadId: string; status: ThreadStatus }>
}

export interface EndingRunwayInputV1 {
  endingLock: EndingLockEvidence | null
  /**
   * Raw canon-commit ledger row for the lock chapter. B.3.7 rebaseline (C-R2,
   * reviewer Entry 6 BLOCKER 2): the evaluator computes durability from this
   * row plus `endingLock.lockedAtChapter` and `publishedChapterNumbers` —
   * callers may not precompute any part of the conclusion.
   */
  commit45: LockChapterCommitEvidence | null
  /** Raw published chapter numbers of the story (`public.chapters.number`). */
  publishedChapterNumbers: number[]
  publications: RunwayChapterPublication[]
  finalState: FinalStateEvidence
  /** Chapter from which new major conflicts are forbidden. */
  closureRunwayFromChapter: number
}

export const extractEndingChapters: TemporalExtractor<EndingRunwayInputV1> = (input) => {
  const refs: ChapterRef[] = []
  if (input.endingLock) {
    refs.push(...observed('endingLock.lockedAtChapter', input.endingLock.lockedAtChapter))
  }
  if (input.commit45) {
    refs.push(...observed('commit45.chapterNumber', input.commit45.chapterNumber))
  }
  input.publishedChapterNumbers.forEach((chapterNumber, i) => {
    refs.push(...observed(`publishedChapterNumbers[${i}]`, chapterNumber))
  })
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

  // ── ending lock durability at Bab 45, computed HERE from raw rows ──────
  // C-R2 (reviewer Entry 6 BLOCKER 2): durability = lock chapter == 45 ∧
  // commit Bab 45 exists ∧ published Bab 45 exists, evaluated by THIS
  // evaluator over raw inputs. Same-transaction atomicity of the three
  // artifacts is proven separately by publisher SQL inspection plus the
  // harness fencing/tamper probes (no torn state producible).
  const lockChapter = lock?.lockedAtChapter ?? null
  const commit45 = input.commit45
  const lockAtCorrectChapter = lockChapter === ENDING_LOCK_CHAPTER
  const commitRowMatches =
    commit45 !== null && commit45.chapterNumber === ENDING_LOCK_CHAPTER
  const bab45Published = input.publishedChapterNumbers.includes(ENDING_LOCK_CHAPTER)
  const lockDurable = lock !== null && lockAtCorrectChapter && commitRowMatches && bab45Published
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
            // Raw inputs exactly as captured — the auditor recomputes the same
            // conclusion from the same rows.
            lockedAtChapter: lockChapter,
            commit45,
            bab45Published,
            publishedChapterCount: input.publishedChapterNumbers.length,
          },
        },
      ],
      message: `Ending lock at chapter ${ENDING_LOCK_CHAPTER} is missing, misplaced, or not backed by both the canon commit ledger row and the published chapter row.`,
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

  // ── Bab 49 emotional resolution: WITHDRAWN from deterministic B/C ───────
  // C-R2 (reviewer Entry 6 BLOCKER 1): emotional resolution is semantic
  // content. The deterministic layer has no honest structured evidence for it,
  // and the withdrawn C-R1 derivation fabricated a beat from the Bab-45 ending
  // lock. The obligation moves to the M10-D semantic judge; deterministic B/C
  // asserts nothing here rather than paper over the missing wire.

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
