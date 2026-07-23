import 'server-only'
import {
  acquireGenerationLease,
  publishChapterV2,
  releaseGenerationLease,
  mapBranchToV2Outcomes,
  type PublishOutcomeV2,
  type PublishResult,
} from './lifecycle'
import { withGenerationSlot } from './generation-concurrency'
import {
  compileContext,
  buildBlueprints,
  TOTAL_CHAPTERS,
  type CanonSnapshot,
  type ChapterBlueprint,
} from '@lakoku/narrative-core'
import { loadCanonSnapshot, persistRetrievalLog } from '@lakoku/narrative-core/server'
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
import { safeErrorInfo } from '@/lib/observability/safe-error'
import type { ChapterBrief, ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState, type RouteState } from '@/lib/story-engine/route-state'
import { summarizeRouteStateForPrompt } from '@/lib/story-engine/route-state'
import { createSynchronousProviderContext } from './generation-provider-context'
import type { ProviderCallContext } from '@/lib/observability/generation-provider-call.contract'
import {
  buildChoiceBranch,
  fallbackChoicesFromDraft,
  type BuildChoiceBranchInput,
  type ChoiceBuildDeps,
  type ChoiceNarrativeContext,
} from './choice-generation'
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
        | 'CHOICE_GENERATION_FAILED'
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
    // DB down or table missing: fallback silently (Phase 5 removes this).
    return emptyChoiceNarrativeContext()
  }
}

/**
 * Fallback bila LLM choices gagal: tetap grounded di draft (bukan maju/tahan generik).
 * Delegates to shared choice-generation module.
 */
function fallbackChoicesFromDraftFn(
  draft: ChapterDraftParsed,
  chapterNumber: number,
) {
  // Test/fixture only — not used on production success path (Phase 5).
  return fallbackChoicesFromDraft(draft, chapterNumber)
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
): Promise<{
  ok: true
  choicePrompt: string
  choices: { id: string; label: string }[]
  outcomes: PublishOutcomeV2[]
  repairAttempts: number
  source: 'INITIAL' | 'REPAIRED'
} | {
  ok: false
  reason: string
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
  )
}

async function generateNextChapterRealInner(
  input: StandardGenerateInput,
): Promise<RealGenerateResult> {
  const { storyId, userId, chapterNumber, correlationId } = input
  const attemptId = input.attemptId?.trim() || correlationId
  const startedAt = Date.now()
  let stage: GenerationStage = 'ACQUIRE_LEASE'
  let leaseId: string | null = null
  let leaseReleased = false
  let fromCheckpoint = false
  let proseFingerprintUsed: string | null = null
  let checkpointAttemptId = attemptId

  const providerContext = createSynchronousProviderContext({
    userId,
    storyId,
    chapterNumber,
    generationKind: 'standard',
    correlationId,
  })

  const releaseLeaseOnce = async () => {
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

  // 1) Lease (idempoten). Menolak bila ada generasi lain aktif.
  stage = 'ACQUIRE_LEASE'
  const ttlSeconds = await resolveGenerationLeaseTtlSeconds()
  const lease = await acquireGenerationLease({
    storyId,
    chapterNumber,
    holder: 'story-generation',
    // Multi-LLM plan→write→repair can exceed 2 minutes wall on VPS.
    // TTL from generation_policy (clamped 60..1800).
    ttlSeconds,
    idempotencyKey: realGenerationKey(storyId, chapterNumber, 'lease'),
  })
  if (!lease.ok) return { ok: false, reason: lease.reason }
  leaseId = lease.lease_id

  try {
    // 1b) Choice-only resume: load PROSE_READY checkpoint when available.
    const {
      loadUsableProseCheckpoint,
      persistProseReadyCheckpoint,
      markCheckpointStatus,
      draftFromCheckpoint,
      proseFingerprint,
    } = await import('@/lib/runtime/chapter-generation-checkpoint')

    const existingCheckpoint = await loadUsableProseCheckpoint({
      storyId,
      chapterNumber,
      // Prefer any usable checkpoint for story+chapter on retry (not only this attemptId)
      attemptId: null,
    })

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

    // 3) Kompilasi konteks + catat jejak retrieval (best-effort observability).
    stage = 'COMPILE_CONTEXT'
    const packet = compileContext(snapshot, chapterNumber)
    await bestEffort(
      'RETRIEVAL_LOG_PERSIST_FAILED',
      { storyId, chapterNumber, correlationId, stage },
      () => persistRetrievalLog(storyId, chapterNumber, packet),
    )

    // 4) Konteks thread untuk lifecycle check (state hidup di canon, bukan draft).
    const threadContext: ThreadContext = {
      threads: snapshot.threads,
      advancedThreadIds: [],
      opensNewThread: false,
    }

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

    if (existingCheckpoint) {
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
      await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'RUNNING_CHOICES',
        choiceAttemptCount: existingCheckpoint.choiceAttemptCount + 1,
      })
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
          threadContext,
          executionOptions: {
            telemetryContext: providerContext,
            workflowPhase: 'CHAPTER_PROSE_INITIAL',
          },
        },
      )

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
      const saved = await persistProseReadyCheckpoint({
        storyId,
        chapterNumber,
        attemptId,
        correlationId,
        title: draft.title,
        paragraphs: draft.paragraphs ?? [],
        proseAttemptCount: result.attempts,
      })
      if (saved.ok) {
        proseFingerprintUsed = saved.checkpoint.proseFingerprint
        checkpointAttemptId = saved.checkpoint.attemptId
      } else {
        // Still continue with in-memory prose; retry may regenerate if table missing.
        proseFingerprintUsed = proseFingerprint(draft.title, draft.paragraphs ?? [])
        console.log('CHECKPOINT_PROSE_READY_SKIPPED', {
          storyId,
          chapterNumber,
          correlationId,
          error: saved.error,
        })
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
    const branch = await buildChoices(snapshot, draft, chapterNumber, providerContext)
    if (!branch.ok) {
      // Final chapter: publish ending without choices (Phase 7 also covers this).
      if (branch.reason === 'FINAL_CHAPTER') {
        stage = 'PUBLISH_CHAPTER'
        const publishedEnding: PublishResult = await publishChapterV2({
          storyId,
          chapterNumber,
          title: readerSafe.title,
          paragraphs: readerSafe.paragraphs,
          choicePrompt: null,
          choices: null,
          outcomes: [],
          leaseId: lease.lease_id,
          idempotencyKey: realGenerationKey(storyId, chapterNumber, 'publish'),
        })
        if (publishedEnding.ok) leaseReleased = true
        if (!publishedEnding.ok) {
          await releaseLeaseOnce()
          return { ok: false, reason: publishedEnding.reason }
        }
        await markCheckpointStatus({
          storyId,
          chapterNumber,
          attemptId: checkpointAttemptId,
          status: 'PUBLISHED',
        })
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
      await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'CHOICES_RETRY_WAIT',
      })
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
        reason: 'CHOICE_GENERATION_FAILED',
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

    // 8) Publish atomik (chapter + outcomes + event + release lease).
    stage = 'PUBLISH_CHAPTER'
    const publishKey = proseFingerprintUsed
      ? realGenerationKey(
          storyId,
          chapterNumber,
          `publish:${proseFingerprintUsed.slice(0, 16)}`,
        )
      : realGenerationKey(storyId, chapterNumber, 'publish')
    const published: PublishResult = await publishChapterV2({
      storyId,
      chapterNumber,
      title: readerSafe.title,
      paragraphs: readerSafe.paragraphs,
      choicePrompt: branch.choicePrompt,
      choices: branch.choices,
      outcomes: branch.outcomes,
      leaseId: lease.lease_id,
      idempotencyKey: publishKey,
    })

    // publish_chapter releases lease transactionally on success.
    if (published.ok) leaseReleased = true

    if (!published.ok) {
      await releaseLeaseOnce()
      // Keep prose checkpoint for retry after publish conflict if chapter not created.
      await markCheckpointStatus({
        storyId,
        chapterNumber,
        attemptId: checkpointAttemptId,
        status: 'CHOICES_RETRY_WAIT',
      })
      console.log('GENERATION_PUBLISH_CONFLICT', {
        storyId,
        chapterNumber,
        correlationId,
        reason: published.reason,
        fromCheckpoint,
        elapsedMs: Date.now() - startedAt,
      })
      return { ok: false, reason: published.reason }
    }

    await markCheckpointStatus({
      storyId,
      chapterNumber,
      attemptId: checkpointAttemptId,
      status: 'PUBLISHED',
    })

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

// ---- Test-only exports (Phase 0 baseline) ----
// Exported for characterization / desired-behavior TDD tests only.
// Must NOT be imported by production code. Logic unchanged.
export {
  fallbackChoicesFromDraft as __testFallbackChoicesFromDraft,
  buildChoices as __testBuildChoices,
  syntheticChapterBrief as __testSyntheticChapterBrief,
}
