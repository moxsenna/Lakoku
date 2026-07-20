import 'server-only'
import {
  acquireGenerationLease,
  publishChapter,
  releaseGenerationLease,
  type PublishOutcome,
  type PublishResult,
} from './lifecycle'
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
  type ChoiceBranch,
} from '@lakoku/ai-gateway'
import { selectProvider } from '@lakoku/ai-gateway/server'
import {
  recordGenerationAttempt,
  recordGenerationRuntimeFailed,
} from '@/lib/observability/server'
import type { GenerationStage } from '@/lib/observability/generation-stages'
import { safeErrorInfo } from '@/lib/observability/safe-error'
import type { ChapterBrief } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { createSynchronousProviderContext } from './generation-provider-context'
import type { ProviderCallContext } from '@/lib/observability/generation-provider-call.contract'

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

function lastParagraphs(draft: ChapterDraftParsed): [string, string, string] | [string, string, string, string] | [string, string, string, string, string] {
  const paragraphs = draft.paragraphs.filter((p) => p.trim().length > 0)
  const slice = paragraphs.slice(-5)
  while (slice.length < 3) {
    slice.unshift(paragraphs[0] ?? draft.title)
  }
  return slice as ReturnType<typeof lastParagraphs>
}

/** Minimal chapter brief for standard/onboarding stories (no story_generation_contracts row). */
function syntheticChapterBrief(
  storyId: string,
  chapterNumber: number,
  draft: ChapterDraftParsed,
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
    routeStateSummary: 'Awal perjalanan; belum ada bias rute kuat.',
    choiceHistorySummary: 'Belum ada pilihan sebelumnya.',
    plotDebtsToProgress: empty,
    plotDebtsToClose: empty,
    allowedNewThread: chapterNumber < 40,
    allowedMajorNewConflict: chapterNumber < 45,
    endingRunway,
    lockedEndingKey: null,
    allowsChoices: chapterNumber < TOTAL_CHAPTERS,
    finalChapter: chapterNumber >= TOTAL_CHAPTERS,
    goals: [chapterGoal],
    routeSummary: 'Awal perjalanan; belum ada bias rute kuat.',
    debtsToProgress: empty,
    debtsToClose: empty,
    allowMajorNewConflict: chapterNumber < 45,
    allowNewThread: chapterNumber < 40,
    lockEnding: false,
    endingKey: null,
    previousChoiceSummary: 'Belum ada pilihan sebelumnya.',
  }
}

function mapBranchToPublishOutcomes(
  branch: ChoiceBranch,
): PublishOutcome[] {
  return branch.outcomes.map((outcome) => ({
    choiceId: outcome.choiceId,
    consequence: outcome.consequence,
    nextChapterNumber: outcome.nextChapterNumber,
    isEnding: outcome.isEnding,
  }))
}

/**
 * Fallback bila LLM choices gagal: tetap grounded di draft (bukan maju/tahan generik).
 */
function fallbackChoicesFromDraft(
  draft: ChapterDraftParsed,
  chapterNumber: number,
): {
  choicePrompt: string
  choices: { id: string; label: string }[]
  outcomes: PublishOutcome[]
} {
  const isEnding = chapterNumber >= TOTAL_CHAPTERS
  const next = isEnding ? null : chapterNumber + 1
  const hook = (draft.paragraphs.at(-1) ?? draft.title).slice(0, 80)
  const choicePrompt = isEnding
    ? 'Bagaimana kau menutup kisah ini?'
    : `Setelah ${hook}${hook.length >= 80 ? '…' : ''}, apa yang kau lakukan?`
  const choices = [
    { id: 'hadapi', label: 'Hadapi langsung apa yang baru terbuka' },
    { id: 'selidiki', label: 'Selidiki dulu jejak yang tersisa' },
  ]
  const outcomes: PublishOutcome[] = [
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

/** LLM choices grounded di prose bab; fallback lokal bila provider gagal. */
async function buildChoices(
  snapshot: CanonSnapshot,
  draft: ChapterDraftParsed,
  chapterNumber: number,
  providerContext: ProviderCallContext,
): Promise<{
  choicePrompt: string
  choices: { id: string; label: string }[]
  outcomes: PublishOutcome[]
}> {
  if (chapterNumber >= TOTAL_CHAPTERS) {
    return fallbackChoicesFromDraft(draft, chapterNumber)
  }

  try {
    const brief = syntheticChapterBrief(snapshot.storyId, chapterNumber, draft)
    const branch = await generateChoiceBranch(
      { provider: await selectProvider(providerContext) },
      {
        snapshot,
        chapterBrief: brief,
        draft,
        lastParagraphs: lastParagraphs(draft),
        routeState: normalizeRouteState({}),
        choiceHistory: [],
        lockedEndingKey: null,
      },
      {
        telemetryContext: providerContext,
        workflowPhase: 'CHOICES_INITIAL',
      },
    )
    if (!branch) return fallbackChoicesFromDraft(draft, chapterNumber)
    return {
      choicePrompt: branch.choicePrompt,
      choices: branch.choices.map((c) => ({
        id: c.id,
        label: c.label,
        ...(c.hint ? { hint: c.hint } : {}),
      })),
      outcomes: mapBranchToPublishOutcomes(branch),
    }
  } catch {
    console.log('GENERATION_CHOICES_FALLBACK_USED')
    return fallbackChoicesFromDraft(draft, chapterNumber)
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
  const lease = await acquireGenerationLease({
    storyId,
    chapterNumber,
    holder: 'story-generation',
    // Multi-LLM plan→write→repair can exceed 2 minutes wall on VPS.
    // Default 120s too tight when model is slow; 300s for testing phase.
    ttlSeconds: 300,
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

    // 7) Cabang pilihan LLM (grounded di prosa bab) — fallback lokal bila gagal.
    stage = 'BUILD_CHOICES'
    const branch = await buildChoices(snapshot, draft, chapterNumber, providerContext)
    stage = 'VALIDATE_CHOICES'
    const leakInChoices = [
      branch.choicePrompt,
      ...branch.choices.map((c) => c.label),
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
    const published: PublishResult = await publishChapter({
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
  mapBranchToPublishOutcomes as __testMapBranchToPublishOutcomes,
  syntheticChapterBrief as __testSyntheticChapterBrief,
}
