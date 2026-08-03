import 'server-only'
import { createHash } from 'node:crypto'
import {
  acquireGenerationLease,
  publishChapterV2,
  releaseGenerationLease,
  mapBranchToV2Outcomes,
  type PublishOutcomeV2,
  type PublishResult,
} from './lifecycle'
import { NO_CREATIVE_DIRECTION_FINGERPRINT } from './chapter-generation-checkpoint.pure'
import type { CheckpointMutationResult } from './chapter-generation-checkpoint.pure'
import { classifyGenerationPublicationError } from './generation-job-error'
import { withGenerationSlot } from './generation-concurrency'
import {
  buildBlueprints,
  TOTAL_CHAPTERS,
  type CanonSnapshot,
  type ChapterBlueprint,
} from '@lakoku/narrative-core'
import { loadCanonSnapshot } from '@lakoku/narrative-core/server'
import { loadContinuationContextForChapter } from './continuation-context.server'
import { buildPreProseChapterBrief } from '../story-engine/pre-prose-brief'
import {
  generateChapter,
  generateChoiceBranch,
  toReaderSafe,
  assertConsumerSafe,
  scanForLeaks,
  type ThreadContext,
  type ChapterDraftParsed,
} from '@lakoku/ai-gateway'
import { selectProvider } from '@lakoku/ai-gateway/server'
import {
  recordGenerationAttempt,
  recordGenerationRuntimeFailed,
} from '@/lib/observability/server'
import { bestEffort } from '@/lib/observability/best-effort'
import {
  GenerationStageError,
  isFailureRecorded,
  markFailureRecorded,
} from '@/lib/observability/generation-stage-error'
import type { GenerationStage } from '@/lib/observability/generation-stages'
import { boundedLogId, safeErrorInfo } from '@/lib/observability/safe-error'
import type { ChapterBrief, ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { type RouteState } from '@/lib/story-engine/route-state'
import { summarizeRouteStateForPrompt } from '@/lib/story-engine/route-state'
import { createSynchronousProviderContext } from './generation-provider-context'
import type { ProviderCallContext } from '@/lib/observability/generation-provider-call.contract'
import {
  buildChoiceBranch,
  type BuildChoiceBranchInput,
  type ChoiceBuildDeps,
  type ChoiceNarrativeContext,
} from './choice-generation'
import {
  DEFAULT_CHOICE_CANDIDATE_TIMEOUT_MS,
  resolveChoiceDeadlineAt,
} from './choice-execution-budget'
import { loadStoryCreativeDirection } from '@/lib/authoring/persist-creative-direction'
import {
  boundaryMustNotInclude,
  softPreferenceHints,
  validateContentBoundaries,
} from './content-boundaries'
import {
  groundedChoiceProseFromFinalDraft,
  emptyChoiceNarrativeContext,
  choiceNarrativeContextFromReader,
} from './choice-context'
import { createAdminClient } from '@lakoku/db'
import { resolveGenerationLeaseTtlSeconds } from './generation-lease-ttl'
import { throwIfAborted } from './abort'

/**
 * Workflow generasi bab NYATA (M2→M5 disatukan) — "jalur cerita AI end-to-end".
 *
 * Rantai:
 *   lease → loadCanonSnapshot → compileContext (+retrieval_logs)
 *         → generateChapter (plan→write→Layer A→Layer B→repair)
 *         → consumer-safe guard → map draft→publish → publish_chapter (atomik).
 *
 * Sifat:
 *  - Canon READ-ONLY selama generasi (invarian dijaga di generate.ts).
 *  - Idempoten & atomik (lewat RPC yang sama dengan fake workflow M2).
 *  - Provider-agnostik: mengganti otak penulis cukup di selectProvider().
 */

/** Idempotency key stabil per (story, chapter, scope) untuk jalur nyata. */
export function realGenerationKey(storyId: string, n: number, scope: string) {
  return `gen:real:${scope}:${storyId}:${n}`
}

function legacyLeaseKey(
  path: 'real' | 'personalized',
  storyId: string,
  chapterNumber: number,
  attemptId: string,
): string {
  const attemptDigest = createHash('sha256').update(attemptId).digest('hex')
  const storyDigest = createHash('sha256').update(storyId).digest('hex')
  return `gen:${path}:lease-attempt:${storyDigest}:${chapterNumber}:${attemptDigest}`
}

/**
 * Prompt/generation contract version. Bump when the prompt contract or generation
 * policy changes in a way that must invalidate reuse of an earlier prose checkpoint.
 */
export const GENERATION_PROMPT_CONTRACT_VERSION = 3

export type RealGenerateResult =
  | {
      ok: true
      chapterNumber: number
      seq: number
      repairAttempts: number
      /** True when prose was loaded from PROSE_READY checkpoint (choices-only). */
      fromCheckpoint?: boolean
    }
  | {
      ok: false
      reason:
        | 'LEASE_HELD'
        | 'CHAPTER_EXISTS'
        | 'CANON_MISSING'
        | 'FAILED_REVIEW_REQUIRED'
        | 'TRANSIENT'
        | 'CHOICE_GENERATION_FAILED'
        | import('@/lib/runtime/choice-generation').ChoiceBuildFailureReason
        | 'CAPACITY_BUSY'
        | 'CAPACITY_TIMEOUT'
      detail?: unknown
    }

/** Ambil blueprint versi tertinggi untuk bab; fallback turunkan dari template. */
function resolveBlueprint(
  snapshot: CanonSnapshot,
  chapterNumber: number,
): ChapterBlueprint | null {
  const fromCanon = snapshot.blueprints
    .filter((b) => b.chapterNumber === chapterNumber)
    .sort((a, b) => b.version - a.version)[0]
  if (fromCanon) return fromCanon

  // Fallback: turunkan blueprint template dari spine cerita (secrets + intro).
  const plannedIntroductions: Record<number, string[]> = {}
  for (const c of snapshot.characters) {
    if (c.introducedChapter > 1) {
      ;(plannedIntroductions[c.introducedChapter] ??= []).push(c.id)
    }
  }
  try {
    const derived = buildBlueprints({
      storyId: snapshot.storyId,
      secrets: snapshot.secrets,
      plannedIntroductions,
    })
    return derived.find((b) => b.chapterNumber === chapterNumber) ?? null
  } catch {
    return null // bab di luar rentang template
  }
}

/** Minimal chapter brief for standard/onboarding stories (no story_generation_contracts row). */
function syntheticChapterBrief(
  storyId: string,
  chapterNumber: number,
  draft: ChapterDraftParsed,
  narrativeContext?: ChoiceNarrativeContext,
  directionHints?: { mustNotInclude?: string[]; softHints?: string[] },
): ChapterBrief {
  const remaining = Math.max(0, TOTAL_CHAPTERS - chapterNumber)
  // Chapter draft has prose only; goal/phase derived for choice provider brief.
  let chapterGoal = draft.title
  if (directionHints?.softHints?.length) {
    chapterGoal = `${chapterGoal} (${directionHints.softHints.slice(0, 2).join('; ')})`.slice(0, 1200)
  }
  const phase =
    chapterNumber <= 10
      ? 'setup'
      : chapterNumber <= 25
        ? 'rising'
        : chapterNumber <= 40
          ? 'complication'
          : 'resolution'
  const empty: string[] = []
  const endingRunway =
    chapterNumber >= 50
      ? 'final'
      : chapterNumber >= 45
        ? 'payoff'
        : chapterNumber >= 40
          ? 'convergence'
          : chapterNumber >= 30
            ? 'closure-emphasis'
            : 'expansion'

  // Use real reader context when available; fall back to generic placeholder.
  const hasRealContext = narrativeContext && (
    narrativeContext.choiceHistory.length > 0
    || (narrativeContext.routeState.truth ?? 0) !== 0
    || (narrativeContext.routeState.risk ?? 0) !== 0
    || (narrativeContext.routeState.secrecy ?? 0) !== 0
    || (narrativeContext.routeState.empathy ?? 0) !== 0
    || Object.keys(narrativeContext.routeState.trust ?? {}).length > 0
    || Object.keys(narrativeContext.routeState.flags ?? {}).length > 0
    || (narrativeContext.routeState.evidence ?? []).length > 0
    || narrativeContext.lockedEndingKey != null
  )

  const routeStateSummary = hasRealContext
    ? summarizeRouteStateForChapterBrief(narrativeContext!.routeState)
    : 'Awal perjalanan; belum ada bias rute kuat.'

  const choiceHistorySummary = hasRealContext && narrativeContext!.choiceHistory.length > 0
    ? `Pembaca sudah membuat ${narrativeContext!.choiceHistory.length} pilihan.${
        narrativeContext!.previousChoice
          ? ` Pilihan terakhir: ${narrativeContext!.previousChoice.label.slice(0, 80)}`
          : ''
      }`
    : 'Belum ada pilihan sebelumnya.'

  const lockedEndingKey = narrativeContext?.lockedEndingKey ?? null
  const mustNotInclude = directionHints?.mustNotInclude ?? empty

  return {
    storyId,
    chapterNumber,
    totalChapters: 50,
    phase,
    remainingChapters: remaining,
    chapterGoal,
    mustInclude: empty,
    mustNotInclude,
    mustNotReveal: empty,
    routeStateSummary,
    choiceHistorySummary,
    plotDebtsToProgress: empty,
    plotDebtsToClose: empty,
    allowedNewThread: chapterNumber < 40,
    allowedMajorNewConflict: chapterNumber < 45,
    endingRunway,
    lockedEndingKey,
    allowsChoices: chapterNumber < TOTAL_CHAPTERS,
    finalChapter: chapterNumber >= TOTAL_CHAPTERS,
    goals: [chapterGoal],
    routeSummary: routeStateSummary,
    debtsToProgress: empty,
    debtsToClose: empty,
    allowMajorNewConflict: chapterNumber < 45,
    allowNewThread: chapterNumber < 40,
    lockEnding: lockedEndingKey !== null,
    endingKey: lockedEndingKey,
    previousChoiceSummary: choiceHistorySummary,
  }
}

/** Concise route state summary for synthetic chapter briefs (reuses canonical summarizer). */
function summarizeRouteStateForChapterBrief(routeState: RouteState): string {
  return summarizeRouteStateForPrompt(routeState)
}

/**
 * Attempt to load reader narrative context from reader_states for the standard flow.
 * Returns loaded context when reader row exists; otherwise returns empty defaults.
 *
 * Silent fallback: no reader row is NOT an error — it means the story is truly a
 * fresh standard/onboarding playthrough.
 */
async function loadStandardNarrativeContext(
  userId: string,
  storyId: string,
): Promise<ChoiceNarrativeContext> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('reader_states')
      .select('route_state, choice_history, locked_ending_key')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .maybeSingle()
    if (error || !data) return emptyChoiceNarrativeContext()
    return choiceNarrativeContextFromReader({
      route_state: (data as { route_state: unknown }).route_state,
      choice_history: (data as { choice_history?: ChoiceHistoryEntry[] }).choice_history,
      locked_ending_key: (data as { locked_ending_key?: string | null }).locked_ending_key,
    })
  } catch {
    // DB down or table missing leaves fresh standard/onboarding context empty.
    return emptyChoiceNarrativeContext()
  }
}

/** DI dependencies injected for standard choice build path. */
function standardChoiceDeps(correlationId?: string): ChoiceBuildDeps {
  return {
    selectProvider: selectProvider as ChoiceBuildDeps['selectProvider'],
    generateChoiceBranch: generateChoiceBranch as ChoiceBuildDeps['generateChoiceBranch'],
    telemetry: {
      onChoiceRepair: ({ chapterNumber, findingCodes, attempt }) => {
        console.log('GENERATION_CHOICES_REPAIR', {
          chapterNumber,
          correlationId: correlationId ?? null,
          findingCodes: findingCodes.slice(0, 12),
          attempt,
        })
      },
      onChoiceFailed: ({ chapterNumber, reason, findingCodes, repairAttempts }) => {
        console.log('GENERATION_CHOICES_TERMINAL', {
          chapterNumber,
          correlationId: correlationId ?? null,
          reason,
          findingCodes: findingCodes.slice(0, 12),
          repairAttempts,
        })
      },
    },
  }
}

/**
 * LLM choices grounded di prose bab.
 * Phase 5: returns null on failure (no hard-coded generic fallback publish).
 */
async function buildChoices(
  snapshot: CanonSnapshot,
  draft: ChapterDraftParsed,
  chapterNumber: number,
  providerContext: ProviderCallContext,
  narrativeContextOverride?: ChoiceNarrativeContext,
  signal?: AbortSignal,
  providerRuntime?: import('@/lib/ai-gateway/provider').ProviderRuntime,
  choiceExecutionBudget?: import('@/lib/runtime/choice-execution-budget').ChoiceExecutionBudget,
): Promise<{
  ok: true
  choicePrompt: string
  choices: { id: string; label: string }[]
  outcomes: PublishOutcomeV2[]
  repairAttempts: number
  source: 'INITIAL' | 'REPAIRED'
} | {
  ok: false
  reason: import('@/lib/runtime/choice-generation').ChoiceBuildFailureReason
  validationFindings: Array<{ code: string; message: string; severity: string }>
  repairAttempts: number
}> {
  // Resolve narrative context: override > DB reader state > empty defaults.
  const narrativeContext: ChoiceNarrativeContext = narrativeContextOverride
    ?? await loadStandardNarrativeContext(
      providerContext.userId,
      snapshot.storyId,
    )

  // Phase 2: choice grounding uses final repaired draft only.
  let choiceDirection: Awaited<ReturnType<typeof loadStoryCreativeDirection>> = null
  try {
    choiceDirection = await loadStoryCreativeDirection(snapshot.storyId)
  } catch {
    choiceDirection = null
  }
  const brief = syntheticChapterBrief(
    snapshot.storyId,
    chapterNumber,
    draft,
    narrativeContext,
    {
      mustNotInclude: boundaryMustNotInclude(choiceDirection),
      softHints: softPreferenceHints(choiceDirection),
    },
  )
  const { finalChapter, endingParagraphs } = groundedChoiceProseFromFinalDraft(draft)
  const deps = standardChoiceDeps(providerContext.correlationId)
  const activeCharacters = snapshot.characters
    .slice(0, 24)
    .map((c) => ({ id: c.id, name: c.canonicalName ?? c.id }))
  const activeThreads = snapshot.threads
    .slice(0, 24)
    .map((th) => ({
      id: th.id,
      summary: ('title' in th && typeof th.title === 'string' ? th.title : th.id),
    }))
  const { AGENCY_LABEL, RELATIONSHIP_LABEL } = await import('@/lib/onboarding/role-catalog')
  const { CONTENT_BOUNDARY_LABEL } = await import('@/lib/taste-profile/catalog')
  const input: BuildChoiceBranchInput = {
    snapshot,
    draft,
    chapterNumber,
    chapterBrief: brief,
    finalChapter,
    lastParagraphs: endingParagraphs,
    routeState: narrativeContext.routeState,
    choiceHistory: narrativeContext.choiceHistory,
    previousChoice: narrativeContext.previousChoice,
    lockedEndingKey: narrativeContext.lockedEndingKey,
    providerContext,
    signal,
    providerRuntime,
    choiceExecutionBudget,
    activeCharacters,
    activeThreads,
    creativeDirectionHints: choiceDirection
      ? {
          relationshipFocus:
            RELATIONSHIP_LABEL[choiceDirection.storySetup.relationshipFocus] ??
            choiceDirection.storySetup.relationshipFocus,
          agencyStyle:
            AGENCY_LABEL[choiceDirection.storySetup.agencyStyle] ??
            choiceDirection.storySetup.agencyStyle,
          hardBoundaryLabels: choiceDirection.hardBoundaries.map(
            (id) => CONTENT_BOUNDARY_LABEL[id] ?? id,
          ),
        }
      : undefined,
  }

  const result = await buildChoiceBranch(deps, input)

  if (result.ok) {
    return {
      ok: true,
      choicePrompt: result.branch.choicePrompt,
      choices: result.branch.choices.map((c) => ({
        id: c.id,
        label: c.label,
        ...(c.hint ? { hint: c.hint } : {}),
      })),
      outcomes: mapBranchToV2Outcomes(result.branch, chapterNumber),
      repairAttempts: result.repairAttempts,
      source: result.source,
    }
  }

  // Phase 5: no silent generic fallback on production path.
  return {
    ok: false,
    reason: result.reason,
    validationFindings: result.validationFindings,
    repairAttempts: result.repairAttempts,
  }
}

/**
 * Jalankan satu putaran generasi bab nyata dan publish secara atomik.
 * Aman dipanggil berulang (idempoten); pada kegagalan review, lease dilepas
 * agar retry tidak terblokir hingga TTL habis.
 */
export interface StandardGenerateInput {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
  /** Durable attempt id; used for checkpoint identity. Defaults to correlationId. */
  attemptId?: string | null
  /**
   * Pilihan di Bab N−1 yang memicu generasi Bab N. Sumber kebenaran untuk
   * memilih entry reader_states.choice_history yang tepat (bukan history[last]).
   */
  triggerChoiceId?: string | null
  /**
   * Worker path: reuse job lease + fenced publish. Skip own acquireGenerationLease.
   * Propagate signal into provider-facing work where possible.
   */
  jobContext?: import('@/lib/runtime/generation-job-execution').GenerationJobExecutionContext | null
  options?: import('@/lib/runtime/generation-job-execution').GenerationWorkerOptions
}

export async function generateNextChapterReal(
  input: StandardGenerateInput,
): Promise<RealGenerateResult> {
  return withGenerationSlot(
    {
      userId: input.userId,
      storyId: input.storyId,
      chapterNumber: input.chapterNumber,
    },
    async ({ waitMs }) => {
      if (waitMs > 0) {
        console.log('GENERATION_CAPACITY_WAIT_DONE', {
          storyId: input.storyId,
          chapterNumber: input.chapterNumber,
          correlationId: input.correlationId,
          waitMs,
          path: 'standard',
        })
      }
      return generateNextChapterRealInner(input)
    },
    (reason, meta) => {
      console.log('GENERATION_CAPACITY_REJECTED', {
        storyId: input.storyId,
        chapterNumber: input.chapterNumber,
        correlationId: input.correlationId,
        reason,
        path: 'standard',
        ...meta,
      })
      return { ok: false, reason, detail: meta }
    },
    input.jobContext?.signal,
  )
}

async function generateNextChapterRealInner(
  input: StandardGenerateInput,
): Promise<RealGenerateResult> {
  const { storyId, userId, chapterNumber, correlationId } = input
  const attemptId = input.attemptId?.trim() || correlationId
  const jobContext = input.jobContext ?? null
  const startedAt = Date.now()
  let stage: GenerationStage = 'ACQUIRE_LEASE'
  let leaseId: string | null = null
  let leaseReleased = false
  let fromCheckpoint = false
  let proseFingerprintUsed: string | null = null
  let checkpointAttemptId = attemptId

  const checkpointMutationSucceeded = (
    result: CheckpointMutationResult,
  ): boolean => result.ok === true

  if (jobContext?.signal?.aborted) {
    return { ok: false, reason: 'CAPACITY_TIMEOUT', detail: { reason: 'ABORT_SIGNAL' } }
  }

  const providerContext = createSynchronousProviderContext({
    userId,
    storyId,
    chapterNumber,
    generationKind: 'standard',
    correlationId,
  })

  /**
   * On worker path the job lease is owned by the worker (heartbeat/finish).
   * Do not release it from the generator — finish/fenced-publish handle that.
   * Legacy path still releases its own lease on failure.
   */
  const releaseLeaseOnce = async () => {
    if (jobContext) return
    if (!leaseId || leaseReleased) return
    try {
      await releaseGenerationLease({ storyId, leaseId })
      leaseReleased = true
    } catch (releaseErr) {
      const info = safeErrorInfo(releaseErr)
      console.error('GENERATION_LEASE_RELEASE_FAILED', {
        storyId,
        chapterNumber,
        correlationId,
        stage,
        errorName: info.errorName,
        errorMessage: info.errorMessage,
      })
    }
  }

  type UnifiedPublishResult =
    | { ok: true; chapter_number: number; seq: number; jobId?: string }
    | {
        ok: false
        reason:
          | 'LEASE_HELD'
          | 'CHAPTER_EXISTS'
          | 'FAILED_REVIEW_REQUIRED'
          | 'TRANSIENT'
          | 'CAPACITY_TIMEOUT'
      }

  const publishUnified = async (args: {
    title: string
    paragraphs: string[]
    choicePrompt: string | null
    choices: unknown
    outcomes: PublishOutcomeV2[]
    idempotencyKey: string
  }): Promise<UnifiedPublishResult> => {
    if (jobContext?.signal?.aborted) {
      return { ok: false, reason: 'CAPACITY_TIMEOUT' }
    }
    if (jobContext) {
      const { publishGenerationJobChapterV4 } = await import('@/lib/runtime/generation-jobs')
      try {
        const published = await publishGenerationJobChapterV4({
          jobId: jobContext.jobId,
          workerId: jobContext.workerId,
          claimToken: jobContext.claimToken,
          leaseId: jobContext.leaseId,
          storyId,
          chapterNumber,
          title: args.title,
          paragraphs: args.paragraphs,
          choicePrompt: args.choicePrompt,
          choices: Array.isArray(args.choices)
            ? args.choices
            : args.choices == null
              ? null
              : [args.choices],
          outcomes: args.outcomes,
          endingLock: null,
          closures: [],
        })
        // Fenced publish marks job SUCCEEDED + releases bound lease.
        leaseReleased = true
        return {
          ok: true,
          chapter_number: published.chapterNumber,
          seq: published.seq,
          jobId: published.jobId,
        }
      } catch (err) {
        throwIfAborted(jobContext.signal)
        const classification = classifyGenerationPublicationError(err)
        const info = safeErrorInfo(err)
        console.error('GENERATION_FENCED_PUBLISH_FAILED', {
          storyId,
          chapterNumber,
          jobId: jobContext.jobId,
          errorCode: classification.code,
          errorName: info.errorName.slice(0, 100),
        })
        if (classification.kind === 'chapter_exists') {
          return { ok: false, reason: 'CHAPTER_EXISTS' }
        }
        if (classification.kind === 'ownership_lost') {
          return { ok: false, reason: 'LEASE_HELD' }
        }
        if (classification.kind === 'transient') {
          return { ok: false, reason: 'TRANSIENT' }
        }
        return { ok: false, reason: 'FAILED_REVIEW_REQUIRED' }
      }
    }

    const published: PublishResult = await publishChapterV2({
      storyId,
      chapterNumber,
      title: args.title,
      paragraphs: args.paragraphs,
      choicePrompt: args.choicePrompt,
      choices: args.choices as never,
      outcomes: args.outcomes,
      leaseId: leaseId!,
      idempotencyKey: args.idempotencyKey,
    })
    if (published.ok) {
      await releaseLeaseOnce()
      return {
        ok: true,
        chapter_number: published.chapter_number,
        seq: published.seq,
      }
    }
    // PublishResult failure is only CHAPTER_EXISTS today.
    return { ok: false, reason: 'CHAPTER_EXISTS' }
  }

  const logRuntimeFailure = async (errorCode: string, err: unknown) => {
    const info = safeErrorInfo(err)
    console.error('GENERATION_RUNTIME_FAILED', {
      storyId,
      chapterNumber,
      correlationId,
      stage,
      errorCode,
      errorName: info.errorName,
      errorMessage: info.errorMessage,
      errorStack: info.errorStack,
      elapsedMs: Date.now() - startedAt,
    })
    await recordGenerationRuntimeFailed({
      storyId,
      chapter: chapterNumber,
      correlationId,
      stage,
      errorCode,
      errorName: info.errorName,
    })
  }

  // 1) Lease. Worker path reuses job lease (no second acquire). Legacy acquires own.
  stage = 'ACQUIRE_LEASE'
  if (jobContext) {
    leaseId = jobContext.leaseId
    console.log('GENERATION_JOB_LEASE_REUSED', {
      storyId,
      chapterNumber,
      correlationId,
      jobId: jobContext.jobId,
      attemptNumber: jobContext.attemptNumber,
    })
  } else {
    const ttlSeconds = await resolveGenerationLeaseTtlSeconds()
    const lease = await acquireGenerationLease({
      storyId,
      chapterNumber,
      holder: 'story-generation',
      // Multi-LLM plan→write→repair can exceed 2 minutes wall on VPS.
      // TTL from generation_policy (clamped 60..1800).
      ttlSeconds,
      idempotencyKey: legacyLeaseKey('real', storyId, chapterNumber, attemptId),
    })
    if (!lease.ok) return { ok: false, reason: lease.reason }
    leaseId = lease.lease_id
  }

  try {
    // 1b) Choice-only resume: load PROSE_READY checkpoint when available.
    const {
      loadUsableProseCheckpoint,
      persistProseReadyCheckpoint,
      markCheckpointStatus,
      draftFromCheckpoint,
      proseFingerprint,
    } = await import('@/lib/runtime/chapter-generation-checkpoint')

    const reconcilePublishedCheckpoint = async () => {
      try {
        const mutation = await markCheckpointStatus({
          storyId,
          chapterNumber,
          attemptId: checkpointAttemptId,
          status: 'PUBLISHED',
          jobContext,
        })
        if (checkpointMutationSucceeded(mutation)) return
        console.log('CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED', {
          storyId: boundedLogId(storyId),
          chapterNumber,
          correlationId: boundedLogId(correlationId),
          jobId: boundedLogId(jobContext?.jobId),
          checkpointAttemptId: boundedLogId(checkpointAttemptId),
          result: 'NOT_UPDATED',
          errorCode: 'CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED',
        })
      } catch {
        console.log('CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED', {
          storyId: boundedLogId(storyId),
          chapterNumber,
          correlationId: boundedLogId(correlationId),
          jobId: boundedLogId(jobContext?.jobId),
          checkpointAttemptId: boundedLogId(checkpointAttemptId),
          result: 'THREW',
          errorCode: 'CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED',
        })
      }
    }

    // 2) Muat canon (read-only) resolved sampai bab target.
    stage = 'LOAD_CANON'
    const snapshot = await loadCanonSnapshot(storyId, chapterNumber)
    const blueprint = resolveBlueprint(snapshot, chapterNumber)
    if (!blueprint || snapshot.characters.length === 0) {
      await releaseLeaseOnce()
      console.log('GENERATION_CANON_MISSING', {
        storyId,
        chapterNumber,
        correlationId,
        stage,
        elapsedMs: Date.now() - startedAt,
      })
      return { ok: false, reason: 'CANON_MISSING' }
    }

    // 2b) Load story creative direction snapshot (best-effort; neutral if missing).
    let creativeDirection: Awaited<ReturnType<typeof loadStoryCreativeDirection>> = null
    try {
      const { isStoryCreativeDirectionV1Enabled } = await import('@/lib/feature-flags')
      if (isStoryCreativeDirectionV1Enabled()) {
        creativeDirection = await loadStoryCreativeDirection(storyId)
      }
    } catch {
      creativeDirection = null
    }

    // Stable fingerprint of the creative direction that grounded this prose.
    // Changes when direction changes → invalidates checkpoint reuse (P1-2).
    const creativeDirectionFingerprint = creativeDirection
      ? (await import('node:crypto')).createHash('sha256')
          .update(JSON.stringify(creativeDirection))
          .digest('hex')
          .slice(0, 32)
      : NO_CREATIVE_DIRECTION_FINGERPRINT

    // 3.5) Load continuation context & build pre-prose brief (fail-closed for N > 1)
    const contRes = await loadContinuationContextForChapter({
      storyId,
      chapterNumber,
      triggerChoiceId: input.triggerChoiceId,
    })

    if (!contRes.ok) {
      await releaseLeaseOnce()
      console.error('CONTINUATION_CONTEXT_LOAD_FAILED', {
        storyId,
        chapterNumber,
        kind: contRes.kind,
        detail: contRes.detail,
      })
      if (contRes.kind === 'TRANSIENT') {
        return { ok: false, reason: 'TRANSIENT', detail: contRes.detail }
      }
      return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: contRes.detail }
    }

    const continuation = contRes.continuation
    const preProseBrief = buildPreProseChapterBrief({
      storyId,
      chapterNumber,
      snapshot,
      blueprint,
      continuation,
      chapterBrief: null,
    })

    // 4) Konteks thread untuk lifecycle check (state hidup di canon, bukan draft).
    const threadContext: ThreadContext = {
      threads: snapshot.threads,
      advancedThreadIds: [],
      opensNewThread: false,
    }

    const canonVersionProxyNow = snapshot.blueprints.reduce(
      (max, b) => Math.max(max, b.version ?? 0),
      0,
    )
    const existingCheckpoint = await loadUsableProseCheckpoint({
      storyId,
      chapterNumber,
      // Prefer any fully compatible checkpoint for story+chapter on explicit retry.
      attemptId: null,
      freshness: {
        canonVersion: canonVersionProxyNow,
        blueprintVersion: blueprint.version ?? null,
        directionFingerprint: creativeDirectionFingerprint,
        generationMode: 'standard',
        generationPolicyVersion: GENERATION_PROMPT_CONTRACT_VERSION,
        promptContractVersion: GENERATION_PROMPT_CONTRACT_VERSION,
        requireJobProvenance: jobContext != null,
        jobId: jobContext?.jobId ?? null,
        jobAttemptNumber: jobContext?.attemptNumber ?? null,
      },
      jobContext,
    })

    // 5) Prose: resume from checkpoint OR generate + validate.
    type ProseResult = {
      status: string
      draft?: ChapterDraftParsed | null
      attempts: number
      findings: Array<{ severity?: string; code?: string; message?: string }>
      failedLayer?: string | null
      reason?: string
    }
    let result: ProseResult
    let draft: ChapterDraftParsed

    const usableCheckpoint = existingCheckpoint

    if (usableCheckpoint) {
      const existingCheckpoint = usableCheckpoint
      fromCheckpoint = true
      proseFingerprintUsed = existingCheckpoint.proseFingerprint
      checkpointAttemptId = existingCheckpoint.attemptId
      const resumed = draftFromCheckpoint(existingCheckpoint) as unknown as ChapterDraftParsed
      draft = resumed
      result = {
        status: 'PUBLISHED',
        draft: resumed,
        attempts: existingCheckpoint.proseAttemptCount,
        findings: [],
      }
      const runningChoices = await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'RUNNING_CHOICES',
        choiceAttemptCount: existingCheckpoint.choiceAttemptCount + 1,
        jobContext,
      })
      if (!checkpointMutationSucceeded(runningChoices)) {
        await releaseLeaseOnce()
        console.error('CHECKPOINT_STATUS_UPDATE_FAILED', {
          storyId, chapterNumber, correlationId, attemptId: checkpointAttemptId,
          status: 'RUNNING_CHOICES', errorCode: 'CHECKPOINT_STATUS_UPDATE_FAILED',
        })
        return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { checkpointMutation: runningChoices } }
      }
      console.log('GENERATION_CHOICES_ONLY_RESUME', {
        storyId,
        chapterNumber,
        correlationId,
        attemptId: checkpointAttemptId,
        proseFingerprint: proseFingerprintUsed,
        choiceAttemptCount: existingCheckpoint.choiceAttemptCount + 1,
        elapsedMs: Date.now() - startedAt,
      })
    } else {
      stage = 'GENERATE_PROSE'
      result = await generateChapter(
        { provider: await selectProvider(providerContext) },
        {
          snapshot,
          blueprint,
          chapterNumber,
          continuation,
          brief: preProseBrief,
          threadContext,
          executionOptions: {
            telemetryContext: providerContext,
            workflowPhase: 'CHAPTER_PROSE_INITIAL',
            signal: jobContext?.signal,
            ...(input.options?.providerRuntime === undefined
              ? {}
              : { providerRuntime: input.options.providerRuntime }),
          },
        },
      )
      // Provider may ignore abort; never persist checkpoint/choices/publish after cancel.
      throwIfAborted(jobContext?.signal)

      stage = 'VALIDATE_PROSE'
      if (result.status !== 'PUBLISHED' || !result.draft) {
        await releaseLeaseOnce()
        stage = 'RECORD_TERMINAL_ATTEMPT'
        await recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'REVIEW_REQUIRED',
          repairAttempts: result.attempts,
          findings: result.findings as never,
          correlationId,
        })
        const findingCodes = result.findings
          .slice(0, 12)
          .map((f) => `${f.severity}:${f.code}`)
        console.log('GENERATION_REVIEW_REQUIRED', {
          storyId,
          chapterNumber,
          correlationId,
          failedLayer: result.failedLayer ?? null,
          repairAttempts: result.attempts,
          findingCodes,
          elapsedMs: Date.now() - startedAt,
        })
        return {
          ok: false,
          reason: 'FAILED_REVIEW_REQUIRED',
          detail: {
            failedLayer: result.failedLayer,
            findings: result.findings,
            reason: result.reason,
          },
        }
      }

      draft = result.draft

      // 5b) Hard content-boundary check (prompt-only is insufficient).
      const proseText = [draft.title, ...(draft.paragraphs ?? [])].join('\n')
      const boundaryFindings = validateContentBoundaries({
        prose: proseText,
        direction: creativeDirection,
        chapterNumber,
      })
      if (boundaryFindings.some((f) => f.severity === 'CRITICAL')) {
        await releaseLeaseOnce()
        stage = 'RECORD_TERMINAL_ATTEMPT'
        await recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'REVIEW_REQUIRED',
          repairAttempts: result.attempts,
          findings: boundaryFindings.map((f) => ({
            code: f.code,
            severity: f.severity,
            message: f.message,
          })),
          correlationId,
        }).catch(() => undefined)
        console.log('GENERATION_BOUNDARY_VIOLATION', {
          storyId,
          chapterNumber,
          correlationId,
          codes: boundaryFindings.map((f) => f.code),
          elapsedMs: Date.now() - startedAt,
        })
        return {
          ok: false,
          reason: 'FAILED_REVIEW_REQUIRED',
          detail: {
            failedLayer: 'BOUNDARY',
            findings: boundaryFindings,
            reason: 'Hard content boundary violation',
          },
        }
      }

      // Persist PROSE_READY before choices so choice failure does not discard prose.
      // Carry provenance so a stale checkpoint (canon/blueprint/mode changed) is
      // not reused after the fact (P1-2).
      const canonVersionProxy = snapshot.blueprints.reduce(
        (max, b) => Math.max(max, b.version ?? 0),
        0,
      )
      const saved = await persistProseReadyCheckpoint({
        storyId,
        chapterNumber,
        attemptId,
        correlationId,
        title: draft.title,
        paragraphs: draft.paragraphs ?? [],
        proseAttemptCount: result.attempts,
        auditSignals: null,
        auditSignalsVersion: null,
        canonVersion: canonVersionProxy,
        blueprintVersion: blueprint.version ?? null,
        directionFingerprint: creativeDirectionFingerprint,
        generationMode: 'standard',
        generationPolicyVersion: GENERATION_PROMPT_CONTRACT_VERSION,
        promptContractVersion: GENERATION_PROMPT_CONTRACT_VERSION,
        jobId: jobContext?.jobId ?? null,
        jobAttemptNumber: jobContext?.attemptNumber ?? null,
        jobContext,
      })
      if (saved.ok !== true) {
        await releaseLeaseOnce()
        console.error('CHECKPOINT_STATUS_UPDATE_FAILED', {
          storyId, chapterNumber, correlationId, attemptId,
          status: 'PROSE_READY', errorCode: 'CHECKPOINT_STATUS_UPDATE_FAILED',
        })
        return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { checkpointMutation: saved } }
      }
      proseFingerprintUsed = proseFingerprint(draft.title, draft.paragraphs ?? [])
      checkpointAttemptId = saved.checkpointAttemptId

      const runningChoices = await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'RUNNING_CHOICES',
        choiceAttemptCount: 1,
        jobContext,
      })
      if (!checkpointMutationSucceeded(runningChoices)) {
        await releaseLeaseOnce()
        console.error('CHECKPOINT_STATUS_UPDATE_FAILED', {
          storyId, chapterNumber, correlationId, attemptId: checkpointAttemptId,
          status: 'RUNNING_CHOICES', errorCode: 'CHECKPOINT_STATUS_UPDATE_FAILED',
        })
        return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { checkpointMutation: runningChoices } }
      }
    }

    // 6) Boundary consumer-safe: tak ada istilah internal yang bocor ke pembaca.
    stage = 'CONSUMER_SAFE'
    const readerSafe = toReaderSafe(draft)
    assertConsumerSafe(readerSafe)

    // 7) Cabang pilihan LLM (grounded di prosa bab / checkpoint).
    // Phase 5: no silent generic fallback — failure releases lease and fails terminal.
    stage = 'BUILD_CHOICE_CONTEXT'
    stage = 'BUILD_CHOICES'
    stage = 'GENERATE_CHOICES_INITIAL'
    throwIfAborted(jobContext?.signal)
    const resolvedChoiceDeadline = jobContext
      ? resolveChoiceDeadlineAt({
          nowMs: Date.now(),
          parentDeadlineAtMs: jobContext.deadlineAtMs,
        })
      : null
    const branch = await buildChoices(
      snapshot,
      draft,
      chapterNumber,
      providerContext,
      undefined,
      jobContext?.signal,
      input.options?.providerRuntime,
      jobContext && resolvedChoiceDeadline ? {
        usedCalls: 0,
        maxCalls: 5,
        maxCandidates: 3,
        perCandidateTimeoutMs: DEFAULT_CHOICE_CANDIDATE_TIMEOUT_MS,
        deadlineAtMs: resolvedChoiceDeadline.deadlineAtMs,
        deadlineSource: resolvedChoiceDeadline.source,
      } : undefined,
    )
    throwIfAborted(jobContext?.signal)
    if (!branch.ok) {
      // Final chapter: publish ending without choices (Phase 7 also covers this).
      if (branch.reason === 'FINAL_CHAPTER') {
        stage = 'PUBLISH_CHAPTER'
        const publishedEnding = await publishUnified({
          title: readerSafe.title,
          paragraphs: readerSafe.paragraphs,
          choicePrompt: null,
          choices: null,
          outcomes: [],
          idempotencyKey: realGenerationKey(storyId, chapterNumber, 'publish'),
        })
        if (!publishedEnding.ok) {
          await releaseLeaseOnce()
          return { ok: false, reason: publishedEnding.reason }
        }
        if (jobContext && publishedEnding.jobId !== jobContext.jobId) {
          return { ok: false, reason: 'FAILED_REVIEW_REQUIRED' }
        }
        if (!jobContext) await reconcilePublishedCheckpoint()
        stage = 'RECORD_TERMINAL_ATTEMPT'
        await recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'PUBLISHED',
          repairAttempts: result.attempts,
          findings: result.findings as never,
          correlationId,
        }).catch(() => undefined)
        stage = 'COMPLETE'
        return {
          ok: true,
          chapterNumber: publishedEnding.chapter_number,
          seq: publishedEnding.seq,
          repairAttempts: result.attempts,
          fromCheckpoint,
        }
      }

      // Keep PROSE_READY so retry runs choices only.
      const retryCheckpoint = await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'CHOICES_RETRY_WAIT',
        jobContext,
      })
      if (!checkpointMutationSucceeded(retryCheckpoint)) {
        await releaseLeaseOnce()
        console.error('CHECKPOINT_STATUS_UPDATE_FAILED', {
          storyId, chapterNumber, correlationId, attemptId: checkpointAttemptId,
          status: 'CHOICES_RETRY_WAIT', errorCode: 'CHECKPOINT_STATUS_UPDATE_FAILED',
        })
        return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { checkpointMutation: retryCheckpoint } }
      }
      await releaseLeaseOnce()
      stage = 'RECORD_TERMINAL_ATTEMPT'
      const { mapChoiceFailureReasonToErrorCode } = await import(
        '@/lib/observability/generation-stages'
      )
      console.log('GENERATION_CHOICES_FAILED', {
        storyId,
        chapterNumber,
        correlationId,
        attemptId: checkpointAttemptId,
        generationKind: 'standard',
        fromCheckpoint,
        proseFingerprint: proseFingerprintUsed,
        stage: branch.repairAttempts > 0 ? 'VALIDATE_CHOICES_FINAL' : 'VALIDATE_CHOICES_INITIAL',
        errorCode: mapChoiceFailureReasonToErrorCode(branch.reason),
        reason: branch.reason,
        findingCodes: branch.validationFindings.map((f) => f.code).slice(0, 12),
        repairAttempts: branch.repairAttempts,
        elapsedMs: Date.now() - startedAt,
      })
      await recordGenerationAttempt({
        storyId,
        chapter: chapterNumber,
        outcome: 'REVIEW_REQUIRED',
        repairAttempts: result.attempts + branch.repairAttempts,
        findings: result.findings as never,
        correlationId,
      }).catch(() => undefined)
      return {
        ok: false,
        reason: branch.reason === 'CHOICE_WORKFLOW_TIMEOUT'
          || branch.reason === 'GENERATION_JOB_DEADLINE_EXCEEDED'
          || branch.reason === 'CHOICE_PARENT_CANCELLED'
          ? branch.reason
          : 'CHOICE_GENERATION_FAILED',
        detail: {
          choiceReason: branch.reason,
          findingCodes: branch.validationFindings.map((f) => f.code),
          repairAttempts: branch.repairAttempts,
          fromCheckpoint,
          proseFingerprint: proseFingerprintUsed,
          attemptId: checkpointAttemptId,
        },
      }
    }

    stage = branch.source === 'REPAIRED' ? 'VALIDATE_CHOICES_FINAL' : 'VALIDATE_CHOICES'
    const leakInChoices = [
      branch.choicePrompt,
      ...branch.choices.map((c) => c.label),
      ...branch.choices.flatMap((c) => ('hint' in c && c.hint ? [String(c.hint)] : [])),
      ...branch.outcomes.flatMap((o) => o.consequence),
    ]
      .flatMap(scanForLeaks)
    if (leakInChoices.length) {
      await releaseLeaseOnce()
      const err = new GenerationStageError(
        `Kebocoran istilah internal pada cabang pilihan: ${leakInChoices.join(', ')}`,
        {
          errorCode: 'CHOICE_LEAK_REJECTED',
          stage,
          alreadyRecorded: true,
        },
      )
      await logRuntimeFailure('CHOICE_LEAK_REJECTED', err)
      markFailureRecorded(err)
      throw err
    }

    // 8) Publish atomik (legacy publish_chapter OR fenced job publish).
    stage = 'PUBLISH_CHAPTER'
    const publishKey = proseFingerprintUsed
      ? realGenerationKey(
          storyId,
          chapterNumber,
          `publish:${proseFingerprintUsed.slice(0, 16)}`,
        )
      : realGenerationKey(storyId, chapterNumber, 'publish')
    const published = await publishUnified({
      title: readerSafe.title,
      paragraphs: readerSafe.paragraphs,
      choicePrompt: branch.choicePrompt,
      choices: branch.choices,
      outcomes: branch.outcomes,
      idempotencyKey: publishKey,
    })

    if (!published.ok) {
      await releaseLeaseOnce()
      // Keep prose checkpoint for retry after publish conflict if chapter not created.
      const retryCheckpoint = await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'CHOICES_RETRY_WAIT',
        jobContext,
      })
      if (!checkpointMutationSucceeded(retryCheckpoint)) {
        return {
          ok: false,
          reason: 'FAILED_REVIEW_REQUIRED',
          detail: { checkpointMutation: retryCheckpoint },
        }
      }
      console.log('GENERATION_PUBLISH_CONFLICT', {
        storyId,
        chapterNumber,
        correlationId,
        reason: published.reason,
        fromCheckpoint,
        jobId: jobContext?.jobId ?? null,
        elapsedMs: Date.now() - startedAt,
      })
      return { ok: false, reason: published.reason }
    }

    if (jobContext && published.jobId !== jobContext.jobId) {
      return { ok: false, reason: 'FAILED_REVIEW_REQUIRED' }
    }
    if (!jobContext) await reconcilePublishedCheckpoint()

    // Telemetri konsistensi (T8.1) — attempt sukses. Dipancarkan SETELAH publish.
    // Best-effort only: never convert publish success into workflow failure.
    stage = 'RECORD_TERMINAL_ATTEMPT'
    await bestEffort(
      'GENERATION_ATTEMPT_TELEMETRY_FAILED',
      { storyId, chapterNumber, correlationId, stage },
      () =>
        recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'PUBLISHED',
          repairAttempts: result.attempts,
          findings: result.findings as never,
          correlationId,
        }),
    )

    stage = 'COMPLETE'
    console.log('GENERATION_PUBLISHED', {
      storyId,
      chapterNumber,
      correlationId,
      attemptId: checkpointAttemptId,
      repairAttempts: result.attempts,
      fromCheckpoint,
      proseFingerprint: proseFingerprintUsed,
      elapsedMs: Date.now() - startedAt,
    })

    return {
      ok: true,
      chapterNumber: published.chapter_number,
      seq: published.seq,
      repairAttempts: result.attempts,
      fromCheckpoint,
    }
  } catch (err) {
    // Kegagalan tak terduga: lepas lease agar tak mengunci story.
    await releaseLeaseOnce()
    if (!isFailureRecorded(err)) {
      await logRuntimeFailure('UNKNOWN_RUNTIME_EXCEPTION', err)
    }
    throw err
  }
}

// Test seams for choice orchestration and synthetic briefs.
export {
  buildChoices as __testBuildChoices,
  syntheticChapterBrief as __testSyntheticChapterBrief,
}
