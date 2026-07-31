import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  compileContext,
  buildBlueprints,
  type CanonSnapshot,
  type ChapterBlueprint,
  type ChapterContextPacket,
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
  type GenerationProvider,
  type ChoiceInput,
  type GenerationResult,
} from '@lakoku/ai-gateway'
import { selectProvider } from '@lakoku/ai-gateway/server'
import { createAdminClient } from '@lakoku/db'
import { recordGenerationAttempt } from '@/lib/observability/server'
import { safeErrorInfo } from '@/lib/observability/safe-error'
import {
  buildChapterBrief,
  type ChapterBrief,
  type ChoiceHistoryEntry,
  ChoiceHistoryEntrySchema,
} from '@/lib/story-engine/chapter-brief'
import {
  parseStoryContract,
  type StoryContract,
} from '@/lib/story-engine/story-contract'
import {
  normalizeRouteState,
  RouteStateSchema,
  type RouteState,
} from '@/lib/story-engine/route-state'
import { resolveEnding, type EndingResolution } from '@/lib/story-engine/ending-resolver'
import {
  auditPlotDebts,
  type PlotDebtAuditInput,
  type PlotDebtAuditResult,
} from '@/lib/story-engine/plot-debt'
import {
  acquireGenerationLease,
  releaseGenerationLease,
  publishChapterV2,
  mapBranchToV2Outcomes,
  type AcquireLeaseResult,
  type PublishChapterV2Input,
  type PublishOutcomeV2,
  type PublishResult,
} from './lifecycle'
import {
  GENERATION_PROMPT_CONTRACT_VERSION,
  type RealGenerateResult,
} from './story-generation'
import type { CheckpointMutationResult } from './chapter-generation-checkpoint.pure'
import { classifyGenerationPublicationError } from './generation-job-error'
import {
  draftFromCheckpoint,
  loadUsableProseCheckpoint,
  markCheckpointStatus,
  persistProseReadyCheckpoint,
} from './chapter-generation-checkpoint'
import {
  CHECKPOINT_AUDIT_SIGNALS_VERSION,
  isCheckpointAuditSignalsV2,
  type CheckpointAuditSignals,
  type CheckpointAuditSignalsV2,
  type ChapterGenerationCheckpoint,
  type CheckpointFreshnessContext,
  type CheckpointStatus,
} from './chapter-generation-checkpoint.pure'
import { withGenerationSlot } from './generation-concurrency'
import { createSynchronousProviderContext } from './generation-provider-context'
import { ProviderCallContextSchema } from '@/lib/observability/generation-provider-call.contract'
import {
  buildChoiceBranch,
  type BuildChoiceBranchInput,
  type ChoiceBuildDeps,
} from './choice-generation'
import {
  groundedChoiceProseFromFinalDraft,
  choiceNarrativeContextFromReader,
} from './choice-context'
import { resolveGenerationLeaseTtlSeconds } from './generation-lease-ttl'
import { throwIfAborted } from './abort'

/**
 * Personalized chapter runtime (Task 17).
 *
 * Rantai:
 *   lease → canon → contract → reader state → brief → compile
 *         → generateChapter (plan→write→Layer A→Layer B→repair)
 *         → consumer-safe → choices (<50) / resolveEnding (50)
 *         → auditPlotDebts → legacy lock then publish / worker atomic V3 lock+publish
 *         → mark SELESAI @50 after publish ok OR CHAPTER_EXISTS recovery
 *         → telemetry
 *
 * generateNextChapterReal remains the standard/demo path and is never called here.
 */

const TOTAL_PERSONALIZED_CHAPTERS = 50
const ENDING_LOCK_CHAPTER = 45

const CONTRACT_SELECT =
  'story_id,story_contract_json,plot_debts_json,ending_candidates_json,ending_lock_json,mode,total_chapters' as const
const READER_STATE_INTERNAL_SELECT =
  'user_id,story_id,status,current_chapter,jejak,ending_name,route_state,choice_history,locked_ending_key,updated_at' as const

const ReaderStateInternalSchema = z.object({
  user_id: z.string().uuid(),
  story_id: z.string().min(1),
  status: z.enum(['BARU', 'BERJALAN', 'SELESAI']),
  current_chapter: z.number().int().positive(),
  jejak: z.array(z.unknown()).default([]),
  ending_name: z.string().nullable(),
  route_state: RouteStateSchema,
  choice_history: z.array(ChoiceHistoryEntrySchema).max(49).default([]),
  locked_ending_key: z.string().nullable(),
  updated_at: z.string(),
}).strict()

export type ReaderStateInternal = z.infer<typeof ReaderStateInternalSchema>

export interface PersonalizedGenerateInput {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
  triggerChoiceId?: string | null
  jobId?: string
  attemptNumber?: number
  /** Durable attempt id (job id on worker path). */
  attemptId?: string | null
  /**
   * Worker path: reuse job lease + fenced publish. Skip own acquireGenerationLease.
   */
  jobContext?: import('@/lib/runtime/generation-job-execution').GenerationJobExecutionContext | null
  options?: import('@/lib/runtime/generation-job-execution').GenerationWorkerOptions
}

export interface PersistEndingLockInput {
  userId: string
  storyId: string
  endingKey: string
  endingName: string
  chapterNumber: number
}

export interface MarkReaderSelesaiInput {
  userId: string
  storyId: string
  endingName: string
  endingKey: string
}

export interface PersonalizedGenerationDeps {
  acquireGenerationLease: (args: {
    storyId: string
    chapterNumber: number
    holder: string
    ttlSeconds?: number
    idempotencyKey: string
  }) => Promise<AcquireLeaseResult>
  releaseGenerationLease: (args: { storyId: string; leaseId: string }) => Promise<void>
  loadCanonSnapshot: (storyId: string, throughChapter?: number) => Promise<CanonSnapshot>
  loadStoryGenerationContract: (storyId: string) => Promise<StoryContract>
  loadReaderStateInternal: (userId: string, storyId: string) => Promise<ReaderStateInternal>
  buildChapterBrief: typeof buildChapterBrief
  compileContext: (
    snapshot: CanonSnapshot,
    targetChapter: number,
    opts?: { totalBudget?: number; brief?: ChapterBrief },
  ) => ChapterContextPacket
  persistRetrievalLog: (
    storyId: string,
    chapterNumber: number,
    packet: ChapterContextPacket,
  ) => Promise<void>
  loadUsableProseCheckpoint: (args: {
    storyId: string
    chapterNumber: number
    attemptId?: string | null
    freshness?: CheckpointFreshnessContext
    jobContext?: import('./generation-job-execution').GenerationJobExecutionContext | null
  }) => Promise<ChapterGenerationCheckpoint | null>
  persistProseReadyCheckpoint: (args: {
    storyId: string
    chapterNumber: number
    attemptId: string
    correlationId: string
    title: string
    paragraphs: string[]
    proseAttemptCount?: number
    auditSignals?: CheckpointAuditSignals | null
    auditSignalsVersion?: 1 | 2 | null
    directionFingerprint?: string | null
    canonVersion?: number | null
    blueprintVersion?: number | null
    generationMode?: string | null
    generationPolicyVersion?: number | null
    promptContractVersion?: number | null
    jobId?: string | null
    jobAttemptNumber?: number | null
    jobContext?: import('./generation-job-execution').GenerationJobExecutionContext | null
  }) => Promise<
    CheckpointMutationResult
  >
  markCheckpointStatus: (args: {
    storyId: string
    chapterNumber: number
    attemptId: string
    status: CheckpointStatus
    choiceAttemptCount?: number
    jobContext?: import('./generation-job-execution').GenerationJobExecutionContext | null
  }) => Promise<CheckpointMutationResult>
  selectProvider: (
    context: ReturnType<typeof createSynchronousProviderContext>,
  ) => Promise<GenerationProvider>
  generateChapter: (
    deps: { provider: GenerationProvider },
    args: {
      snapshot: CanonSnapshot
      blueprint: ChapterBlueprint
      chapterNumber: number
      threadContext?: ThreadContext
      executionOptions?: Parameters<GenerationProvider['writeChapter']>[1]
    },
  ) => Promise<GenerationResult>
  toReaderSafe: (draft: ChapterDraftParsed) => {
    chapterNumber: number
    title: string
    paragraphs: string[]
    hasChoiceOrGate: boolean
  }
  assertConsumerSafe: (chapter: {
    chapterNumber: number
    title: string
    paragraphs: string[]
    hasChoiceOrGate: boolean
  }) => void
  generateChoiceBranch: (
    deps: { provider: GenerationProvider },
    input: ChoiceInput,
    options?: Parameters<GenerationProvider['writeChapter']>[1],
  ) => Promise<ChoiceBranch | null>
  resolveEnding: typeof resolveEnding
  auditPlotDebts: (input: PlotDebtAuditInput & {
    closesPlotDebts: CheckpointAuditSignalsV2['closesPlotDebts']
  }) => PlotDebtAuditResult & { auditSignals: CheckpointAuditSignalsV2 }
  persistEndingLock: (input: PersistEndingLockInput) => Promise<void>
  publishChapterV2: (input: PublishChapterV2Input) => Promise<PublishResult>
  markReaderStateSelesai: (input: MarkReaderSelesaiInput) => Promise<void>
  recordGenerationAttempt: (input: {
    storyId: string
    chapter: number
    outcome: 'PUBLISHED' | 'REVIEW_REQUIRED'
    repairAttempts: number
    findings: GenerationResult['findings']
  }) => Promise<void>
}

export function personalizedGenerationKey(
  storyId: string,
  chapterNumber: number,
  scope: string,
): string {
  return `gen:personalized:${scope}:${storyId}:${chapterNumber}`
}

function resolveBlueprint(
  snapshot: CanonSnapshot,
  chapterNumber: number,
): ChapterBlueprint | null {
  const fromCanon = snapshot.blueprints
    .filter((b) => b.chapterNumber === chapterNumber)
    .sort((a, b) => b.version - a.version)[0]
  if (fromCanon) return fromCanon

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
    return null
  }
}

/** Build ChoiceBuildDeps from PersonalizedGenerationDeps for the shared seam. */
function choiceDepsFromPersonalized(deps: PersonalizedGenerationDeps): ChoiceBuildDeps {
  return {
    selectProvider: deps.selectProvider as ChoiceBuildDeps['selectProvider'],
    generateChoiceBranch: deps.generateChoiceBranch as ChoiceBuildDeps['generateChoiceBranch'],
  }
}

async function defaultLoadStoryGenerationContract(storyId: string): Promise<StoryContract> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('story_generation_contracts')
    .select(CONTRACT_SELECT)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new Error(`loadStoryGenerationContract: ${error.message}`)
  if (!data) throw new Error(`loadStoryGenerationContract: contract missing for ${storyId}`)

  const row = data as {
    story_id: string
    story_contract_json: Record<string, unknown>
    plot_debts_json: unknown
    ending_candidates_json: unknown
    ending_lock_json: unknown
  }

  return parseStoryContract({
    ...row.story_contract_json,
    storyId: row.story_id,
    plotDebts: row.plot_debts_json,
    endingCandidates: row.ending_candidates_json,
  })
}

async function defaultLoadReaderStateInternal(
  userId: string,
  storyId: string,
): Promise<ReaderStateInternal> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('reader_states')
    .select(READER_STATE_INTERNAL_SELECT)
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new Error(`loadReaderStateInternal: ${error.message}`)
  if (!data) throw new Error(`loadReaderStateInternal: missing for ${userId}/${storyId}`)
  return ReaderStateInternalSchema.parse({
    ...data,
    route_state: normalizeRouteState((data as { route_state: unknown }).route_state),
  })
}

/**
 * Atomically write reader.locked_ending_key + contracts.ending_lock_json
 * via SECURITY DEFINER RPC (service-role only).
 */
export async function defaultPersistEndingLock(input: PersistEndingLockInput): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('persist_ending_lock_v1', {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_ending_key: input.endingKey,
    p_ending_name: input.endingName,
    p_chapter_number: input.chapterNumber,
  })
  if (error) throw new Error(`persistEndingLock: ${error.message}`)
  if (!data || (data as { ok?: boolean }).ok !== true) {
    throw new Error('persistEndingLock: unexpected RPC result')
  }
}

/** Test seam for default atomic ending-lock path. */
export const defaultPersistEndingLockForTest = defaultPersistEndingLock

// ---- Test-only exports (Phase 0 baseline) ----
// Exported for characterization / desired-behavior TDD tests only.
// Must NOT be imported by production code. Re-exported from shared lifecycle.
export { mapBranchToV2Outcomes as __testMapBranchToV2Outcomes } from './lifecycle'

type DraftAuditSignals = ChapterDraftParsed & {
  opensNewThread?: boolean
  opensMajorMystery?: boolean
  opensNewConflict?: boolean
  advancedThreadIds?: string[]
}

function draftAuditSignals(draft: ChapterDraftParsed): DraftAuditSignals {
  return draft as DraftAuditSignals
}

function findingsIndicate(findings: GenerationResult['findings'], needles: string[]): boolean {
  return findings.some((finding) => {
    const blob = `${finding.code} ${finding.message}`.toLocaleLowerCase('en-US')
    return needles.some((needle) => blob.includes(needle))
  })
}

function deltaKeysIndicate(
  proposedStateDelta: ChapterDraftParsed['proposedStateDelta'],
  needles: string[],
): boolean {
  return Object.keys(proposedStateDelta ?? {}).some((key) => {
    const normalized = key.toLocaleLowerCase('en-US')
    return needles.some((needle) => normalized.includes(needle))
  })
}

/**
 * Derive plot-debt audit flags from draft/brief/findings signals.
 * endingLocked is supplied by caller (persisted lock or lock written this turn).
 */
export function derivePlotDebtAuditFlags(input: {
  draft: ChapterDraftParsed
  brief: ChapterBrief
  findings: GenerationResult['findings']
  endingLocked: boolean
}): Pick<
  PlotDebtAuditInput,
  'opensNewThread' | 'opensMajorMystery' | 'opensNewConflict' | 'endingLocked'
> {
  const draft = draftAuditSignals(input.draft)
  const findings = input.findings ?? []
  const brief = input.brief

  const opensNewThread = Boolean(
    draft.opensNewThread
    || findingsIndicate(findings, ['thread_new', 'new_thread', 'opensnewthread', 'thread baru'])
    || deltaKeysIndicate(draft.proposedStateDelta, ['new_thread', 'openthread', 'opensnewthread'])
    || (
      // Brief forbids new threads while draft introduces named cast + thread-like delta noise.
      !brief.allowedNewThread
      && (draft.newNamedCharacters?.length ?? 0) > 0
      && deltaKeysIndicate(draft.proposedStateDelta, ['thread'])
    ),
  )

  const opensMajorMystery = Boolean(
    draft.opensMajorMystery
    || findingsIndicate(findings, ['major_mystery', 'new_mystery', 'misteri besar'])
    || deltaKeysIndicate(draft.proposedStateDelta, ['major_mystery', 'new_mystery', 'opensmajormystery'])
    || (
      !brief.allowedMajorNewConflict
      && (draft.reveals?.length ?? 0) > 0
      && findingsIndicate(findings, ['mystery', 'secret', 'reveal'])
    ),
  )

  const opensNewConflict = Boolean(
    draft.opensNewConflict
    || findingsIndicate(findings, ['new_conflict', 'open_conflict', 'konflik baru'])
    || deltaKeysIndicate(draft.proposedStateDelta, ['new_conflict', 'open_conflict', 'opensnewconflict'])
    || (
      brief.finalChapter
      && deltaKeysIndicate(draft.proposedStateDelta, ['conflict'])
    ),
  )

  return {
    opensNewThread,
    opensMajorMystery,
    opensNewConflict,
    endingLocked: input.endingLocked,
  }
}

async function defaultMarkReaderStateSelesai(input: MarkReaderSelesaiInput): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('reader_states')
    .update({
      status: 'SELESAI',
      ending_name: input.endingName,
      locked_ending_key: input.endingKey,
      current_chapter: TOTAL_PERSONALIZED_CHAPTERS,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('story_id', input.storyId)
  if (error) throw new Error(`markReaderStateSelesai: ${error.message}`)
}

function defaultDeps(): PersonalizedGenerationDeps {
  return {
    acquireGenerationLease,
    releaseGenerationLease,
    loadCanonSnapshot,
    loadStoryGenerationContract: defaultLoadStoryGenerationContract,
    loadReaderStateInternal: defaultLoadReaderStateInternal,
    buildChapterBrief,
    compileContext,
    persistRetrievalLog,
    loadUsableProseCheckpoint,
    persistProseReadyCheckpoint,
    markCheckpointStatus,
    selectProvider,
    generateChapter,
    toReaderSafe,
    assertConsumerSafe,
    generateChoiceBranch,
    resolveEnding,
    auditPlotDebts: (input) => {
      const { closesPlotDebts, ...plotDebtInput } = input
      return {
        ...auditPlotDebts(plotDebtInput),
        auditSignals: {
          opensNewThread: input.opensNewThread,
          opensMajorMystery: input.opensMajorMystery,
          opensNewConflict: input.opensNewConflict,
          closesPlotDebts,
        },
      }
    },
    persistEndingLock: defaultPersistEndingLock,
    publishChapterV2,
    markReaderStateSelesai: defaultMarkReaderStateSelesai,
    recordGenerationAttempt,
  }
}

/**
 * Generate + publish one personalized chapter. Injectable deps for unit tests.
 * Never calls generateNextChapterReal.
 */
export async function generateNextPersonalizedChapter(
  input: PersonalizedGenerateInput,
  deps?: PersonalizedGenerationDeps,
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
          path: 'personalized',
        })
      }
      return generateNextPersonalizedChapterInner(input, deps)
    },
    (reason, meta) => {
      console.log('GENERATION_CAPACITY_REJECTED', {
        storyId: input.storyId,
        chapterNumber: input.chapterNumber,
        correlationId: input.correlationId,
        reason,
        path: 'personalized',
        ...meta,
      })
      return { ok: false, reason, detail: meta }
    },
    input.jobContext?.signal,
  )
}

async function generateNextPersonalizedChapterInner(
  input: PersonalizedGenerateInput,
  deps?: PersonalizedGenerationDeps,
): Promise<RealGenerateResult> {
  const d = deps ?? defaultDeps()
  const {
    storyId,
    userId,
    chapterNumber,
    correlationId,
    triggerChoiceId,
  } = input
  const jobContext = input.jobContext ?? null
  const jobId = jobContext?.jobId ?? input.jobId
  const attemptNumber = jobContext?.attemptNumber ?? input.attemptNumber
  const attemptId = input.attemptId?.trim() || jobContext?.jobId || correlationId
  let checkpointAttemptId = attemptId
  let fromCheckpoint = false

  const checkpointMutationSucceeded = (
    result: CheckpointMutationResult,
  ): boolean => result.ok === true
  const providerContext = jobId === undefined && attemptNumber === undefined
    ? createSynchronousProviderContext({
        userId,
        storyId,
        chapterNumber,
        generationKind: 'personalized',
        correlationId,
      })
    : ProviderCallContextSchema.parse({
        userId,
        storyId,
        chapterNumber,
        generationKind: 'personalized',
        jobId: jobId ?? null,
        correlationId,
        attemptNumber: attemptNumber ?? null,
      })

  if (
    !Number.isInteger(chapterNumber)
    || chapterNumber < 1
    || chapterNumber > TOTAL_PERSONALIZED_CHAPTERS
  ) {
    throw new Error(`Invalid personalized chapter number: ${chapterNumber}`)
  }

  if (jobContext?.signal?.aborted) {
    return { ok: false, reason: 'CAPACITY_TIMEOUT', detail: { reason: 'ABORT_SIGNAL' } }
  }

  // Worker path reuses job lease (no second acquire). Legacy acquires own.
  let leaseId: string
  let ownLease = false
  if (jobContext) {
    leaseId = jobContext.leaseId
    console.log('GENERATION_JOB_LEASE_REUSED', {
      storyId,
      chapterNumber,
      correlationId,
      jobId: jobContext.jobId,
      attemptNumber: jobContext.attemptNumber,
      path: 'personalized',
    })
  } else {
    const ttlSeconds = await resolveGenerationLeaseTtlSeconds()
    const lease = await d.acquireGenerationLease({
      storyId,
      chapterNumber,
      holder: 'personalized-generation',
      // Multi-LLM can exceed default 120s wall before publish.
      // TTL from generation_policy (clamped 60..1800).
      ttlSeconds,
      idempotencyKey: personalizedGenerationKey(storyId, chapterNumber, 'lease'),
    })
    if (!lease.ok) return { ok: false, reason: lease.reason }
    leaseId = lease.lease_id
    ownLease = true
  }

  const releaseOwnLease = async () => {
    if (!ownLease) return
    ownLease = false
    await d.releaseGenerationLease({ storyId, leaseId }).catch(() => {})
  }

  try {
    const snapshot = await d.loadCanonSnapshot(storyId, chapterNumber)
    const blueprint = resolveBlueprint(snapshot, chapterNumber)
    if (!blueprint || snapshot.characters.length === 0) {
      await releaseOwnLease()
      return { ok: false, reason: 'CANON_MISSING' }
    }

    const contract = await d.loadStoryGenerationContract(storyId)
    if (contract.storyId !== storyId) {
      await releaseOwnLease()
      throw new Error('Contract storyId does not match generation storyId.')
    }

    const reader = await d.loadReaderStateInternal(userId, storyId)
    if (reader.story_id !== storyId || reader.user_id !== userId) {
      await releaseOwnLease()
      throw new Error('Reader state ownership mismatch.')
    }

    // Phase 3: same ChoiceNarrativeContext semantics as standard flow.
    const readerContextInput = {
      route_state: reader.route_state,
      choice_history: reader.choice_history,
      locked_ending_key: reader.locked_ending_key,
      ...('triggerChoiceId' in input ? { triggerChoiceId } : {}),
    }
    const narrativeContext = choiceNarrativeContextFromReader(readerContextInput)
    const routeState: RouteState = narrativeContext.routeState
    const choiceHistory = narrativeContext.choiceHistory
    const previousChoice = narrativeContext.previousChoice

    const brief = d.buildChapterBrief({
      storyContract: contract,
      snapshot,
      readerState: {
        routeState,
        choiceHistory,
        lockedEndingKey: narrativeContext.lockedEndingKey,
      },
      chapterNumber,
      previousChoice,
    })

    const packet = d.compileContext(snapshot, chapterNumber, { brief })
    try {
      await d.persistRetrievalLog(storyId, chapterNumber, packet)
    } catch {
      // best-effort observability — never fail generation
    }

    const canonVersion = snapshot.blueprints.reduce(
      (max, candidate) => Math.max(max, candidate.version ?? 0),
      0,
    )
    const blueprintVersion = blueprint.version ?? 0
    const directionFingerprint = createHash('sha256')
      .update(JSON.stringify(contract))
      .digest('hex')
      .slice(0, 32)
    const freshness: CheckpointFreshnessContext = {
      canonVersion,
      blueprintVersion,
      directionFingerprint,
      generationMode: 'personalized',
      generationPolicyVersion: GENERATION_PROMPT_CONTRACT_VERSION,
      promptContractVersion: GENERATION_PROMPT_CONTRACT_VERSION,
      requireJobProvenance: jobContext != null,
      jobId: jobContext?.jobId ?? null,
      jobAttemptNumber: jobContext?.attemptNumber ?? null,
    }
    const existingCheckpoint = await d.loadUsableProseCheckpoint({
      storyId,
      chapterNumber,
      attemptId: null,
      freshness,
      jobContext,
    })

    const reconcilePublishedCheckpoint = async () => {
      try {
        const mutation = await d.markCheckpointStatus({
          storyId,
          chapterNumber,
          attemptId: checkpointAttemptId,
          status: 'PUBLISHED',
          jobContext,
        })
        if (checkpointMutationSucceeded(mutation)) return
        console.log('CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED', {
          storyId,
          chapterNumber,
          correlationId,
          jobId: jobContext?.jobId ?? null,
          checkpointAttemptId,
          result: mutation.outcome,
          path: 'personalized',
        })
      } catch (error) {
        if (!jobContext) throw error
        console.log('CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED', {
          storyId,
          chapterNumber,
          correlationId,
          jobId: jobContext.jobId,
          checkpointAttemptId,
          result: 'THREW',
          errorName: error instanceof Error ? error.name.slice(0, 100) : 'unknown',
          path: 'personalized',
        })
      }
    }

    const threadContext: ThreadContext = {
      threads: snapshot.threads,
      advancedThreadIds: [],
      opensNewThread: false,
    }

    let result: GenerationResult
    let draft: ChapterDraftParsed
    if (existingCheckpoint) {
      fromCheckpoint = true
      checkpointAttemptId = existingCheckpoint.attemptId
      draft = draftFromCheckpoint(existingCheckpoint) as ChapterDraftParsed
      result = {
        status: 'PUBLISHED',
        chapterNumber,
        draft,
        attempts: existingCheckpoint.proseAttemptCount,
        findings: [],
      }
    } else {
      throwIfAborted(jobContext?.signal)
      result = await d.generateChapter(
        { provider: await d.selectProvider(providerContext) },
        {
          snapshot,
          blueprint,
          chapterNumber,
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
      throwIfAborted(jobContext?.signal)

      if (result.status !== 'PUBLISHED' || !result.draft) {
        await releaseOwnLease()
        await d.recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'REVIEW_REQUIRED',
          repairAttempts: result.attempts,
          findings: result.findings,
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
    }

    const endingProposal = chapterNumber === ENDING_LOCK_CHAPTER || chapterNumber === TOTAL_PERSONALIZED_CHAPTERS
      ? d.resolveEnding({
          routeState,
          storyContract: contract,
          chapterNumber,
          lockedEndingKey: reader.locked_ending_key ?? brief.lockedEndingKey,
        })
      : null
    let auditSignals: CheckpointAuditSignalsV2
    let audit: PlotDebtAuditResult | null = null
    if (existingCheckpoint) {
      if (
        existingCheckpoint.auditSignalsVersion !== CHECKPOINT_AUDIT_SIGNALS_VERSION ||
        !isCheckpointAuditSignalsV2(existingCheckpoint.auditSignals)
      ) {
        throw new Error('PERSONALIZED_AUDIT_V2_REQUIRED')
      }
      auditSignals = existingCheckpoint.auditSignals
    } else {
      const derived = derivePlotDebtAuditFlags({
        draft,
        brief,
        findings: result.findings,
        endingLocked: false,
      })
      const closesPlotDebts = draft.closesPlotDebts ?? []
      const audited = d.auditPlotDebts({
        chapterNumber,
        debts: contract.plotDebts,
        opensNewThread: derived.opensNewThread,
        opensMajorMystery: derived.opensMajorMystery,
        opensNewConflict: derived.opensNewConflict,
        closesPlotDebts,
        endingLocked: Boolean(
          reader.locked_ending_key ?? brief.lockedEndingKey ??
          (chapterNumber === ENDING_LOCK_CHAPTER ? endingProposal?.key : null),
        ),
      })
      audit = audited
      auditSignals = audited.auditSignals
    }
    if (audit && !audit.ok) {
      await releaseOwnLease()
      await d.recordGenerationAttempt({
        storyId,
        chapter: chapterNumber,
        outcome: 'REVIEW_REQUIRED',
        repairAttempts: result.attempts,
        findings: result.findings,
      })
      return {
        ok: false,
        reason: 'FAILED_REVIEW_REQUIRED',
        detail: { findings: audit.findings, reason: 'PLOT_DEBT_AUDIT_FAILED' },
      }
    }

    throwIfAborted(jobContext?.signal)
    if (!existingCheckpoint) {
      const saved = await d.persistProseReadyCheckpoint({
        storyId,
        chapterNumber,
        attemptId,
        correlationId,
        title: draft.title,
        paragraphs: draft.paragraphs ?? [],
        proseAttemptCount: result.attempts,
        auditSignals,
        auditSignalsVersion: CHECKPOINT_AUDIT_SIGNALS_VERSION,
        canonVersion,
        blueprintVersion,
        directionFingerprint,
        generationMode: 'personalized',
        generationPolicyVersion: GENERATION_PROMPT_CONTRACT_VERSION,
        promptContractVersion: GENERATION_PROMPT_CONTRACT_VERSION,
        jobId: jobContext?.jobId ?? null,
        jobAttemptNumber: jobContext?.attemptNumber ?? null,
        jobContext,
      })
      if (saved.ok !== true) {
        return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { checkpointMutation: saved } }
      }
      if (saved.ok === true) checkpointAttemptId = saved.checkpointAttemptId
    }

    const runningChoices = await d.markCheckpointStatus({
      storyId,
      chapterNumber,
      attemptId: checkpointAttemptId,
      status: 'RUNNING_CHOICES',
      ...(existingCheckpoint ? { choiceAttemptCount: existingCheckpoint.choiceAttemptCount + 1 } : {}),
      jobContext,
    })
    if (!checkpointMutationSucceeded(runningChoices)) {
      return { ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { checkpointMutation: runningChoices } }
    }

    const readerSafe = d.toReaderSafe(draft)
    d.assertConsumerSafe(readerSafe)

    let choicePrompt: string | null = null
    let choices: unknown[] | null = null
    let outcomes: PublishOutcomeV2[] = []
    let ending: EndingResolution | null = endingProposal

    if (chapterNumber < TOTAL_PERSONALIZED_CHAPTERS) {
      // Shared choice-build seam. Keep trigger-aware previousChoice from narrativeContext.
      const { finalChapter, endingParagraphs } = groundedChoiceProseFromFinalDraft(draft)
      const activeCharacters = snapshot.characters
        .slice(0, 24)
        .map((c) => ({ id: c.id, name: c.canonicalName ?? c.id }))
      const activeThreads = snapshot.threads
        .slice(0, 24)
        .map((th) => ({
          id: th.id,
          summary: ('title' in th && typeof th.title === 'string' ? th.title : th.id),
        }))
      const choiceInput: BuildChoiceBranchInput = {
        snapshot,
        draft,
        chapterNumber,
        chapterBrief: brief,
        finalChapter,
        lastParagraphs: endingParagraphs,
        routeState,
        choiceHistory,
        previousChoice,
        lockedEndingKey: narrativeContext.lockedEndingKey ?? brief.lockedEndingKey,
        totalChapters: TOTAL_PERSONALIZED_CHAPTERS,
        providerContext,
        signal: jobContext?.signal,
        providerRuntime: input.options?.providerRuntime,
        activeCharacters,
        activeThreads,
      }
      throwIfAborted(jobContext?.signal)
      const choiceResult = await buildChoiceBranch(choiceDepsFromPersonalized(d), choiceInput)
      throwIfAborted(jobContext?.signal)

      if (!choiceResult.ok) {
        const retryCheckpoint = await d.markCheckpointStatus({
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
        await releaseOwnLease()
        await d.recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'REVIEW_REQUIRED',
          repairAttempts: result.attempts + choiceResult.repairAttempts,
          findings: result.findings,
        }).catch(() => undefined)
        return {
          ok: false,
          reason: 'CHOICE_GENERATION_FAILED',
          detail: {
            choiceReason: choiceResult.reason,
            findingCodes: choiceResult.validationFindings.map((f) => f.code),
            repairAttempts: choiceResult.repairAttempts,
          },
        }
      }

      const branch = choiceResult.branch

      const leakInChoices = [
        branch.choicePrompt,
        ...branch.choices.map((c) => c.label),
        ...branch.choices.flatMap((c) => (c.hint ? [c.hint] : [])),
        ...branch.outcomes.flatMap((o) => o.consequence),
      ].flatMap(scanForLeaks)
      if (leakInChoices.length) {
        await releaseOwnLease()
        throw new Error(
          `Kebocoran istilah internal pada cabang pilihan: ${leakInChoices.join(', ')}`,
        )
      }

      choicePrompt = branch.choicePrompt
      choices = branch.choices
      outcomes = mapBranchToV2Outcomes(branch, chapterNumber)
    } else {
      // Chapter 50: ending proposal was resolved once before audit.
      choicePrompt = null
      choices = null
      outcomes = []
    }

    // Ending lock at ch45 (or reuse persisted lock). endingLocked must come from
    // persisted lock or the lock written this turn — never forced by chapter>=45 alone.
    let lockWrittenThisTurn: EndingResolution | null = null
    if (chapterNumber === ENDING_LOCK_CHAPTER && !reader.locked_ending_key) {
      const lock = ending ?? d.resolveEnding({
        routeState,
        storyContract: contract,
        chapterNumber,
        lockedEndingKey: brief.lockedEndingKey,
      })
      ending = lock
      lockWrittenThisTurn = lock
    } else if (chapterNumber === ENDING_LOCK_CHAPTER && reader.locked_ending_key) {
      ending = ending ?? d.resolveEnding({
        routeState,
        storyContract: contract,
        chapterNumber,
        lockedEndingKey: reader.locked_ending_key,
      })
    }

    // Abort before ending-lock write so ownership loss cannot mutate reader lock.
    // Publish stays after this gate.
    if (jobContext?.signal?.aborted) {
      await releaseOwnLease()
      return { ok: false, reason: 'CAPACITY_TIMEOUT', detail: { reason: 'ABORT_SIGNAL' } }
    }

    if (chapterNumber === ENDING_LOCK_CHAPTER && !jobContext) {
      const lock = lockWrittenThisTurn ?? ending ?? d.resolveEnding({
        routeState,
        storyContract: contract,
        chapterNumber,
        lockedEndingKey: reader.locked_ending_key ?? brief.lockedEndingKey,
      })
      ending = lock
      await d.persistEndingLock({
        userId,
        storyId,
        endingKey: lock.key,
        endingName: lock.name,
        chapterNumber,
      })
    }

    type LocalPublish =
      | { ok: true; chapter_number: number; seq: number }
      | { ok: false; reason: 'CHAPTER_EXISTS' | 'LEASE_HELD' | 'FAILED_REVIEW_REQUIRED' | 'TRANSIENT' | 'CAPACITY_TIMEOUT' }

    let published: LocalPublish
    if (jobContext) {
      const { publishGenerationJobChapterV4 } = await import('@/lib/runtime/generation-jobs')
      const endingLock = chapterNumber === ENDING_LOCK_CHAPTER
        ? lockWrittenThisTurn ?? ending ?? d.resolveEnding({
            routeState,
            storyContract: contract,
            chapterNumber,
            lockedEndingKey: reader.locked_ending_key ?? brief.lockedEndingKey,
          })
        : null
      try {
        const fenced = await publishGenerationJobChapterV4({
          jobId: jobContext.jobId,
          workerId: jobContext.workerId,
          claimToken: jobContext.claimToken,
          leaseId: jobContext.leaseId,
          storyId,
          chapterNumber,
          title: readerSafe.title,
          paragraphs: readerSafe.paragraphs,
          choicePrompt,
          choices: choices as unknown[],
          outcomes,
          endingLock: endingLock ? { key: endingLock.key, name: endingLock.name } : null,
          closures: auditSignals.closesPlotDebts,
        })
        published = {
          ok: true,
          chapter_number: fenced.chapterNumber,
          seq: fenced.seq,
        }
      } catch (err) {
        throwIfAborted(jobContext.signal)
        const classification = classifyGenerationPublicationError(err)
        const info = safeErrorInfo(err)
        console.error('PERSONALIZED_FENCED_PUBLISH_FAILED', {
          storyId,
          chapterNumber,
          jobId: jobContext.jobId,
          errorCode: classification.code,
          errorName: info.errorName.slice(0, 100),
        })
        if (classification.kind === 'chapter_exists') {
          published = { ok: false, reason: 'CHAPTER_EXISTS' }
        } else if (classification.kind === 'ownership_lost') {
          published = { ok: false, reason: 'LEASE_HELD' }
        } else if (classification.kind === 'transient') {
          published = { ok: false, reason: 'TRANSIENT' }
        } else {
          published = { ok: false, reason: 'FAILED_REVIEW_REQUIRED' }
        }
      }
    } else {
      const legacy = await d.publishChapterV2({
        storyId,
        chapterNumber,
        title: readerSafe.title,
        paragraphs: readerSafe.paragraphs,
        choicePrompt,
        choices,
        outcomes,
        leaseId,
        idempotencyKey: personalizedGenerationKey(storyId, chapterNumber, 'publish'),
      })
      if (legacy.ok) {
        // Publish RPC atomically released its lease; caller no longer owns it.
        ownLease = false
        published = {
          ok: true,
          chapter_number: legacy.chapter_number,
          seq: legacy.seq,
        }
      } else {
        published = { ok: false, reason: legacy.reason }
      }
    }

    // Legacy publish RPC owns lease release on success. Any failed legacy publish
    // leaves the caller-owned lease to release before reconciliation or return.
    if (!published.ok) await releaseOwnLease()

    if (published.ok && !jobContext) {
      await reconcilePublishedCheckpoint()
    }

    // Chapter 50 durability: after publish ok OR CHAPTER_EXISTS, ensure SELESAI.
    // Never mark when publish fails for non-exists reasons.
    if (chapterNumber === TOTAL_PERSONALIZED_CHAPTERS) {
      if (!published.ok && published.reason !== 'CHAPTER_EXISTS') {
        return { ok: false, reason: published.reason }
      }

      const finalEnding = ending ?? d.resolveEnding({
        routeState,
        storyContract: contract,
        chapterNumber,
        lockedEndingKey: reader.locked_ending_key ?? brief.lockedEndingKey,
      })
      const reconcileReaderState = async () => {
        await d.markReaderStateSelesai({
          userId,
          storyId,
          endingName: finalEnding.name,
          endingKey: finalEnding.key,
        })
      }
      const reconcileGenerationAttempt = async () => {
        await d.recordGenerationAttempt({
          storyId,
          chapter: chapterNumber,
          outcome: 'PUBLISHED',
          repairAttempts: result.attempts,
          findings: result.findings,
        })
      }

      if (jobContext && published.ok) {
        try {
          await reconcileReaderState()
        } catch (error) {
          console.log('POST_PUBLISH_RECONCILIATION_NEEDED', {
            storyId,
            chapterNumber,
            correlationId,
            jobId: jobContext.jobId,
            operation: 'MARK_READER_STATE_SELESAI',
            errorName: error instanceof Error ? error.name.slice(0, 100) : 'unknown',
          })
        }
        try {
          await reconcileGenerationAttempt()
        } catch (error) {
          console.log('POST_PUBLISH_RECONCILIATION_NEEDED', {
            storyId,
            chapterNumber,
            correlationId,
            jobId: jobContext.jobId,
            operation: 'RECORD_GENERATION_ATTEMPT',
            errorName: error instanceof Error ? error.name.slice(0, 100) : 'unknown',
          })
        }
      } else {
        await reconcileReaderState()
        await reconcileGenerationAttempt()
      }

      if (published.ok) {
        return {
          ok: true,
          chapterNumber: published.chapter_number,
          seq: published.seq,
          repairAttempts: result.attempts,
          fromCheckpoint,
        }
      }
      // Worker success requires fenced publish metadata. Reconciliation above is safe,
      // but CHAPTER_EXISTS must remain a failure so worker maps it to ALREADY_DONE.
      if (jobContext) return { ok: false, reason: 'CHAPTER_EXISTS' }

      // Legacy CHAPTER_EXISTS recovery: chapter already durable; mark completed above.
      return {
        ok: true,
        chapterNumber,
        seq: 0,
        repairAttempts: result.attempts,
      }
    }

    if (!published.ok) return { ok: false, reason: published.reason }

    // Best-effort telemetry — never convert publish success into workflow failure.
    try {
      await d.recordGenerationAttempt({
        storyId,
        chapter: chapterNumber,
        outcome: 'PUBLISHED',
        repairAttempts: result.attempts,
        findings: result.findings,
      })
    } catch {
      // non-critical
    }

    return {
      ok: true,
      chapterNumber: published.chapter_number,
      seq: published.seq,
      repairAttempts: result.attempts,
      ...(fromCheckpoint ? { fromCheckpoint: true } : {}),
    }
  } catch (err) {
    await releaseOwnLease()
    throw err
  }
}
