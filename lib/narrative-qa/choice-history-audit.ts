/**
 * M10-A Task 2 — Choice History characterization detectors.
 *
 * Pure deterministic analyzers over a list of choice-history items. Findings are
 * EMITTED by rules from the input data — never pre-pushed because the audit plan
 * suspects them.
 *
 * Budget model: token estimate = chars / 4 (prose-dominant Indonesian text proxy;
 * distinct from the compiler's word-count proxy — this module owns its own metric
 * so tests stay hermetic).
 *
 * Evidence cited (source strings only; no server-only imports):
 *   - lib/story-engine/chapter-brief.ts :: summarizeChoiceHistory — sorts history
 *     + previousChoice and slices the joined summary at 4096 chars; the oldest
 *     entries silently drop off the brief once history outgrows the cap.
 *   - lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader — passes
 *     the FULL reader_states.choice_history through un-truncated; no budget
 *     trimming happens before the brief summarizes it.
 *   - lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter —
 *     reader_states.choice_history is the declared source of truth for the
 *     previous choice (fail-closed TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER).
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface ChoiceHistoryItem {
  chapterNumber: number
  label: string
  consequence: string[]
  effectSummary: string
  flags: string[]
}

export interface ChoiceHistoryAuditOptions {
  /** Declared per-chapter budget for the choice summary (token estimate). */
  declaredBudget?: number
  /**
   * Target chapter being generated. The latest expected visible choice is
   * chapter (targetChapter - 1) — for Bab 50 the newest entry must be 49.
   * Takes precedence over expectedLatestChapter.
   */
  targetChapter?: number
  /**
   * Latest chapter that SHOULD have a visible history entry.
   * Convention: for target chapter N, the latest choice comes from chapter N-1.
   * When supplied and the newest entry is older, CHOICE_HISTORY_RECENT_LOSS fires.
   */
  expectedLatestChapter?: number
  /**
   * Production behavior (lib/story-engine/chapter-brief.ts :: summarizeChoiceHistory):
   * the brief appends previousChoice to the history array unconditionally
   * (`[...history, previousChoice]`) while choiceNarrativeContextFromReader had
   * already returned the latest entry inside choiceHistory — the newest choice
   * appears TWICE at the tail of the summary. When true, a non-empty history
   * triggers CHOICE_HISTORY_DUPLICATE_PREVIOUS (structural duplicate).
   */
  summaryAppendsPreviousChoice?: boolean
}

export const CHOICE_HISTORY_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/story-engine/chapter-brief.ts :: summarizeChoiceHistory',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'History + previousChoice are sorted by chapterNumber and joined, then `.slice(0, 4096)` truncates the summary — the oldest entries silently fall out of the chapter brief once history outgrows 4096 chars. No truncation signal is recorded anywhere.',
  },
  {
    source: 'lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Full reader_states.choice_history array is passed through un-truncated; previousChoice is the last entry (or the triggerChoiceId match). No budget enforcement exists before the brief summarizes.',
  },
  {
    source: 'lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Choice history is the declared source of truth for the previous choice; the loader is fail-closed (TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER) when chapter N-1 had choices but no trigger was supplied.',
  },
]

export function estimateChoiceTokens(item: ChoiceHistoryItem): number {
  const text = [
    item.label,
    ...item.consequence,
    item.effectSummary,
    ...item.flags,
  ].join(' ')
  return Math.ceil(text.length / 4)
}

/**
 * Emit findings over a list of choice-history items.
 * - CHOICE_HISTORY_RECENT_LOSS: newest visible entry older than expectedLatestChapter
 *   (or a gap in the chapter sequence) — the reader's most recent choice never
 *   reaches the next brief.
 * - CHOICE_HISTORY_DUPLICATE_PREVIOUS: two consecutive entries share label AND
 *   consequence — a sign the same branch was recorded twice.
 * - CHOICE_HISTORY_BUDGET_PRESSURE: cumulative estimated tokens exceed the
 *   declared budget; the brief's 4096-char slice will drop oldest entries.
 */
export function auditChoiceHistory(
  items: ChoiceHistoryItem[],
  options: ChoiceHistoryAuditOptions = {},
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []
  const declaredBudget = options.declaredBudget ?? 2500

  const sorted = [...items].sort((a, b) => a.chapterNumber - b.chapterNumber)

  // --- Duplicate previous (choiceNarrativeContextFromReader + summarizeChoiceHistory) ---
  // Production: choiceNarrativeContextFromReader returns previousChoice = last history
  // entry (or triggerChoiceId match). summarizeChoiceHistory then appends previousChoice
  // unconditionally: `[...history, previousChoice]` — duplicating the latest entry.
  // Emitted when the caller asserts the production append behavior is in effect.
  if (options.summaryAppendsPreviousChoice === true && sorted.length > 0) {
    findings.push(baseFinding('CHOICE_HISTORY_DUPLICATE_PREVIOUS', 'MEDIUM', {
      risk: 'The latest choice history entry is duplicated in the writer prompt: choiceNarrativeContextFromReader returns previousChoice = last entry, and summarizeChoiceHistory appends previousChoice to the history array (`[...history, previousChoice]`). The writer sees the same branch twice at the tail of the summary.',
      detail: {
        latestChapter: sorted[sorted.length - 1].chapterNumber,
        label: sorted[sorted.length - 1].label,
        entryCount: sorted.length,
      },
      followUp: 'De-duplicate in summarizeChoiceHistory (drop the appended previousChoice when it is already the last history entry) or change choiceNarrativeContextFromReader to return previousChoice only when it differs from the last entry.',
    }))
  }

  // --- Recent loss ---
  if (sorted.length > 0) {
    const latestVisible = sorted[sorted.length - 1].chapterNumber
    const expected =
      options.targetChapter != null
        ? options.targetChapter - 1
        : (options.expectedLatestChapter ?? latestVisible)
    if (latestVisible < expected) {
      findings.push(baseFinding('CHOICE_HISTORY_RECENT_LOSS', 'HIGH', {
        risk: `Latest visible choice history entry is chapter ${latestVisible}, but chapter ${expected} is expected (target chapter = expected + 1). The most recent reader choice cannot reach the next chapter brief (summarizeChoiceHistory only sees recorded entries).`,
        detail: { latestVisibleChapter: latestVisible, expectedLatestChapter: expected },
        followUp: 'Verify the choice branch for chapter N-1 is appended to reader_states.choice_history before chapter N is generated (publish path).',
      }))
    }
    // Sequence gap: missing intermediate chapters mean history is not append-only.
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].chapterNumber !== sorted[i - 1].chapterNumber + 1) {
        findings.push(baseFinding('CHOICE_HISTORY_RECENT_LOSS', 'MEDIUM', {
          risk: `Choice history chapter sequence jumps from ${sorted[i - 1].chapterNumber} to ${sorted[i].chapterNumber}; intermediate chapter choices are missing from the history used by the brief.`,
          detail: {
            fromChapter: sorted[i - 1].chapterNumber,
            toChapter: sorted[i].chapterNumber,
          },
          followUp: 'Confirm entries are append-only per chapter and no cleanup job truncates the middle of the history.',
        }))
      }
    }
  } else {
    const expected =
      options.targetChapter != null ? options.targetChapter - 1 : options.expectedLatestChapter
    if (expected != null && expected > 1) {
      findings.push(baseFinding('CHOICE_HISTORY_RECENT_LOSS', 'MEDIUM', {
        risk: `Choice history is empty while chapter ${expected} is expected to carry a visible entry.`,
        detail: { expectedLatestChapter: expected },
        followUp: 'Confirm the first reader choice is recorded at the end of chapter 1.',
      }))
    }
  }

  // --- Duplicate consecutive entries (data-level; distinct from the structural
  // previousChoice duplication above) ---
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const current = sorted[i]
    if (
      prev.label === current.label
      && JSON.stringify(prev.consequence) === JSON.stringify(current.consequence)
    ) {
      findings.push(baseFinding('CHOICE_HISTORY_DUPLICATE_CONSECUTIVE', 'MEDIUM', {
        risk: `Consecutive chapters ${prev.chapterNumber} and ${current.chapterNumber} record the same choice label and consequence; the same branch appears twice in the history the writer prompt summarizes.`,
        detail: {
          chapterA: prev.chapterNumber,
          chapterB: current.chapterNumber,
          label: current.label,
        },
        followUp: 'Confirm the choice branch append at publish is keyed by chapter and cannot double-insert.',
      }))
    }
  }

  // --- Budget pressure ---
  const totalTokens = sorted.reduce((sum, item) => sum + estimateChoiceTokens(item), 0)
  if (totalTokens > declaredBudget) {
    findings.push(baseFinding('CHOICE_HISTORY_BUDGET_PRESSURE', 'HIGH', {
      risk: `Choice history estimated tokens (${totalTokens}) exceed declared budget (${declaredBudget}). summarizeChoiceHistory caps the joined text at 4096 chars, so oldest entries will be dropped from the brief without any explicit eviction signal.`,
      detail: {
        estimatedTokens: totalTokens,
        declaredBudget,
        entryCount: sorted.length,
      },
      followUp: 'Introduce an explicit truncation/eviction policy for choice history that records dropped entries (e.g. retrieval log) instead of silent .slice(0, 4096).',
    }))
  }

  return findings
}

function baseFinding(
  code: string,
  severity: AuditSeverity,
  args: {
    risk: string
    detail: Record<string, unknown>
    followUp: string
  },
): StoryBibleAuditFinding {
  return {
    code,
    severity,
    domain: 'Choice History',
    status: 'BOUNDED_LOSS_RISK',
    sourceOfTruth: ['reader_states.choice_history'],
    producers: ['lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter (publish path)'],
    consumers: ['lib/story-engine/chapter-brief.ts :: summarizeChoiceHistory'],
    validators: ['lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter (fail-closed trigger gate)'],
    evidence: [
      ...CHOICE_HISTORY_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/choice-history-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
