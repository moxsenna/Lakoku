import 'server-only'
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
  type AcquireLeaseResult,
  type PublishChapterV2Input,
  type PublishOutcomeV2,
  type PublishResult,
} from './lifecycle'
import type { RealGenerateResult } from './story-generation'

/**
 * Personalized chapter runtime (Task 17).
 *
 * Rantai:
 *   lease → canon → contract → reader state → brief → compile
 *         → generateChapter (plan→write→Layer A→Layer B→repair)
 *         → consumer-safe → choices (<50) / resolveEnding (50)
 *         → auditPlotDebts → ending lock @45 (atomic RPC) → publishChapterV2
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
  triggerChoiceId?: string
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
  selectProvider: () => Promise<GenerationProvider>
  generateChapter: (
    deps: { provider: GenerationProvider },
    args: {
      snapshot: CanonSnapshot
      blueprint: ChapterBlueprint
      chapterNumber: number
      threadContext?: ThreadContext
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
  ) => Promise<ChoiceBranch | null>
  resolveEnding: typeof resolveEnding
  auditPlotDebts: (input: PlotDebtAuditInput) => PlotDebtAuditResult
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

function lastParagraphs(draft: ChapterDraftParsed): ChoiceInput['lastParagraphs'] {
  const paragraphs = draft.paragraphs.filter((p) => p.trim().length > 0)
  const slice = paragraphs.slice(-5)
  while (slice.length < 3) {
    slice.unshift(paragraphs[0] ?? draft.title)
  }
  return slice as ChoiceInput['lastParagraphs']
}

function mapBranchToV2Outcomes(
  branch: ChoiceBranch,
  chapterNumber: number,
): PublishOutcomeV2[] {
  return branch.outcomes.map((outcome) => ({
    choiceId: outcome.choiceId,
    consequence: outcome.consequence,
    nextChapterNumber: outcome.nextChapterNumber,
    isEnding: outcome.isEnding,
    effect: outcome.effect,
    choiceKind: outcome.isEnding && chapterNumber === 49
      ? 'special_bad_ending'
      : 'normal',
  }))
}

function previousChoiceFrom(
  history: ChoiceHistoryEntry[],
  triggerChoiceId: string | undefined,
): ChoiceHistoryEntry | null {
  if (!history.length) return null
  if (triggerChoiceId) {
    const match = [...history].reverse().find((entry) => entry.choiceId === triggerChoiceId)
    if (match) return match
  }
  return history[history.length - 1] ?? null
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
    selectProvider,
    generateChapter,
    toReaderSafe,
    assertConsumerSafe,
    generateChoiceBranch,
    resolveEnding,
    auditPlotDebts,
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
  const d = deps ?? defaultDeps()
  const { storyId, userId, chapterNumber, triggerChoiceId } = input

  if (
    !Number.isInteger(chapterNumber)
    || chapterNumber < 1
    || chapterNumber > TOTAL_PERSONALIZED_CHAPTERS
  ) {
    throw new Error(`Invalid personalized chapter number: ${chapterNumber}`)
  }

  const lease = await d.acquireGenerationLease({
    storyId,
    chapterNumber,
    holder: 'personalized-generation',
    idempotencyKey: personalizedGenerationKey(storyId, chapterNumber, 'lease'),
  })
  if (!lease.ok) return { ok: false, reason: lease.reason }

  try {
    const snapshot = await d.loadCanonSnapshot(storyId, chapterNumber)
    const blueprint = resolveBlueprint(snapshot, chapterNumber)
    if (!blueprint || snapshot.characters.length === 0) {
      await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
      return { ok: false, reason: 'CANON_MISSING' }
    }

    const contract = await d.loadStoryGenerationContract(storyId)
    if (contract.storyId !== storyId) {
      await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
      throw new Error('Contract storyId does not match generation storyId.')
    }

    const reader = await d.loadReaderStateInternal(userId, storyId)
    if (reader.story_id !== storyId || reader.user_id !== userId) {
      await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
      throw new Error('Reader state ownership mismatch.')
    }

    const routeState: RouteState = reader.route_state
    const choiceHistory = reader.choice_history
    const previousChoice = previousChoiceFrom(choiceHistory, triggerChoiceId)

    const brief = d.buildChapterBrief({
      storyContract: contract,
      snapshot,
      readerState: {
        routeState,
        choiceHistory,
        lockedEndingKey: reader.locked_ending_key,
      },
      chapterNumber,
      previousChoice,
    })

    const packet = d.compileContext(snapshot, chapterNumber, { brief })
    await d.persistRetrievalLog(storyId, chapterNumber, packet)

    const threadContext: ThreadContext = {
      threads: snapshot.threads,
      advancedThreadIds: [],
      opensNewThread: false,
    }

    const result = await d.generateChapter(
      { provider: await d.selectProvider() },
      { snapshot, blueprint, chapterNumber, threadContext },
    )

    if (result.status !== 'PUBLISHED' || !result.draft) {
      await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
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

    const draft = result.draft
    const readerSafe = d.toReaderSafe(draft)
    d.assertConsumerSafe(readerSafe)

    let choicePrompt: string | null = null
    let choices: unknown[] | null = null
    let outcomes: PublishOutcomeV2[] = []
    let ending: EndingResolution | null = null

    if (chapterNumber < TOTAL_PERSONALIZED_CHAPTERS) {
      const provider = await d.selectProvider()
      const branch = await d.generateChoiceBranch(
        { provider },
        {
          snapshot,
          chapterBrief: brief,
          draft,
          lastParagraphs: lastParagraphs(draft),
          routeState,
          choiceHistory,
          lockedEndingKey: brief.lockedEndingKey,
        },
      )
      if (!branch) {
        await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
        throw new Error(`Choice branch missing for chapter ${chapterNumber}`)
      }

      const leakInChoices = [
        branch.choicePrompt,
        ...branch.choices.map((c) => c.label),
        ...branch.choices.flatMap((c) => (c.hint ? [c.hint] : [])),
        ...branch.outcomes.flatMap((o) => o.consequence),
      ].flatMap(scanForLeaks)
      if (leakInChoices.length) {
        await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
        throw new Error(
          `Kebocoran istilah internal pada cabang pilihan: ${leakInChoices.join(', ')}`,
        )
      }

      choicePrompt = branch.choicePrompt
      choices = branch.choices
      outcomes = mapBranchToV2Outcomes(branch, chapterNumber)
    } else {
      // Chapter 50: no choice generation; resolve locked ending for final prose metadata.
      ending = d.resolveEnding({
        routeState,
        storyContract: contract,
        chapterNumber,
        lockedEndingKey: reader.locked_ending_key ?? brief.lockedEndingKey,
      })
      choicePrompt = null
      choices = null
      outcomes = []
    }

    // Ending lock at ch45 (or reuse persisted lock). endingLocked must come from
    // persisted lock or the lock written this turn — never forced by chapter>=45 alone.
    let lockWrittenThisTurn: EndingResolution | null = null
    const persistedEndingKey = reader.locked_ending_key ?? brief.lockedEndingKey ?? null

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

    const endingLocked = Boolean(persistedEndingKey || lockWrittenThisTurn?.key)

    const auditFlags = derivePlotDebtAuditFlags({
      draft,
      brief,
      findings: result.findings,
      endingLocked,
    })
    const audit = d.auditPlotDebts({
      chapterNumber,
      debts: contract.plotDebts,
      ...auditFlags,
    })
    if (!audit.ok) {
      await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id })
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

    if (chapterNumber === ENDING_LOCK_CHAPTER) {
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

    const published = await d.publishChapterV2({
      storyId,
      chapterNumber,
      title: readerSafe.title,
      paragraphs: readerSafe.paragraphs,
      choicePrompt,
      choices,
      outcomes,
      leaseId: lease.lease_id,
      idempotencyKey: personalizedGenerationKey(storyId, chapterNumber, 'publish'),
    })

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
      await d.markReaderStateSelesai({
        userId,
        storyId,
        endingName: finalEnding.name,
        endingKey: finalEnding.key,
      })

      await d.recordGenerationAttempt({
        storyId,
        chapter: chapterNumber,
        outcome: 'PUBLISHED',
        repairAttempts: result.attempts,
        findings: result.findings,
      })

      if (published.ok) {
        return {
          ok: true,
          chapterNumber: published.chapter_number,
          seq: published.seq,
          repairAttempts: result.attempts,
        }
      }
      // CHAPTER_EXISTS recovery: chapter already durable; mark completed above.
      return {
        ok: true,
        chapterNumber,
        seq: 0,
        repairAttempts: result.attempts,
      }
    }

    if (!published.ok) return { ok: false, reason: published.reason }

    await d.recordGenerationAttempt({
      storyId,
      chapter: chapterNumber,
      outcome: 'PUBLISHED',
      repairAttempts: result.attempts,
      findings: result.findings,
    })

    return {
      ok: true,
      chapterNumber: published.chapter_number,
      seq: published.seq,
      repairAttempts: result.attempts,
    }
  } catch (err) {
    await d.releaseGenerationLease({ storyId, leaseId: lease.lease_id }).catch(() => {})
    throw err
  }
}
