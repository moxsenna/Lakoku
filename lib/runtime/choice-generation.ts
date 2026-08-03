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
  type EndingParagraphs,
  type FinalChapterProse,
} from '@/lib/runtime/choice-context'
import { abortableSleep, isAbortError, throwIfAborted } from '@/lib/runtime/abort'
import {
  DEFAULT_CHOICE_CANDIDATE_TIMEOUT_MS,
  resolveChoiceDeadlineAt,
  type ChoiceExecutionBudget,
} from '@/lib/runtime/choice-execution-budget'

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
  | 'CHOICE_WORKFLOW_TIMEOUT'
  | 'GENERATION_JOB_DEADLINE_EXCEEDED'
  | 'CHOICE_PARENT_CANCELLED'

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
    options?: {
      telemetryContext: unknown
      workflowPhase: string
      signal?: AbortSignal
      callBudget?: { used: number; max: number }
      choiceDeadlineAtMs?: number
      choiceDeadlineSource?: 'LOCAL_POLICY' | 'PARENT_JOB'
      choicePerCandidateTimeoutMs?: number
      choiceMaxCandidates?: number
      providerRuntime?: import('@/lib/ai-gateway/provider').ProviderRuntime
    },
  ) => Promise<ChoiceBranch | null>
  /** Optional repair function — placeholder/no-op in Phase 1. */
  repairChoiceBranch?: (
    deps: { provider: GenerationProvider },
    input: ChoiceInput,
    previousFindings: ChoiceFinding[],
    options?: {
      telemetryContext: unknown
      workflowPhase: string
      signal?: AbortSignal
      callBudget?: { used: number; max: number }
      choiceDeadlineAtMs?: number
      choiceDeadlineSource?: 'LOCAL_POLICY' | 'PARENT_JOB'
      choicePerCandidateTimeoutMs?: number
      choiceMaxCandidates?: number
      providerRuntime?: import('@/lib/ai-gateway/provider').ProviderRuntime
    },
  ) => Promise<ChoiceBranch | null>
  telemetry?: {
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
  /** Worker ownership cancellation propagated to every choice provider call. */
  signal?: AbortSignal
  /** Shared workflow budget; built from canonical worker deadline when omitted. */
  choiceExecutionBudget?: ChoiceExecutionBudget
  providerRuntime?: import('@/lib/ai-gateway/provider').ProviderRuntime
  /** Override total chapters (defaults to narrative-core TOTAL_CHAPTERS). */
  totalChapters?: number
  activeCharacters?: Array<{ id: string; name: string }>
  activeThreads?: Array<{ id: string; summary: string }>
  forbiddenRevelations?: string[]
  /**
   * Soft creative direction signals for choice design (reader-safe labels only).
   * Never overrides final-prose grounding.
   */
  creativeDirectionHints?: {
    relationshipFocus?: string | null
    agencyStyle?: string | null
    hardBoundaryLabels?: string[]
  }
}

// ---- Guards ----

/**
 * Returns true when the chapter number meets or exceeds the total chapter count,
 * meaning no more reader choices should be generated.
 */
export function isFinalChapter(chapterNumber: number, totalChapters: number = TOTAL_CHAPTERS): boolean {
  return chapterNumber >= totalChapters
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
  // Fold soft direction into chapterBrief mustNotInclude / goal without changing
  // grounding source (final prose remains authority).
  let chapterBrief = input.chapterBrief
  const hints = input.creativeDirectionHints
  if (hints) {
    const extraMustNot = [...(chapterBrief.mustNotInclude ?? [])]
    for (const label of hints.hardBoundaryLabels ?? []) {
      const line = `Jangan tampilkan: ${label}`
      if (!extraMustNot.includes(line)) extraMustNot.push(line)
    }
    const softBits: string[] = []
    if (hints.agencyStyle) softBits.push(`Bias pilihan: ${hints.agencyStyle}`)
    if (hints.relationshipFocus) softBits.push(`Fokus relasi: ${hints.relationshipFocus}`)
    let chapterGoal = chapterBrief.chapterGoal
    if (softBits.length) {
      chapterGoal = `${chapterGoal} (${softBits.join('; ')})`.slice(0, 1200)
    }
    chapterBrief = {
      ...chapterBrief,
      chapterGoal,
      mustNotInclude: extraMustNot.slice(0, 16),
      goals: [chapterGoal],
    }
  }

  return {
    snapshot: input.snapshot,
    chapterBrief,
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
  if (input.signal?.aborted) {
    return {
      ok: false,
      reason: 'CHOICE_PARENT_CANCELLED',
      validationFindings: [],
      repairAttempts: 0,
      cause: input.signal.reason,
    }
  }

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
    throwIfAborted(input.signal)
    const {
      DEFAULT_CHOICE_RETRY_BUDGET,
      classifyChoiceProviderError,
      choiceRetryAction,
      transientBackoffMs,
      buildChoiceRepairNotes,
    } = await import('@/lib/runtime/choice-error-taxonomy')

    const budget = DEFAULT_CHOICE_RETRY_BUDGET
    const resolvedDeadline = resolveChoiceDeadlineAt({
      nowMs: Date.now(),
      parentDeadlineAtMs: input.choiceExecutionBudget?.deadlineAtMs,
    })
    const choiceBudget: ChoiceExecutionBudget = input.choiceExecutionBudget ?? {
      usedCalls: 0,
      maxCalls: budget.maxTotalCalls,
      maxCandidates: budget.maxProviderCandidates,
      perCandidateTimeoutMs: DEFAULT_CHOICE_CANDIDATE_TIMEOUT_MS,
      deadlineAtMs: resolvedDeadline.deadlineAtMs,
      deadlineSource: resolvedDeadline.source,
    }
    // Shared with gateway-provider: incremented once per ACTUAL candidate request.
    const providerCallBudget = { used: choiceBudget.usedCalls, max: choiceBudget.maxCalls }
    const syncUsedCalls = () => { choiceBudget.usedCalls = providerCallBudget.used }
    const workflowFailureReason = (err: unknown): ChoiceBuildFailureReason | null => {
      if (input.signal?.aborted) return 'CHOICE_PARENT_CANCELLED'
      const code = err && typeof err === 'object' && 'code' in err
        ? (err as { code?: unknown }).code
        : err instanceof Error ? err.message : undefined
      if (code === 'GENERATION_JOB_DEADLINE_EXCEEDED') return 'GENERATION_JOB_DEADLINE_EXCEEDED'
      if (code === 'CHOICE_WORKFLOW_TIMEOUT') return 'CHOICE_WORKFLOW_TIMEOUT'
      return null
    }
    let totalCalls = 0
    let structuralRepairs = 0
    let qualityRepairs = 0

    const runProviderCall = (
      callInput: ChoiceInput,
      workflowPhase: string,
    ): Promise<ChoiceBranch | null> =>
      deps.generateChoiceBranch({ provider }, callInput, {
        telemetryContext: input.providerContext,
        workflowPhase,
        signal: input.signal,
        callBudget: providerCallBudget,
        choiceDeadlineAtMs: choiceBudget.deadlineAtMs,
        choiceDeadlineSource: choiceBudget.deadlineSource,
        choicePerCandidateTimeoutMs: choiceBudget.perCandidateTimeoutMs,
        choiceMaxCandidates: choiceBudget.maxCandidates,
        ...(input.providerRuntime === undefined
          ? {}
          : { providerRuntime: input.providerRuntime }),
      })

    // Build a findings-aware repair input (creative/structural guidance only;
    // never dump diagnostic codes into narrative mustNotInclude).
    const buildRepairInput = (
      findings: ChoiceFinding[],
      lastBranch: ChoiceBranch | null,
    ): ChoiceInput => {
      const repairNotes = buildChoiceRepairNotes(findings)
      const badLabels = lastBranch
        ? lastBranch.choices.map((c) => c.label).filter(Boolean).slice(0, 4)
        : []
      const repairGoal = [
        providerInput.chapterBrief.chapterGoal,
        'Perbaiki dua tindakan:',
        ...repairNotes.map((n) => `- ${n}`),
        badLabels.length ? `Hindari mengulang label yang gagal: ${badLabels.join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1200)
      return {
        ...providerInput,
        chapterBrief: {
          ...providerInput.chapterBrief,
          chapterGoal: repairGoal,
          mustNotInclude: providerInput.chapterBrief.mustNotInclude.slice(0, 16),
        },
      }
    }

    let branch: ChoiceBranch | null = null
    let phase = 'CHOICES_INITIAL'
    let currentInput: ChoiceInput = providerInput
    let source: 'INITIAL' | 'REPAIRED' = 'INITIAL'

    // Repair loop remains bounded by repair policy; actual provider requests use choiceBudget.
    while (choiceBudget.usedCalls < choiceBudget.maxCalls) {
      throwIfAborted(input.signal)
      if (Date.now() >= choiceBudget.deadlineAtMs) {
        lastReason = choiceBudget.deadlineSource === 'PARENT_JOB'
          ? 'GENERATION_JOB_DEADLINE_EXCEEDED'
          : 'CHOICE_WORKFLOW_TIMEOUT'
        lastCause = new Error(lastReason)
        break
      }
      totalCalls += 1
      let called: ChoiceBranch | null = null
      let transientErr = false
      try {
        called = await runProviderCall(currentInput, phase)
        syncUsedCalls()
      } catch (err) {
        syncUsedCalls()
        const workflowReason = workflowFailureReason(err)
        if (workflowReason) {
          lastReason = workflowReason
          lastCause = err
          break
        }
        if (isAbortError(err)) throw err
        lastCause = err
        const code = classifyChoiceProviderError(err)
        const action = choiceRetryAction(code)
        lastFindings = [{
          code: 'PROVIDER_ERROR',
          message: err instanceof Error ? err.message : 'Choice provider threw an error.',
          severity: 'ERROR',
        }]
        lastReason = 'PROVIDER_FAILED'
        if (action === 'transient_retry' && choiceBudget.usedCalls < choiceBudget.maxCalls) {
          // Backoff then retry same input (provider chain handled inside call).
          await abortableSleep(transientBackoffMs(totalCalls), input.signal)
          transientErr = true
        } else if (
          (action === 'structural_repair' || action === 'quality_repair' || action === 'content_rewrite') &&
          choiceBudget.usedCalls < choiceBudget.maxCalls
        ) {
          repairAttempts += 1
          currentInput = buildRepairInput(lastFindings, branch)
          phase = 'CHOICES_REPAIR_STRUCTURAL'
          transientErr = true
        }
        if (transientErr) continue
      }

      if (called) {
        branch = called
        const quality = validateChoiceBranchQuality(
          qualityInputFor(called, finalChapter, endingParagraphs, input),
        )
        if (quality.ok) {
          return {
            ok: true,
            source,
            branch: called,
            validationFindings: quality.findings,
            repairAttempts,
          }
        }
        // Quality failure → classify from findings and decide repair type.
        lastFindings = quality.findings
        lastReason = mapFindingToReason(quality.findings) as ChoiceBuildFailureReason
        const code = classifyChoiceProviderError(
          new Error(quality.findings.map((f) => f.code).join(' ')),
        )
        const action = choiceRetryAction(code)
        const canStructural = structuralRepairs < budget.structuralRepair
        const canQuality = qualityRepairs < budget.qualityRepair
        if (
          choiceBudget.usedCalls < choiceBudget.maxCalls &&
          ((action === 'structural_repair' && canStructural) ||
            (action === 'quality_repair' && canQuality) ||
            action === 'content_rewrite' ||
            action === 'next_provider')
        ) {
          if (action === 'structural_repair') structuralRepairs += 1
          if (action === 'quality_repair') qualityRepairs += 1
          repairAttempts += 1
          source = 'REPAIRED'
          deps.telemetry?.onChoiceRepair?.({
            chapterNumber: input.chapterNumber,
            findingCodes: lastFindings.map((f) => f.code),
            attempt: repairAttempts,
          })
          // Prefer injected repair fn when provided; else findings-aware input.
          if (deps.repairChoiceBranch && action !== 'next_provider') {
            try {
              throwIfAborted(input.signal)
              totalCalls += 1
              const repaired = await deps.repairChoiceBranch(
                { provider },
                providerInput,
                lastFindings,
                {
                  telemetryContext: input.providerContext,
                  workflowPhase: 'CHOICES_REPAIR_1',
                  signal: input.signal,
                  callBudget: providerCallBudget,
                  choiceDeadlineAtMs: choiceBudget.deadlineAtMs,
                  choiceDeadlineSource: choiceBudget.deadlineSource,
                  choicePerCandidateTimeoutMs: choiceBudget.perCandidateTimeoutMs,
                  choiceMaxCandidates: choiceBudget.maxCandidates,
                },
              )
              syncUsedCalls()
              if (repaired) {
                const rq = validateChoiceBranchQuality(
                  qualityInputFor(repaired, finalChapter, endingParagraphs, input),
                )
                if (rq.ok) {
                  return {
                    ok: true,
                    source: 'REPAIRED',
                    branch: repaired,
                    validationFindings: rq.findings,
                    repairAttempts,
                  }
                }
                lastFindings = rq.findings
                lastReason = 'REPAIR_EXHAUSTED'
              }
            } catch (err) {
              syncUsedCalls()
              const workflowReason = workflowFailureReason(err)
              if (workflowReason) {
                lastReason = workflowReason
                lastCause = err
                break
              }
              if (isAbortError(err)) throw err
              lastCause = err
              lastFindings = [...lastFindings, {
                code: 'REPAIR_PROVIDER_ERROR',
                message: err instanceof Error ? err.message : 'Choice repair provider threw.',
                severity: 'ERROR',
              }]
            }
            continue
          }
          currentInput = buildRepairInput(lastFindings, branch)
          phase = action === 'quality_repair' ? 'CHOICES_REPAIR_QUALITY' : 'CHOICES_REPAIR_STRUCTURAL'
          continue
        }
      } else {
        // Null branch (no exception): treat as a structural failure and attempt
        // one findings-aware repair within budget before giving up.
        if (lastFindings.length === 0) {
          lastFindings = [{ code: 'NULL_BRANCH', message: 'Choice branch returned null.', severity: 'ERROR' }]
        }
        lastReason = 'PROVIDER_FAILED'
        if (structuralRepairs < budget.structuralRepair && choiceBudget.usedCalls < choiceBudget.maxCalls) {
          structuralRepairs += 1
          repairAttempts += 1
          source = 'REPAIRED'
          deps.telemetry?.onChoiceRepair?.({
            chapterNumber: input.chapterNumber,
            findingCodes: lastFindings.map((f) => f.code),
            attempt: repairAttempts,
          })
          currentInput = buildRepairInput(lastFindings, branch)
          phase = 'CHOICES_REPAIR_STRUCTURAL'
          continue
        }
        lastReason = repairAttempts > 0 ? 'REPAIR_EXHAUSTED' : 'PROVIDER_FAILED'
      }

      // No further action possible within budget.
      break
    }

    if (lastReason === 'PROVIDER_FAILED' && repairAttempts > 0) {
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
    const reason: ChoiceBuildFailureReason = input.signal?.aborted
      ? 'CHOICE_PARENT_CANCELLED'
      : err && typeof err === 'object' && 'code' in err
        && (err as { code?: unknown }).code === 'GENERATION_JOB_DEADLINE_EXCEEDED'
        ? 'GENERATION_JOB_DEADLINE_EXCEEDED'
        : err && typeof err === 'object' && 'code' in err
          && (err as { code?: unknown }).code === 'CHOICE_WORKFLOW_TIMEOUT'
          ? 'CHOICE_WORKFLOW_TIMEOUT'
          : 'PROVIDER_FAILED'
    if (isAbortError(err) && reason === 'PROVIDER_FAILED') throw err
    deps.telemetry?.onChoiceFailed?.({
      chapterNumber: input.chapterNumber,
      reason,
      findingCodes: ['PROVIDER_ERROR'],
      repairAttempts,
    })
    return {
      ok: false,
      reason,
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
