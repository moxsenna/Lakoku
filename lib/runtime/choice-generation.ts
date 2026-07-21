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
    /** @deprecated Phase 5: production must not publish generic fallback. Kept for tests only. */
    onChoiceFallback?: (context: { chapterNumber: number; reason: string }) => void
    onChoiceRepair?: (context: {
      chapterNumber: number
      findingCodes: string[]
      attempt: number
    }) => void
    onChoiceFailed?: (context: {
      chapterNumber: number
      reason: string
      findingCodes: string[]
      repairAttempts: number
    }) => void
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

function qualityInputFor(
  branch: ChoiceBranch,
  finalChapter: FinalChapterProse,
  endingParagraphs: EndingParagraphs,
  input: BuildChoiceBranchInput,
): ChoiceQualityInput {
  return {
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
}

function choiceProviderInput(
  input: BuildChoiceBranchInput,
  groundedDraft: ChapterDraftParsed,
  endingParagraphs: EndingParagraphs,
): ChoiceInput {
  return {
    snapshot: input.snapshot,
    chapterBrief: input.chapterBrief,
    draft: groundedDraft,
    lastParagraphs: endingParagraphs,
    routeState: input.routeState,
    choiceHistory: input.choiceHistory,
    lockedEndingKey: input.lockedEndingKey,
  }
}

/**
 * Generate a choice branch via the injected provider.
 *
 * Pipeline:
 *  CHOICES_INITIAL → quality validate → optional CHOICES_REPAIR_1 → final validate
 *
 * On total failure returns structured ok:false (never hard-coded generic choices).
 * Callers must NOT publish on failure; release lease and mark retryable.
 */
export async function buildChoiceBranch(
  deps: ChoiceBuildDeps,
  input: BuildChoiceBranchInput,
): Promise<ChoiceBuildResult> {
  const total = input.totalChapters ?? TOTAL_CHAPTERS

  // Ending policy guard — no provider call
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

  // Final repaired prose is the only grounding source.
  const fromFinal = groundedChoiceProseFromFinalDraft(input.draft)
  const finalChapter = input.finalChapter ?? fromFinal.finalChapter
  const endingParagraphs = input.lastParagraphs ?? fromFinal.endingParagraphs
  const groundedDraft: ChapterDraftParsed = {
    ...input.draft,
    title: finalChapter.title,
    paragraphs: finalChapter.paragraphs,
  }
  const providerInput = choiceProviderInput(input, groundedDraft, endingParagraphs)

  let repairAttempts = 0
  let lastFindings: ChoiceFinding[] = []
  let lastReason: ChoiceBuildFailureReason = 'PROVIDER_FAILED'
  let lastCause: unknown

  try {
    const provider = await deps.selectProvider(input.providerContext)

    // ---- INITIAL ----
    let branch: ChoiceBranch | null = null
    try {
      branch = await deps.generateChoiceBranch(
        { provider },
        providerInput,
        {
          telemetryContext: input.providerContext,
          workflowPhase: 'CHOICES_INITIAL',
        },
      )
    } catch (err) {
      lastCause = err
      lastFindings = [
        {
          code: 'PROVIDER_ERROR',
          message: err instanceof Error ? err.message : 'Choice provider threw an error.',
          severity: 'ERROR',
        },
      ]
      lastReason = 'PROVIDER_FAILED'
      branch = null
    }

    if (branch) {
      const qualityResult = validateChoiceBranchQuality(
        qualityInputFor(branch, finalChapter, endingParagraphs, input),
      )
      if (qualityResult.ok) {
        return {
          ok: true,
          source: 'INITIAL',
          branch,
          validationFindings: qualityResult.findings,
          repairAttempts: 0,
        }
      }
      lastFindings = qualityResult.findings
      lastReason = mapFindingToReason(qualityResult.findings) as ChoiceBuildFailureReason
    } else if (lastFindings.length === 0) {
      lastFindings = [
        {
          code: 'NULL_BRANCH',
          message: 'Choice branch returned null.',
          severity: 'ERROR',
        },
      ]
      lastReason = 'PROVIDER_FAILED'
    }

    // ---- REPAIR (one attempt) ----
    deps.telemetry?.onChoiceRepair?.({
      chapterNumber: input.chapterNumber,
      findingCodes: lastFindings.map((f) => f.code),
      attempt: 1,
    })
    repairAttempts = 1

    let repaired: ChoiceBranch | null = null
    try {
      if (deps.repairChoiceBranch) {
        repaired = await deps.repairChoiceBranch(
          { provider },
          providerInput,
          lastFindings,
          {
            telemetryContext: input.providerContext,
            workflowPhase: 'CHOICES_REPAIR_1',
          },
        )
      } else {
        // Default findings-aware repair: re-generate once with repair phase.
        // Bounded finding codes + prior bad labels only (no full prose log).
        const badLabels = branch
          ? branch.choices.map((c) => c.label).filter(Boolean).slice(0, 4)
          : []
        const findingCodes = lastFindings.map((f) => f.code).slice(0, 8)
        const repairInput = {
          ...providerInput,
          chapterBrief: {
            ...providerInput.chapterBrief,
            mustNotInclude: [
              ...providerInput.chapterBrief.mustNotInclude,
              ...findingCodes,
              ...badLabels,
            ].slice(0, 16),
          },
        }
        repaired = await deps.generateChoiceBranch(
          { provider },
          repairInput,
          {
            telemetryContext: input.providerContext,
            workflowPhase: 'CHOICES_REPAIR_1',
          },
        )
      }
    } catch (err) {
      lastCause = err
      lastFindings = [
        ...lastFindings,
        {
          code: 'REPAIR_PROVIDER_ERROR',
          message: err instanceof Error ? err.message : 'Choice repair provider threw.',
          severity: 'ERROR',
        },
      ]
      repaired = null
    }

    if (repaired) {
      const repairedQuality = validateChoiceBranchQuality(
        qualityInputFor(repaired, finalChapter, endingParagraphs, input),
      )
      if (repairedQuality.ok) {
        return {
          ok: true,
          source: 'REPAIRED',
          branch: repaired,
          validationFindings: repairedQuality.findings,
          repairAttempts,
        }
      }
      lastFindings = repairedQuality.findings
      lastReason = 'REPAIR_EXHAUSTED'
    } else {
      lastReason = 'REPAIR_EXHAUSTED'
    }

    deps.telemetry?.onChoiceFailed?.({
      chapterNumber: input.chapterNumber,
      reason: lastReason,
      findingCodes: lastFindings.map((f) => f.code),
      repairAttempts,
    })

    return {
      ok: false,
      reason: lastReason,
      validationFindings: lastFindings,
      repairAttempts,
      cause: lastCause,
    }
  } catch (err) {
    deps.telemetry?.onChoiceFailed?.({
      chapterNumber: input.chapterNumber,
      reason: 'PROVIDER_FAILED',
      findingCodes: ['PROVIDER_ERROR'],
      repairAttempts,
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
      repairAttempts,
      cause: err,
    }
  }
}
