import 'server-only'
import type {
  CanonSnapshot,
} from '@lakoku/narrative-core'
import { TOTAL_CHAPTERS } from '@lakoku/narrative-core'
import type {
  ChapterDraftParsed,
  ChoiceBranch,
  ChoiceInput,
} from '@lakoku/ai-gateway'
import type { GenerationProvider } from '@lakoku/ai-gateway'
import type { ChapterBrief, ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import type { RouteState } from '@/lib/story-engine/route-state'

// ---- Types ----

export interface ChoiceFinding {
  code: string
  message: string
  severity: 'ERROR' | 'WARN'
}

export type ChoiceBuildSuccess = {
  ok: true
  /** Whether this is the initial generation or a repaired one. */
  source: 'INITIAL' | 'REPAIRED'
  branch: ChoiceBranch
  validationFindings: ChoiceFinding[]
  repairAttempts: number
}

export type ChoiceBuildFailureReason =
  | 'FINAL_CHAPTER'
  | 'PROVIDER_FAILED'
  | 'INVALID_RESPONSE'
  | 'SCHEMA_REJECTED'
  | 'UNGROUNDED'
  | 'NOT_ACTIONABLE'
  | 'NOT_DISTINCT'
  | 'UNSAFE'
  | 'REPAIR_EXHAUSTED'

export type ChoiceBuildFailure = {
  ok: false
  reason: ChoiceBuildFailureReason
  validationFindings: ChoiceFinding[]
  repairAttempts: number
}

export type ChoiceBuildResult = ChoiceBuildSuccess | ChoiceBuildFailure

/**
 * Injectable dependencies for the choice build pipeline.
 *
 * `repairChoiceBranch` is optional this phase (no-op / placeholder).
 * `telemetry` is optional; console fallback ok.
 */
export interface ChoiceBuildDeps {
  selectProvider: (context: unknown) => Promise<GenerationProvider>
  generateChoiceBranch: (
    deps: { provider: GenerationProvider },
    input: ChoiceInput,
    options?: { telemetryContext: unknown; workflowPhase: string },
  ) => Promise<ChoiceBranch | null>
  /** Optional repair function — placeholder/no-op in Phase 1. */
  repairChoiceBranch?: (
    deps: { provider: GenerationProvider },
    input: ChoiceInput,
    previousFindings: ChoiceFinding[],
    options?: { telemetryContext: unknown; workflowPhase: string },
  ) => Promise<ChoiceBranch | null>
  telemetry?: {
    onChoiceFallback?: (context: { chapterNumber: number; reason: string }) => void
  }
}

/**
 * Explicit, fully-grounded input for choice branch generation.
 * Always carries the final repaired prose as `draft` and `lastParagraphs`.
 */
export interface BuildChoiceBranchInput {
  snapshot: CanonSnapshot
  draft: ChapterDraftParsed
  chapterNumber: number
  chapterBrief: ChapterBrief
  lastParagraphs: ChoiceInput['lastParagraphs']
  routeState: RouteState
  choiceHistory: ChoiceHistoryEntry[]
  lockedEndingKey: string | null
  providerContext: unknown
  /** Override total chapters (defaults to narrative-core TOTAL_CHAPTERS). */
  totalChapters?: number
}

// ---- Guards ----

/**
 * Returns true when the chapter number meets or exceeds the total chapter count,
 * meaning no more reader choices should be generated.
 */
export function isFinalChapter(chapterNumber: number, totalChapters: number = TOTAL_CHAPTERS): boolean {
  return chapterNumber >= totalChapters
}

// ---- Fallback (extracted from story-generation.ts) ----

/** Legacy fallback shape — matches what story-generation.ts publish flow expects. */
export interface LegacyChoicePayload {
  choicePrompt: string
  choices: { id: string; label: string }[]
  outcomes: {
    choiceId: string
    consequence: string[]
    nextChapterNumber: number | null
    isEnding: boolean
  }[]
}

/**
 * Hard-coded fallback choices grounded in the draft prose.
 * Used by the standard flow when LLM choice generation fails.
 */
export function fallbackChoicesFromDraft(
  draft: ChapterDraftParsed,
  chapterNumber: number,
): LegacyChoicePayload {
  const isEnding = chapterNumber >= TOTAL_CHAPTERS
  const next = isEnding ? null : chapterNumber + 1
  const hook = (draft.paragraphs.at(-1) ?? draft.title).slice(0, 80)
  const choicePrompt = isEnding
    ? 'Bagaimana kau menutup kisah ini?'
    : `Setelah ${hook}${hook.length >= 80 ? '\u2026' : ''}, apa yang kau lakukan?`
  const choices = [
    { id: 'hadapi', label: 'Hadapi langsung apa yang baru terbuka' },
    { id: 'selidiki', label: 'Selidiki dulu jejak yang tersisa' },
  ]
  const outcomes = [
    {
      choiceId: 'hadapi',
      consequence: isEnding
        ? ['Kau menuntaskan semuanya; kisah menemukan penutupnya.']
        : ['Kau melangkah ke depan; konsekuensi menunggu di bab berikutnya.'],
      nextChapterNumber: next,
      isEnding,
    },
    {
      choiceId: 'selidiki',
      consequence: isEnding
        ? ['Kau memilih melepaskan; kisah mengendap dalam keheningan.']
        : ['Kau menahan nafas dan mengamati; arus cerita tetap menarikmu maju.'],
      nextChapterNumber: next,
      isEnding,
    },
  ]
  return { choicePrompt: choicePrompt.slice(0, 120), choices, outcomes }
}

// ---- Main orchestrator ----

/**
 * Generate a choice branch via the injected provider.
 *
 * Responsibilities:
 *  - Ending-policy guard: final chapter returns ok:false without calling provider.
 *  - Provider orchestration: selectProvider -> generateChoiceBranch.
 *  - Error handling: catches provider errors and returns structured failure.
 *
 * Callers decide whether to fall back (standard) or throw (personalized).
 */
export async function buildChoiceBranch(
  deps: ChoiceBuildDeps,
  input: BuildChoiceBranchInput,
): Promise<ChoiceBuildResult> {
  const total = input.totalChapters ?? TOTAL_CHAPTERS

  // Ending policy guard
  if (isFinalChapter(input.chapterNumber, total)) {
    return {
      ok: false,
      reason: 'FINAL_CHAPTER',
      validationFindings: [
        {
          code: 'FINAL_CHAPTER_NO_CHOICES',
          message: 'Final chapter does not have reader choices.',
          severity: 'ERROR',
        },
      ],
      repairAttempts: 0,
    }
  }

  try {
    const provider = await deps.selectProvider(input.providerContext)
    const branch = await deps.generateChoiceBranch(
      { provider },
      {
        snapshot: input.snapshot,
        chapterBrief: input.chapterBrief,
        draft: input.draft,
        lastParagraphs: input.lastParagraphs,
        routeState: input.routeState,
        choiceHistory: input.choiceHistory,
        lockedEndingKey: input.lockedEndingKey,
      },
      {
        telemetryContext: input.providerContext,
        workflowPhase: 'CHOICES_INITIAL',
      },
    )

    if (!branch) {
      return {
        ok: false,
        reason: 'PROVIDER_FAILED',
        validationFindings: [
          {
            code: 'NULL_BRANCH',
            message: 'Choice branch returned null.',
            severity: 'ERROR',
          },
        ],
        repairAttempts: 0,
      }
    }

    return {
      ok: true,
      source: 'INITIAL',
      branch,
      validationFindings: [],
      repairAttempts: 0,
    }
  } catch (_err) {
    deps.telemetry?.onChoiceFallback?.({
      chapterNumber: input.chapterNumber,
      reason: 'provider_error',
    })
    return {
      ok: false,
      reason: 'PROVIDER_FAILED',
      validationFindings: [
        {
          code: 'PROVIDER_ERROR',
          message: 'Choice provider threw an error.',
          severity: 'ERROR',
        },
      ],
      repairAttempts: 0,
    }
  }
}
