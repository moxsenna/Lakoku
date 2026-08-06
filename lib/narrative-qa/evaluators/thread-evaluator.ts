/**
 * B.3.4 — Thread lifecycle evaluator.
 *
 * Reuses the canonical G4 predicates from `lib/narrative/threads.ts`
 * (REUSE_SHARED_PREDICATE) rather than re-deriving the status machine, and
 * speaks canonical `ThreadStatus` only.
 */

import {
  MAIN_MYSTERY_BLOCK_CHAPTER,
  MAX_ACTIVE_THREADS,
  NO_NEW_THREAD_FROM_CHAPTER,
  STALE_AFTER_CHAPTERS,
  STALE_CALLBACK_WINDOW,
  canTransition,
} from '../../narrative/threads'
import type { ThreadStatus } from '../../narrative/types'
import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const THREAD_EVALUATOR_ID = 'thread-lifecycle'
export const THREAD_EVALUATOR_VERSION = '1.1.0'

const ACTIVE_STATUSES: readonly ThreadStatus[] = ['OPEN', 'DEVELOPING', 'PAYOFF_DUE']

/** Canonical `story_threads` row as of the evaluated chapter. */
export interface ThreadStateEntry {
  threadId: string
  isMainMystery: boolean
  status: ThreadStatus
  introducedChapter: number
  /** Last chapter the thread was materially touched/advanced. */
  lastTouchedChapter: number
}

/** Raw `story_thread_transitions` row. */
export interface ThreadTransitionEntry {
  threadId: string
  chapterNumber: number
  fromStatus: ThreadStatus
  toStatus: ThreadStatus
  /** Reconciliation checkpoint that audited this transition, if any. */
  approvedByCheckpointId: string | null
}

export interface ThreadLifecycleInputV1 {
  threads: ThreadStateEntry[]
  transitions: ThreadTransitionEntry[]
  /** Thread ids the runtime reports as materially advanced in this chapter. */
  advancedThreadIdsThisChapter: string[]
  /** Thread ids present in the previous chapter's canonical snapshot. */
  previousChapterThreadIds: string[]
}

export const extractThreadChapters: TemporalExtractor<ThreadLifecycleInputV1> = (input) => {
  const refs: ChapterRef[] = []
  input.threads.forEach((thread, i) => {
    refs.push(...observed(`threads[${i}].introducedChapter`, thread.introducedChapter))
    refs.push(...observed(`threads[${i}].lastTouchedChapter`, thread.lastTouchedChapter))
  })
  input.transitions.forEach((transition, i) => {
    refs.push(...observed(`transitions[${i}].chapterNumber`, transition.chapterNumber))
  })
  return refs
}

export function evaluateThreadLifecycle(
  envelope: EvaluatorEnvelopeV1<ThreadLifecycleInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractThreadChapters)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []
  const currentChapter = evaluatedChapter ?? envelope.horizon?.toChapter ?? 0

  const threads = [...input.threads].sort((a, b) => a.threadId.localeCompare(b.threadId))
  const transitions = [...input.transitions].sort(
    (a, b) => a.chapterNumber - b.chapterNumber || a.threadId.localeCompare(b.threadId),
  )
  const advanced = new Set(input.advancedThreadIdsThisChapter)

  // ── illegal status transitions + unaudited abandonment ───────────────────
  for (const transition of transitions) {
    if (!canTransition(transition.fromStatus, transition.toStatus)) {
      findings.push({
        schemaVersion: 1,
        code: 'ILLEGAL_THREAD_STATUS_TRANSITION',
        severity: 'BLOCKER',
        domain: 'Story Thread',
        storyId,
        chapterNumber: transition.chapterNumber,
        evidence: [
          {
            kind: 'canon',
            ref: `thread:${transition.threadId}:transition:ch:${transition.chapterNumber}`,
            detail: {
              threadId: transition.threadId,
              fromStatus: transition.fromStatus,
              toStatus: transition.toStatus,
            },
          },
        ],
        message: `Illegal thread transition ${transition.fromStatus} → ${transition.toStatus} for ${transition.threadId} at chapter ${transition.chapterNumber}.`,
        remediationClass: 'runtime',
      })
    }

    if (transition.toStatus === 'ABANDONED_APPROVED' && !transition.approvedByCheckpointId) {
      findings.push({
        schemaVersion: 1,
        code: 'THREAD_ABANDONED_WITHOUT_RECONCILIATION_PROVENANCE',
        severity: 'BLOCKER',
        domain: 'Story Thread',
        storyId,
        chapterNumber: transition.chapterNumber,
        evidence: [
          {
            kind: 'checkpoint',
            ref: `thread:${transition.threadId}:abandon:ch:${transition.chapterNumber}`,
            detail: { threadId: transition.threadId, approvedByCheckpointId: null },
          },
        ],
        message: `Thread ${transition.threadId} moved to ABANDONED_APPROVED at chapter ${transition.chapterNumber} without audited reconciliation provenance.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── silent disappearance ─────────────────────────────────────────────────
  const currentIds = new Set(threads.map((thread) => thread.threadId))
  const terminatedIds = new Set(
    transitions
      .filter(
        (transition) =>
          transition.toStatus === 'RESOLVED' || transition.toStatus === 'ABANDONED_APPROVED',
      )
      .map((transition) => transition.threadId),
  )
  for (const previousId of [...input.previousChapterThreadIds].sort()) {
    if (!currentIds.has(previousId) && !terminatedIds.has(previousId)) {
      findings.push({
        schemaVersion: 1,
        code: 'THREAD_SILENT_DISAPPEARANCE',
        severity: 'BLOCKER',
        domain: 'Story Thread',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `thread:${previousId}`,
            detail: { threadId: previousId, presentInPreviousChapter: true, terminated: false },
          },
        ],
        message: `Thread ${previousId} disappeared at chapter ${currentChapter} without a RESOLVED or ABANDONED_APPROVED transition.`,
        remediationClass: 'runtime',
      })
    }
  }

  const activeThreads = threads.filter((thread) => ACTIVE_STATUSES.includes(thread.status))

  // ── active-thread budget ─────────────────────────────────────────────────
  if (activeThreads.length > MAX_ACTIVE_THREADS) {
    findings.push({
      schemaVersion: 1,
      code: 'ACTIVE_THREAD_BUDGET_EXCEEDED',
      severity: 'HIGH',
      domain: 'Story Thread',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'canon',
          ref: `thread_budget:ch:${currentChapter}`,
          detail: {
            activeThreadCount: activeThreads.length,
            maxBudget: MAX_ACTIVE_THREADS,
            activeThreadIds: activeThreads.map((thread) => thread.threadId),
          },
        },
      ],
      message: `Active thread count (${activeThreads.length}) exceeds budget of ${MAX_ACTIVE_THREADS} at chapter ${currentChapter}.`,
      remediationClass: 'policy',
    })
  }

  // ── no new thread from Bab 41 ────────────────────────────────────────────
  for (const thread of threads) {
    if (thread.introducedChapter >= NO_NEW_THREAD_FROM_CHAPTER) {
      findings.push({
        schemaVersion: 1,
        code: 'NEW_THREAD_INTRODUCED_AFTER_40',
        severity: 'HIGH',
        domain: 'Story Thread',
        storyId,
        chapterNumber: thread.introducedChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `thread:${thread.threadId}`,
            detail: {
              threadId: thread.threadId,
              introducedChapter: thread.introducedChapter,
              noNewThreadFromChapter: NO_NEW_THREAD_FROM_CHAPTER,
            },
          },
        ],
        message: `Thread ${thread.threadId} introduced at chapter ${thread.introducedChapter} (forbidden from chapter ${NO_NEW_THREAD_FROM_CHAPTER}).`,
        remediationClass: 'policy',
      })
    }
  }

  // ── PAYOFF_DUE must be advanced from Bab 41 onward ───────────────────────
  if (currentChapter >= NO_NEW_THREAD_FROM_CHAPTER) {
    const payoffDue = activeThreads.filter((thread) => thread.status === 'PAYOFF_DUE')
    if (payoffDue.length > 0 && !payoffDue.some((thread) => advanced.has(thread.threadId))) {
      findings.push({
        schemaVersion: 1,
        code: 'PAYOFF_DUE_THREAD_NOT_ADVANCED',
        severity: 'HIGH',
        domain: 'Story Thread',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `thread_payoff:ch:${currentChapter}`,
            detail: {
              payoffDueThreadIds: payoffDue.map((thread) => thread.threadId),
              advancedThreadIds: [...advanced].sort(),
            },
          },
        ],
        message: `No PAYOFF_DUE thread advanced at chapter ${currentChapter}.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── stale 6-chapter rule + 3-chapter callback deadline ───────────────────
  for (const thread of activeThreads) {
    const untouchedFor = currentChapter - thread.lastTouchedChapter
    if (untouchedFor > STALE_AFTER_CHAPTERS + STALE_CALLBACK_WINDOW) {
      findings.push({
        schemaVersion: 1,
        code: 'STALE_THREAD_CALLBACK_DEADLINE_MISSED',
        severity: 'HIGH',
        domain: 'Story Thread',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `thread:${thread.threadId}:stale`,
            detail: {
              threadId: thread.threadId,
              lastTouchedChapter: thread.lastTouchedChapter,
              untouchedForChapters: untouchedFor,
              staleAfterChapters: STALE_AFTER_CHAPTERS,
              callbackWindow: STALE_CALLBACK_WINDOW,
            },
          },
        ],
        message: `Thread ${thread.threadId} went stale after chapter ${thread.lastTouchedChapter} and missed its callback deadline by chapter ${currentChapter}.`,
        remediationClass: 'runtime',
      })
    } else if (untouchedFor > STALE_AFTER_CHAPTERS) {
      findings.push({
        schemaVersion: 1,
        code: 'STALE_THREAD_DETECTED',
        severity: 'MEDIUM',
        domain: 'Story Thread',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `thread:${thread.threadId}:stale`,
            detail: {
              threadId: thread.threadId,
              lastTouchedChapter: thread.lastTouchedChapter,
              untouchedForChapters: untouchedFor,
              staleAfterChapters: STALE_AFTER_CHAPTERS,
            },
          },
        ],
        message: `Thread ${thread.threadId} untouched for ${untouchedFor} chapters at chapter ${currentChapter}; callback required within ${STALE_CALLBACK_WINDOW} chapters.`,
        remediationClass: 'runtime',
      })
    }
  }

  // ── post-Bab48 unresolved main mystery ───────────────────────────────────
  if (currentChapter >= MAIN_MYSTERY_BLOCK_CHAPTER) {
    for (const thread of threads) {
      if (thread.isMainMystery && thread.status !== 'RESOLVED') {
        findings.push({
          schemaVersion: 1,
          code: 'MAIN_MYSTERY_THREAD_UNRESOLVED_AT_48',
          severity: 'BLOCKER',
          domain: 'Story Thread',
          storyId,
          chapterNumber: currentChapter,
          evidence: [
            {
              kind: 'canon',
              ref: `thread:${thread.threadId}:main_mystery`,
              detail: {
                threadId: thread.threadId,
                status: thread.status,
                blockChapter: MAIN_MYSTERY_BLOCK_CHAPTER,
              },
            },
          ],
          message: `Main mystery thread ${thread.threadId} is ${thread.status} at chapter ${currentChapter} (must be RESOLVED by chapter ${MAIN_MYSTERY_BLOCK_CHAPTER}).`,
          remediationClass: 'runtime',
        })
      }
    }
  }

  return findings
}
