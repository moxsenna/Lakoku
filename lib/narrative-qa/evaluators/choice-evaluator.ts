/**
 * B.3.6 — Choice-history degradation evaluator.
 *
 * Compares the canonical accepted-choice ledger against the bounded history
 * summary that actually reached the writer boundary.
 */

import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const CHOICE_EVALUATOR_ID = 'choice-history'
export const CHOICE_EVALUATOR_VERSION = '1.1.0'

/** Canonical accepted choice, one per advanced chapter. */
export interface AcceptedChoiceEntry {
  chapterNumber: number
  choiceId: string
  choiceLabel: string
  /** Branch identity the choice established. */
  branchKey: string
  /** Causal consequence text the choice committed to canon. */
  consequence: string
}

/** The bounded history summary as assembled for the writer. */
export interface BoundedHistorySummary {
  includedChapterNumbers: number[]
  /** Verbatim rendered summary text. */
  renderedText: string
}

export interface ChoiceHistoryInputV1 {
  acceptedChoices: AcceptedChoiceEntry[]
  boundedSummary: BoundedHistorySummary
  /** Branch identity the reader state currently carries. */
  currentBranchKey: string
}

export const extractChoiceChapters: TemporalExtractor<ChoiceHistoryInputV1> = (input) => {
  const refs: ChapterRef[] = []
  input.acceptedChoices.forEach((choice, i) => {
    refs.push(...observed(`acceptedChoices[${i}].chapterNumber`, choice.chapterNumber))
  })
  input.boundedSummary.includedChapterNumbers.forEach((chapterNumber, i) => {
    refs.push(...observed(`boundedSummary.includedChapterNumbers[${i}]`, chapterNumber))
  })
  return refs
}

export function evaluateChoiceHistory(
  envelope: EvaluatorEnvelopeV1<ChoiceHistoryInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractChoiceChapters)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []
  const currentChapter = evaluatedChapter ?? envelope.horizon?.toChapter ?? 0

  const history = [...input.acceptedChoices].sort((a, b) => a.chapterNumber - b.chapterNumber)

  // ── non-monotonic history (duplicate or out-of-order chapters) ───────────
  const seenChapters = new Set<number>()
  for (const entry of history) {
    if (seenChapters.has(entry.chapterNumber)) {
      findings.push({
        schemaVersion: 1,
        code: 'CHOICE_HISTORY_NON_MONOTONIC',
        severity: 'HIGH',
        domain: 'Choice History',
        storyId,
        chapterNumber: entry.chapterNumber,
        evidence: [
          {
            kind: 'choice',
            ref: `choice:ch:${entry.chapterNumber}`,
            detail: { chapterNumber: entry.chapterNumber, choiceId: entry.choiceId },
          },
        ],
        message: `Choice history has more than one accepted choice for chapter ${entry.chapterNumber}.`,
        remediationClass: 'dataflow',
      })
    }
    seenChapters.add(entry.chapterNumber)
  }

  const latest = history[history.length - 1]
  const previous = history[history.length - 2]

  // ── duplicate previous choice ────────────────────────────────────────────
  if (
    latest &&
    previous &&
    latest.choiceId === previous.choiceId &&
    latest.choiceLabel === previous.choiceLabel
  ) {
    findings.push({
      schemaVersion: 1,
      code: 'CHOICE_HISTORY_DUPLICATE_PREVIOUS',
      severity: 'MEDIUM',
      domain: 'Choice History',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'choice',
          ref: `choice:ch:${currentChapter}`,
          detail: {
            duplicateChoiceId: latest.choiceId,
            duplicateLabel: latest.choiceLabel,
            chapters: [previous.chapterNumber, latest.chapterNumber],
          },
        },
      ],
      message: `Choice history repeats the previous choice '${latest.choiceLabel}' at chapter ${currentChapter}.`,
      remediationClass: 'dataflow',
    })
  }

  // ── latest accepted choice must reach the bounded summary ────────────────
  const includedChapters = new Set(input.boundedSummary.includedChapterNumbers)
  if (latest && !includedChapters.has(latest.chapterNumber)) {
    findings.push({
      schemaVersion: 1,
      code: 'LATEST_ACCEPTED_CHOICE_MISSING',
      severity: 'HIGH',
      domain: 'Choice History',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'choice',
          ref: `choice:summary:ch:${currentChapter}`,
          detail: {
            latestChoiceChapter: latest.chapterNumber,
            includedChapterNumbers: [...includedChapters].sort((a, b) => a - b),
          },
        },
      ],
      message: `Latest accepted choice (chapter ${latest.chapterNumber}) is missing from the bounded history summary.`,
      remediationClass: 'dataflow',
    })
  }

  // ── N-1 causal consequence must survive bounded compaction ───────────────
  if (previous && !input.boundedSummary.renderedText.includes(previous.consequence)) {
    findings.push({
      schemaVersion: 1,
      code: 'BOUNDED_SUMMARY_DROPPED_LATEST_CONSEQUENCE',
      severity: 'HIGH',
      domain: 'Choice History',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'choice',
          ref: `choice:summary:consequence:ch:${previous.chapterNumber}`,
          detail: {
            droppedFromChapter: previous.chapterNumber,
            choiceId: previous.choiceId,
            summaryLength: input.boundedSummary.renderedText.length,
          },
        },
      ],
      message: `Bounded history summary dropped the chapter ${previous.chapterNumber} causal consequence at chapter ${currentChapter}.`,
      remediationClass: 'dataflow',
    })
  }

  // ── branch identity must not be overwritten ──────────────────────────────
  if (latest && latest.branchKey !== input.currentBranchKey) {
    findings.push({
      schemaVersion: 1,
      code: 'BRANCH_IDENTITY_OVERWRITTEN',
      severity: 'BLOCKER',
      domain: 'Choice History',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'choice',
          ref: `choice:branch:ch:${currentChapter}`,
          detail: {
            latestChoiceBranchKey: latest.branchKey,
            currentBranchKey: input.currentBranchKey,
            latestChoiceId: latest.choiceId,
          },
        },
      ],
      message: `Reader branch identity '${input.currentBranchKey}' does not match the branch established by the latest accepted choice '${latest.branchKey}'.`,
      remediationClass: 'runtime',
    })
  }

  return findings
}
