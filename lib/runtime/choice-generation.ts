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
import {
  validateChoiceBranchQuality,
  mapFindingToReason,
  type ChoiceQualityInput,
} from '@/lib/story-engine/choice-quality'
import {
  groundedChoiceProseFromFinalDraft,
  emptyChoiceNarrativeContext,
  choiceNarrativeContextFromReader,
  type EndingParagraphs,
  type FinalChapterProse,
  type ChoiceNarrativeContext,
} from '@/lib/runtime/choice-context'

export {
  buildEndingParagraphs,
  groundedChoiceProseFromFinalDraft,
  emptyChoiceNarrativeContext,
  choiceNarrativeContextFromReader,
  toFinalChapterProse,
} from '@/lib/runtime/choice-context'
export type { EndingParagraphs, FinalChapterProse, ChoiceNarrativeContext } from '@/lib/runtime/choice-context'

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
  /** Original provider/gateway error when available (parity for callers). */
  cause?: unknown
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
 * Always carries the final repaired prose as `draft` / `finalChapter`.
 * Prefer omitting `lastParagraphs` so they are derived from final draft only.
 */
export interface BuildChoiceBranchInput {
  snapshot: CanonSnapshot
  /** Final post-repair draft — source of truth for choice grounding. */
  draft: ChapterDraftParsed
  chapterNumber: number
  chapterBrief: ChapterBrief
  /**
   * Optional override. When omitted, derived from final draft paragraphs only
   * via buildEndingParagraphs (never blueprint/synopsis/pre-repair text).
   */
  lastParagraphs?: EndingParagraphs
  /** Explicit final prose view; defaults from draft when omitted. */
  finalChapter?: FinalChapterProse
  routeState: RouteState
  choiceHistory: ChoiceHistoryEntry[]
  previousChoice?: ChoiceHistoryEntry | null
  lockedEndingKey: string | null
  providerContext: unknown
  /** Override total chapters (defaults to narrative-core TOTAL_CHAPTERS). */
  totalChapters?: number
  activeCharacters?: Array<{ id: string; name: string }>
  activeThreads?: Array<{ id: string; summary: string }>
  forbiddenRevelations?: string[]
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
    // Final repaired prose is the only grounding source.
    const fromFinal = groundedChoiceProseFromFinalDraft(input.draft)
    const finalChapter = input.finalChapter ?? fromFinal.finalChapter
    const endingParagraphs = input.lastParagraphs ?? fromFinal.endingParagraphs
    // Keep draft.paragraphs aligned with explicit finalChapter when provided.
    const groundedDraft: ChapterDraftParsed = {
      ...input.draft,
      title: finalChapter.title,
      paragraphs: finalChapter.paragraphs,
    }

    const provider = await deps.selectProvider(input.providerContext)
    const branch = await deps.generateChoiceBranch(
      { provider },
      {
        snapshot: input.snapshot,
        chapterBrief: input.chapterBrief,
        draft: groundedDraft,
        lastParagraphs: endingParagraphs,
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

    // Phase 4: semantic quality validation
    const qualityInput: ChoiceQualityInput = {
      branch,
      finalChapter,
      endingParagraphs,
      activeCharacters: input.activeCharacters,
      activeThreads: input.activeThreads,
      chapterNumber: input.chapterNumber,
      totalChapters: input.totalChapters,
      previousChoice: input.previousChoice ?? null,
      routeState: input.routeState,
    }
    const qualityResult = validateChoiceBranchQuality(qualityInput)

    if (!qualityResult.ok) {
      return {
        ok: false,
        reason: mapFindingToReason(qualityResult.findings) as ChoiceBuildFailureReason,
        validationFindings: qualityResult.findings,
        repairAttempts: 0,
      }
    }

    return {
      ok: true,
      source: 'INITIAL',
      branch,
      validationFindings: qualityResult.findings,
      repairAttempts: 0,
    }
  } catch (err) {
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
          message: err instanceof Error ? err.message : 'Choice provider threw an error.',
          severity: 'ERROR',
        },
      ],
      repairAttempts: 0,
      cause: err,
    }
  }
}
