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
  | { ok: true; chapterNumber: number; seq: number; repairAttempts: number }
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
): ChapterBrief {
  const remaining = Math.max(0, TOTAL_CHAPTERS - chapterNumber)
  // Chapter draft has prose only; goal/phase derived for choice provider brief.
  const chapterGoal = draft.title
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

  return {
    storyId,
    chapterNumber,
    totalChapters: 50,
    phase,
    remainingChapters: remaining,
    chapterGoal,
    mustInclude: empty,
    mustNotInclude: empty,
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
  const brief = syntheticChapterBrief(snapshot.storyId, chapterNumber, draft, narrativeContext)
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
  const startedAt = Date.now()
  let stage: GenerationStage = 'ACQUIRE_LEASE'
  let leaseId: string | null = null
  let leaseReleased = false

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

    // 3) Kompilasi konteks + catat jejak retrieval (best-effort observability).
    stage = 'COMPILE_CONTEXT'
    const packet = compileContext(snapshot, chapterNumber)
    await persistRetrievalLog(storyId, chapterNumber, packet)

    // 4) Konteks thread untuk lifecycle check (state hidup di canon, bukan draft).
    const threadContext: ThreadContext = {
      threads: snapshot.threads,
      advancedThreadIds: [],
      opensNewThread: false,
    }

    // 5) Generasi tervalidasi: plan → write → Layer A → Layer B → repair.
    stage = 'GENERATE_PROSE'
    const result = await generateChapter(
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
        findings: result.findings,
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

    const draft = result.draft

    // 6) Boundary consumer-safe: tak ada istilah internal yang bocor ke pembaca.
    stage = 'CONSUMER_SAFE'
    const readerSafe = toReaderSafe(draft)
    assertConsumerSafe(readerSafe)

    // 7) Cabang pilihan LLM (grounded di prosa bab).
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
        stage = 'RECORD_TERMINAL_ATTEMPT'
        // Best-effort telemetry — never convert publish success into workflow failure.
        await recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'PUBLISHED',
          repairAttempts: result.attempts,
          findings: result.findings,
          correlationId,
        }).catch(() => undefined)
        stage = 'COMPLETE'
        return {
          ok: true,
          chapterNumber: publishedEnding.chapter_number,
          seq: publishedEnding.seq,
          repairAttempts: result.attempts,
        }
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
        generationKind: 'standard',
        stage: branch.repairAttempts > 0 ? 'VALIDATE_CHOICES_FINAL' : 'VALIDATE_CHOICES_INITIAL',
        errorCode: mapChoiceFailureReasonToErrorCode(branch.reason),
        reason: branch.reason,
        findingCodes: branch.validationFindings.map((f) => f.code).slice(0, 12),
        repairAttempts: branch.repairAttempts,
        elapsedMs: Date.now() - startedAt,
      })
      // Best-effort: telemetry failure must not change primary failure reason.
      await recordGenerationAttempt({
        storyId,
        chapter: chapterNumber,
        outcome: 'REVIEW_REQUIRED',
        repairAttempts: result.attempts + branch.repairAttempts,
        findings: result.findings,
        correlationId,
      }).catch(() => undefined)
      return {
        ok: false,
        reason: 'CHOICE_GENERATION_FAILED',
        detail: {
          choiceReason: branch.reason,
          findingCodes: branch.validationFindings.map((f) => f.code),
          repairAttempts: branch.repairAttempts,
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
      const err = new Error(
        `Kebocoran istilah internal pada cabang pilihan: ${leakInChoices.join(', ')}`,
      )
      await logRuntimeFailure('CHOICE_LEAK_REJECTED', err)
      throw err
    }

    // 8) Publish atomik (chapter + outcomes + event + release lease).
    stage = 'PUBLISH_CHAPTER'
    const published: PublishResult = await publishChapterV2({
      storyId,
      chapterNumber,
      title: readerSafe.title,
      paragraphs: readerSafe.paragraphs,
      choicePrompt: branch.choicePrompt,
      choices: branch.choices,
      outcomes: branch.outcomes,
      leaseId: lease.lease_id,
      idempotencyKey: realGenerationKey(storyId, chapterNumber, 'publish'),
    })

    // publish_chapter releases lease transactionally on success.
    if (published.ok) leaseReleased = true

    if (!published.ok) {
      await releaseLeaseOnce()
      console.log('GENERATION_PUBLISH_CONFLICT', {
        storyId,
        chapterNumber,
        correlationId,
        reason: published.reason,
        elapsedMs: Date.now() - startedAt,
      })
      return { ok: false, reason: published.reason }
    }

    // Telemetri konsistensi (T8.1) — attempt sukses. Dipancarkan SETELAH publish.
    stage = 'RECORD_TERMINAL_ATTEMPT'
    await recordGenerationAttempt({
      storyId,
      chapter: chapterNumber,
      outcome: 'PUBLISHED',
      repairAttempts: result.attempts,
      findings: result.findings,
      correlationId,
    })

    stage = 'COMPLETE'
    console.log('GENERATION_PUBLISHED', {
      storyId,
      chapterNumber,
      correlationId,
      repairAttempts: result.attempts,
      elapsedMs: Date.now() - startedAt,
    })

    return {
      ok: true,
      chapterNumber: published.chapter_number,
      seq: published.seq,
      repairAttempts: result.attempts,
    }
  } catch (err) {
    // Kegagalan tak terduga: lepas lease agar tak mengunci story.
    await releaseLeaseOnce()
    await logRuntimeFailure('UNKNOWN_RUNTIME_EXCEPTION', err)
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
